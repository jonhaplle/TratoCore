const test = require("node:test");
const assert = require("node:assert/strict");
const attributeResolver = require("./attributeResolver.service");

function definition(id, options = {}) {
    return {
        id,
        name: options.name || id,
        value_type: options.value_type || "string",
        tags: options.tags || {},
        values: options.values || []
    };
}

function attribute(result, id) {
    return result.attributes.find(item => item.id === id);
}

function missing(result, id) {
    return result.missing.find(item => item.id === id);
}

test("retains explicit BRAND, MODEL and GTIN values", () => {
    const result = attributeResolver.build({
        product: {
            brand: "Marca confirmada",
            model: "Modelo confirmado",
            gtin: "7891234567890",
            condition: "new"
        },
        categoryAttributes: [
            definition("BRAND", { tags: { required: true } }),
            definition("MODEL", { tags: { required: true } }),
            definition("GTIN", { tags: { required: true } })
        ]
    });

    assert.deepEqual(result.missing, []);
    assert.deepEqual(attribute(result, "BRAND"), { id: "BRAND", value_name: "Marca confirmada" });
    assert.deepEqual(attribute(result, "MODEL"), { id: "MODEL", value_name: "Modelo confirmado" });
    assert.deepEqual(attribute(result, "GTIN"), { id: "GTIN", value_name: "7891234567890" });
});

test("accepts seller-confirmed MATERIAL from the product field, publish override, or labeled description", () => {
    const materialDefinition = definition("MATERIAL", { tags: { required: true } });
    const cases = [
        {
            product: { material: "Aço" },
            options: {},
            expected: { id: "MATERIAL", value_name: "Aço" }
        },
        {
            product: {},
            options: { overrides: { MATERIAL: { value_name: "Aço" } } },
            expected: { id: "MATERIAL", value_name: "Aço" }
        },
        {
            product: { description: "Material: Aço" },
            options: {},
            expected: { id: "MATERIAL", value_name: "Aço" }
        }
    ];

    for (const { product, options, expected } of cases) {
        const result = attributeResolver.build({
            product: { condition: "new", ...product },
            categoryAttributes: [materialDefinition],
            ...options
        });

        assert.deepEqual(attribute(result, "MATERIAL"), expected);
        assert.equal(missing(result, "MATERIAL"), undefined);
    }
});

test("keeps required MATERIAL missing when no composition is confirmed", () => {
    const result = attributeResolver.build({
        product: {
            title: "Saca-rolhas manual prateado",
            description: "Acabamento prateado; composição não identificada.",
            attributes: { material: "Prata" }
        },
        categoryAttributes: [definition("MATERIAL", { tags: { required: true } })],
        prediction: { attributes: [{ id: "MATERIAL", value_name: "Prata" }] }
    });

    assert.equal(missing(result, "MATERIAL")?.id, "MATERIAL");
    assert.equal(attribute(result, "MATERIAL"), undefined);
});

test("does not convert a prateado finish or color into MATERIAL=Prata", () => {
    const result = attributeResolver.build({
        product: {
            title: "Saca-rolhas prateado",
            color: "Prateado",
            condition: "new"
        },
        categoryAttributes: [
            definition("COLOR", { tags: { required: true } }),
            definition("MATERIAL", { tags: { required: true } })
        ],
        prediction: { attributes: [{ id: "MATERIAL", value_name: "Prata" }] }
    });

    assert.deepEqual(attribute(result, "COLOR"), { id: "COLOR", value_name: "Prateado" });
    assert.equal(missing(result, "MATERIAL")?.id, "MATERIAL");
    assert.equal(attribute(result, "MATERIAL"), undefined);
});

test("does not invent EMPTY_GTIN_REASON when GTIN is absent", () => {
    const reasonDefinition = definition("EMPTY_GTIN_REASON", {
        name: "Motivo de GTIN vazio",
        tags: { required: true },
        values: [
            { id: "17055160", name: "Não se aplica" },
            { id: "17055161", name: "Outro motivo" }
        ]
    });
    const result = attributeResolver.build({
        product: { condition: "new" },
        categoryAttributes: [reasonDefinition]
    });

    assert.equal(missing(result, "EMPTY_GTIN_REASON")?.id, "EMPTY_GTIN_REASON");
    assert.equal(attribute(result, "EMPTY_GTIN_REASON"), undefined);
    assert.deepEqual(missing(result, "EMPTY_GTIN_REASON").values, reasonDefinition.values);
});

test("continues resolving non-MATERIAL predictor values in another category", () => {
    const result = attributeResolver.build({
        product: { title: "Item de outra categoria", condition: "new" },
        categoryAttributes: [
            definition("COLOR", { tags: { required: true } }),
            definition("MATERIAL", { tags: { required: true } })
        ],
        prediction: {
            category_id: "MLB123456",
            attributes: [
                { id: "COLOR", value_name: "Azul" },
                { id: "MATERIAL", value_name: "Plástico" }
            ]
        }
    });

    assert.deepEqual(attribute(result, "COLOR"), { id: "COLOR", value_name: "Azul" });
    assert.equal(missing(result, "MATERIAL")?.id, "MATERIAL");
    assert.equal(attribute(result, "MATERIAL"), undefined);
});
