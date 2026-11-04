const test = require("node:test");
const assert = require("node:assert/strict");
const resolver = require("./attributeResolver.service");

const packageDefinitions = [
    { id: "SELLER_PACKAGE_HEIGHT", name: "Altura da embalagem", value_type: "number", tags: {}, values: [] },
    { id: "SELLER_PACKAGE_WIDTH", name: "Largura da embalagem", value_type: "number", tags: {}, values: [] },
    { id: "SELLER_PACKAGE_LENGTH", name: "Comprimento da embalagem", value_type: "number", tags: {}, values: [] },
    { id: "SELLER_PACKAGE_WEIGHT", name: "Peso da embalagem", value_type: "number", tags: {}, values: [] }
];

test("dimensões da embalagem não bloqueiam produtos quando ME2 não foi selecionado", () => {
    const result = resolver.build({
        product: { title: "Prato decorativo antigo", condition: "used" },
        categoryAttributes: [],
        conditionalAttributes: [],
        overrides: {},
        requirePackageDimensions: false
    });
    assert.equal(result.missing.length, 0);
    assert.equal(result.attributes.some(attribute => attribute.id.startsWith("SELLER_PACKAGE_")), false);
});

test("ME2 exige dimensões quando não há medidas conhecidas ou referência", () => {
    const result = resolver.build({
        product: { title: "Prato decorativo antigo", condition: "used" },
        categoryAttributes: packageDefinitions,
        conditionalAttributes: [],
        overrides: {},
        requirePackageDimensions: true
    });
    assert.deepEqual(
        result.missing.map(attribute => attribute.id).sort(),
        [
            "SELLER_PACKAGE_HEIGHT",
            "SELLER_PACKAGE_LENGTH",
            "SELLER_PACKAGE_WEIGHT",
            "SELLER_PACKAGE_WIDTH"
        ]
    );
});

test("ME2 mantém estimativa existente para console e videogame", () => {
    const result = resolver.build({
        product: { title: "Console Xbox usado", condition: "used" },
        categoryAttributes: [],
        conditionalAttributes: [],
        overrides: {},
        requirePackageDimensions: true
    });
    assert.equal(result.missing.length, 0);
    assert.deepEqual(
        result.attributes
            .filter(attribute => attribute.id.startsWith("SELLER_PACKAGE_"))
            .map(attribute => attribute.value_name),
        ["20 cm", "35 cm", "45 cm", "3500 g"]
    );
});
