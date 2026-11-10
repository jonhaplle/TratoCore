const test = require("node:test");
const assert = require("node:assert/strict");
const resolver = require("./attributeResolver.service");

const definitions = [
    { id: "BRAND", name: "Marca", value_type: "string", tags: { required: true } },
    { id: "MODEL", name: "Modelo", value_type: "string", tags: { required: true } },
    { id: "MANUFACTURER", name: "Fabricante", value_type: "string", tags: { required: true } },
    {
        id: "MODEL_ALPHANUMERIC",
        name: "Modelo alfanumérico",
        value_type: "string",
        tags: { required: true },
        values: [
            { id: "rmx3624", name: "RMX3624" },
            { id: "sm-a125m", name: "SM-A125M" }
        ]
    }
];

test("resolve BRAND, MODEL and MANUFACTURER from saved product data", () => {
    const result = resolver.build({
        product: {
            brand: "Samsung",
            model: "Galaxy A12",
            attributes: { manufacturer: "Samsung Eletrônica da Amazônia Ltda." }
        },
        categoryAttributes: definitions
    });

    assert.equal(result.attributes.find(item => item.id === "BRAND")?.value_name, "Samsung");
    assert.equal(result.attributes.find(item => item.id === "MODEL")?.value_name, "Galaxy A12");
    assert.equal(
        result.attributes.find(item => item.id === "MANUFACTURER")?.value_name,
        "Samsung Eletrônica da Amazônia Ltda."
    );
});

test("never accepts a predicted MODEL_ALPHANUMERIC code without explicit product evidence", () => {
    const result = resolver.build({
        product: { brand: "Samsung", model: "Galaxy A12" },
        categoryAttributes: definitions,
        prediction: {
            attributes: [{ id: "MODEL_ALPHANUMERIC", value_name: "RMX3624" }]
        }
    });

    assert.equal(result.attributes.some(item => item.id === "MODEL_ALPHANUMERIC"), false);
    assert.equal(result.missing.some(item => item.id === "MODEL_ALPHANUMERIC"), true);
});

test("explicit MODEL_ALPHANUMERIC on product overrides prediction", () => {
    const result = resolver.build({
        product: {
            brand: "Samsung",
            model: "Galaxy A12",
            ml_attributes: { MODEL_ALPHANUMERIC: { value_name: "SM-A125M" } }
        },
        categoryAttributes: definitions,
        prediction: {
            attributes: [{ id: "MODEL_ALPHANUMERIC", value_name: "RMX3624" }]
        }
    });

    assert.equal(result.attributes.find(item => item.id === "MODEL_ALPHANUMERIC")?.value_id, "sm-a125m");
    assert.equal(result.missing.some(item => item.id === "MODEL_ALPHANUMERIC"), false);
});


test("does not require new-only attributes for used products", () => {
    const result = resolver.build({
        product: { condition: "used", brand: "Samsung", model: "Galaxy A12" },
        categoryAttributes: [
            { id: "ANATEL_HOMOLOGATION_NUMBER", name: "Homologação Anatel", value_type: "string", tags: { new_required: true } },
            { id: "BRAND", name: "Marca", value_type: "string", tags: { required: true } }
        ]
    });

    assert.equal(result.missing.some(item => item.id === "ANATEL_HOMOLOGATION_NUMBER"), false);
    assert.equal(result.attributes.some(item => item.id === "BRAND"), true);
});

test("requires new-only attributes for new products", () => {
    const result = resolver.build({
        product: { condition: "new" },
        categoryAttributes: [
            { id: "ANATEL_HOMOLOGATION_NUMBER", name: "Homologação Anatel", value_type: "string", tags: { new_required: true } }
        ]
    });

    assert.equal(result.missing.some(item => item.id === "ANATEL_HOMOLOGATION_NUMBER"), true);
});

test("uses saved package measurements before asking for manual overrides", () => {
    const result = resolver.build({
        product: {
            condition: "used",
            seller_package_height: 8,
            seller_package_width: 12,
            seller_package_length: 18,
            seller_package_weight: 420
        },
        categoryAttributes: [],
        requirePackageDimensions: true
    });

    assert.equal(result.missing.length, 0);
    assert.deepEqual(
        result.attributes.filter(item => item.id.startsWith("SELLER_PACKAGE_")).map(item => item.id).sort(),
        ["SELLER_PACKAGE_HEIGHT", "SELLER_PACKAGE_LENGTH", "SELLER_PACKAGE_WEIGHT", "SELLER_PACKAGE_WIDTH"]
    );
});
