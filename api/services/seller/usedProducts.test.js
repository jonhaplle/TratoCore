// Testes: fluxo de anúncios de produtos USADOS e atributos condicionais.
const test = require("node:test");
const assert = require("node:assert/strict");

const { buildRequirements } = require("./attributeRequirementsVendedor.service");
const { classifyDefinitions } = require("../ml/attributeRequirements.service");

// Metadados reais da categoria MLB1055 (celulares), resumidos.
const ATRIBUTOS_CELULAR = [
    { id: "BRAND", name: "Marca", value_type: "string", tags: { required: true }, values: [] },
    { id: "MODEL", name: "Modelo", value_type: "string", tags: { required: true }, values: [] },
    { id: "IS_DUAL_SIM", name: "É Dual SIM", value_type: "boolean", tags: { required: true }, values: [{ id: "242085", name: "Sim" }, { id: "242084", name: "Não" }] },
    { id: "COLOR", name: "Cor", value_type: "string", tags: { required: true }, values: [{ id: "52033", name: "Azul-escuro" }, { id: "52049", name: "Preto" }] },
    { id: "CARRIER", name: "Operadora", value_type: "list", tags: { required: true }, values: [{ id: "298335", name: "Desbloqueado" }, { id: "298336", name: "Claro" }] },
    { id: "MANUFACTURER", name: "Fabricante", value_type: "string", tags: { required: true }, values: [] },
    { id: "CELLPHONES_ANATEL_HOMOLOGATION_NUMBER", name: "Número de homologação da Anatel", value_type: "number", tags: { required: true }, values: [] },
    { id: "ALPHANUMERIC_MODELS", name: "Modelo alfanumérico", value_type: "string", tags: { required: true }, values: [] },
    { id: "ITEM_CONDITION", name: "Condição", value_type: "list", tags: { required: true }, values: [{ id: "2230581", name: "Usado" }, { id: "2230284", name: "Novo" }] },
    // Embalagem: hidden na categoria, mas exigida na validação (ME2).
    { id: "SELLER_PACKAGE_HEIGHT", name: "Altura da embalagem do vendor", value_type: "number_unit", tags: { hidden: true }, allowed_units: [{ id: "cm" }], values: [] },
    { id: "SELLER_PACKAGE_WIDTH", name: "Largura da embalagem do vendor", value_type: "number_unit", tags: { hidden: true }, allowed_units: [{ id: "cm" }], values: [] },
    { id: "SELLER_PACKAGE_LENGTH", name: "Comprimento da embalagem do vendor", value_type: "number_unit", tags: { hidden: true }, allowed_units: [{ id: "cm" }], values: [] },
    { id: "SELLER_PACKAGE_WEIGHT", name: "Peso da embalagem do vendor", value_type: "number_unit", tags: { hidden: true }, allowed_units: [{ id: "g" }], values: [] }
];

const definicoes = classifyDefinitions(ATRIBUTOS_CELULAR, null);

test("USADO: embalagem entra na revisão mesmo sendo hidden na categoria", () => {
    const result = buildRequirements({
        definitions: definicoes,
        identification: { brand: "Samsung", model: "Galaxy A16 5G" },
        seller: { condition: "used" }
    });

    const ids = new Set(result.attributes.map(a => a.id));

    assert.ok(ids.has("SELLER_PACKAGE_HEIGHT"), "altura deve aparecer");
    assert.ok(ids.has("SELLER_PACKAGE_WIDTH"), "largura deve aparecer");
    assert.ok(ids.has("SELLER_PACKAGE_LENGTH"), "comprimento deve aparecer");
    assert.ok(ids.has("SELLER_PACKAGE_WEIGHT"), "peso deve aparecer");
});

test("USADO: embalagem vem como sugestão confirmável, não como fato", () => {
    const result = buildRequirements({
        definitions: definicoes,
        identification: { brand: "Samsung", model: "Galaxy A16 5G" },
        seller: { condition: "used" }
    });

    const peso = result.attributes.find(a => a.id === "SELLER_PACKAGE_WEIGHT");

    assert.ok(peso, "peso presente");
    assert.equal(peso.confidence, "hypothesis", "deve ser hipótese até o vendedor confirmar");
    assert.ok(peso.note, "deve explicar que é sugestão");
});

test("USADO: dimensões podem ser editadas manualmente e viram valor do vendedor", () => {
    const result = buildRequirements({
        definitions: definicoes,
        identification: { brand: "Samsung", model: "Galaxy A16 5G" },
        seller: { condition: "used" },
        overrides: {
            SELLER_PACKAGE_HEIGHT: "6 cm",
            SELLER_PACKAGE_WIDTH: "12 cm",
            SELLER_PACKAGE_LENGTH: "18 cm",
            SELLER_PACKAGE_WEIGHT: "400 g"
        }
    });

    const altura = result.attributes.find(a => a.id === "SELLER_PACKAGE_HEIGHT");
    const peso = result.attributes.find(a => a.id === "SELLER_PACKAGE_WEIGHT");

    assert.equal(altura.origin, "seller");
    assert.equal(altura.value_struct.number, 6);
    assert.equal(altura.value_struct.unit, "cm");
    assert.equal(peso.value_struct.number, 400);
    assert.equal(peso.value_struct.unit, "g");
});

test("USADO: Anatel é exigida e NÃO é inventada", () => {
    const result = buildRequirements({
        definitions: definicoes,
        identification: { brand: "Samsung", model: "Galaxy A16 5G", color: "Azul-escuro" },
        seller: { condition: "used" }
    });

    const anatel = result.pending.find(p => p.id === "CELLPHONES_ANATEL_HOMOLOGATION_NUMBER");

    assert.ok(anatel, "Anatel deve ficar pendente quando não declarada");
    assert.ok(!result.attributes.some(a => a.id === "CELLPHONES_ANATEL_HOMOLOGATION_NUMBER"));
});

test("USADO: Anatel declarada pelo vendedor é aceita", () => {
    const result = buildRequirements({
        definitions: definicoes,
        identification: { brand: "Samsung", model: "Galaxy A16 5G" },
        seller: { condition: "used" },
        overrides: { CELLPHONES_ANATEL_HOMOLOGATION_NUMBER: "123456789012" }
    });

    const anatel = result.attributes.find(a => a.id === "CELLPHONES_ANATEL_HOMOLOGATION_NUMBER");

    assert.ok(anatel);
    assert.equal(anatel.value_name, "123456789012");
});

test("USADO: Anatel com formato inválido continua pendente", () => {
    const result = buildRequirements({
        definitions: definicoes,
        identification: { brand: "Samsung", model: "Galaxy A16 5G" },
        seller: { condition: "used" },
        overrides: { CELLPHONES_ANATEL_HOMOLOGATION_NUMBER: "abc" }
    });

    assert.ok(result.pending.some(p => p.id === "CELLPHONES_ANATEL_HOMOLOGATION_NUMBER"));
});

test("USADO: não exige caixa, embalagem original ou acessórios", () => {
    const result = buildRequirements({
        definitions: definicoes,
        identification: { brand: "Samsung", model: "Galaxy A16 5G" },
        seller: { condition: "used", accessories: [], defects: [] }
    });

    const todos = [
        ...result.attributes.map(a => a.id),
        ...result.pending.map(p => p.id)
    ];

    const proibidos = todos.filter(id =>
        /BOX|CAIXA|ACCESSOR|ACESSORIO|ORIGINAL_PACKAGE|MANUAL|CABLE/i.test(id)
    );

    assert.deepEqual(proibidos, [], "não deve exigir caixa/acessório");
});

// A condição do item é injetada pelo orquestrador (sellerListing) como
// override; aqui validamos que o override é aceito e vira item da ficha.
test("USADO: condição Usado injetada pelo orquestrador é aceita", () => {
    const result = buildRequirements({
        definitions: definicoes,
        identification: { brand: "Samsung", model: "Galaxy A16 5G" },
        seller: { condition: "used" },
        overrides: { ITEM_CONDITION: "Usado" }
    });

    const condicao = result.attributes.find(a => a.id === "ITEM_CONDITION");

    assert.ok(condicao, "condição deve estar preenchida");
    assert.equal(condicao.value_name, "Usado");
    assert.equal(condicao.origin, "seller");
});

test("NOVO: condição Novo injetada pelo orquestrador é aceita", () => {
    const result = buildRequirements({
        definitions: definicoes,
        identification: { brand: "Samsung", model: "Galaxy A16 5G" },
        seller: { condition: "new" },
        overrides: { ITEM_CONDITION: "Novo" }
    });

    const condicao = result.attributes.find(a => a.id === "ITEM_CONDITION");

    assert.equal(condicao.value_name, "Novo");
});
