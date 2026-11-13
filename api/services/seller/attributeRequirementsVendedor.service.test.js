const test = require("node:test");
const assert = require("node:assert/strict");

const { buildRequirements } = require("./attributeRequirementsVendedor.service");
const { classifyDefinitions } = require("../ml/attributeRequirements.service");

// Metadados reais da categoria de celulares (resumidos).
const cellphoneAttributes = [
    { id: "BRAND", name: "Marca", value_type: "string", tags: { required: true }, values: [] },
    { id: "MODEL", name: "Modelo", value_type: "string", tags: { required: true }, values: [] },
    { id: "IS_DUAL_SIM", name: "É Dual SIM", value_type: "boolean", tags: { required: true }, values: [{ id: "242085", name: "Sim" }, { id: "242084", name: "Não" }] },
    { id: "COLOR", name: "Cor", value_type: "string", tags: { required: true }, values: [{ id: "52049", name: "Preto" }, { id: "516677", name: "Branco" }] },
    { id: "CARRIER", name: "Operadora", value_type: "list", tags: { required: true }, values: [{ id: "1", name: "Desbloqueado" }, { id: "2", name: "Claro" }] },
    { id: "MANUFACTURER", name: "Fabricante", value_type: "string", tags: { required: true }, values: [] },
    { id: "CELLPHONES_ANATEL_HOMOLOGATION_NUMBER", name: "Número de homologação da Anatel", value_type: "number", tags: { required: true }, values: [] },
    { id: "ALPHANUMERIC_MODELS", name: "Modelo alfanumérico", value_type: "string", tags: { required: true }, values: [] },
    { id: "INTERNAL_MEMORY", name: "Memória interna", value_type: "number_unit", tags: {}, allowed_units: [{ id: "GB" }], default_unit: "GB", values: [] }
];

const definitions = classifyDefinitions(cellphoneAttributes, null);

test("padrões do modelo preenchem o que é do fabricante e pedem confirmação", () => {
    const result = buildRequirements({
        definitions,
        identification: { brand: "Samsung", line: "Galaxy", model: "Galaxy A15", capacity: "128GB" },
        seller: { condition: "used" }
    });

    const filled = Object.fromEntries(result.attributes.map(item => [item.id, item]));

    assert.equal(filled.BRAND.value_name, "Samsung");
    assert.equal(filled.MODEL.value_name, "Galaxy A15");
    assert.equal(filled.COLOR.value_name, "Preto");
    assert.equal(filled.IS_DUAL_SIM.value_id, "242085");
    assert.equal(filled.MANUFACTURER.value_name, "Samsung");
    assert.equal(filled.INTERNAL_MEMORY.value_struct.number, 128);

    // A hipótese de cor precisa estar explícita para o vendedor conferir.
    assert.ok(result.hypotheses.some(item => item.id === "COLOR" && item.confidence === "hypothesis"));
});

test("o que não pode ser inventado continua pendente", () => {
    const result = buildRequirements({
        definitions,
        identification: { brand: "Samsung", model: "Galaxy A15" },
        seller: { condition: "used" }
    });

    const pendingIds = result.pending.map(item => item.id);

    assert.ok(pendingIds.includes("CARRIER"));
    assert.ok(pendingIds.includes("CELLPHONES_ANATEL_HOMOLOGATION_NUMBER"));
    assert.ok(pendingIds.includes("ALPHANUMERIC_MODELS"));
    assert.equal(result.ready, false);
});

test("valor confirmado pelo vendedor vence a hipótese", () => {
    const result = buildRequirements({
        definitions,
        identification: { brand: "Samsung", model: "Galaxy A15" },
        seller: { condition: "used" },
        // A tela envia o nome escolhido; o conversor resolve para o value_id.
        overrides: { COLOR: "Branco", CARRIER: "Desbloqueado" }
    });

    const filled = Object.fromEntries(result.attributes.map(item => [item.id, item]));

    assert.equal(filled.COLOR.value_id, "516677");
    assert.equal(filled.COLOR.origin, "seller");
    assert.equal(filled.CARRIER.value_id, "1");
    assert.ok(!result.pending.some(item => item.id === "CARRIER"));
});

test("id de lista enviado pela tela continua sendo usado como value_id", () => {
    const result = buildRequirements({
        definitions,
        identification: { brand: "Samsung", model: "Galaxy A15" },
        seller: { condition: "used" },
        overrides: { CARRIER: { value_id: "2", value_name: "Claro" } }
    });

    const carrier = result.attributes.find(item => item.id === "CARRIER");

    assert.equal(carrier.value_id, "2");
    assert.equal(carrier.value_name, "Claro");
});

test("medidas da embalagem entram como sugestão confirmável", () => {
    const withPackage = classifyDefinitions([
        ...cellphoneAttributes,
        { id: "SELLER_PACKAGE_WEIGHT", name: "Peso da embalagem", value_type: "number_unit", tags: { hidden: true }, allowed_units: [{ id: "g" }], values: [] },
        { id: "SELLER_PACKAGE_HEIGHT", name: "Altura da embalagem", value_type: "number_unit", tags: { hidden: true }, allowed_units: [{ id: "cm" }], values: [] }
    ], null);

    const result = buildRequirements({
        definitions: withPackage,
        identification: { brand: "Samsung", model: "Galaxy A15" },
        seller: { condition: "used" }
    });

    // O ML só exige as 4 medidas juntas; aqui só 2 estão na categoria.
    const weight = result.attributes.find(item => item.id === "SELLER_PACKAGE_WEIGHT");

    if (weight) {
        assert.equal(weight.value_struct.unit, "g");
        assert.equal(weight.confidence, "hypothesis");

        const overridden = buildRequirements({
            definitions: withPackage,
            identification: { brand: "Samsung", model: "Galaxy A15" },
            seller: { condition: "used" },
            overrides: { SELLER_PACKAGE_WEIGHT: "450 g" }
        });

        const custom = overridden.attributes.find(item => item.id === "SELLER_PACKAGE_WEIGHT");

        assert.equal(custom.value_struct.number, 450);
        assert.equal(custom.origin, "seller");
    } else {
        // Sem as 4 medidas a API recusa o conjunto; o serviço não sugere
        // parcialmente. Nesse caso não é criada uma hipótese inútil.
        const hypotheses = result.hypotheses.filter(item => item.id.startsWith("SELLER_PACKAGE"));
        assert.equal(hypotheses.length, 0);
    }
});

test("estado ausente mantém ITEM_CONDITION pendente", () => {
    const definitionsWithCondition = classifyDefinitions(
        [...cellphoneAttributes, { id: "ITEM_CONDITION", name: "Condição", value_type: "list", tags: { required: true }, values: [{ id: "2230581", name: "Usado" }] }],
        null
    );

    const result = buildRequirements({
        definitions: definitionsWithCondition,
        identification: { brand: "Samsung", model: "Galaxy A15" },
        seller: { condition: "" }
    });

    assert.ok(result.pending.some(item => item.id === "ITEM_CONDITION"));
    assert.ok(!result.attributes.some(item => item.id === "ITEM_CONDITION"));
});

test("quando tudo tem valor, ready fica verdadeiro", () => {
    const result = buildRequirements({
        definitions,
        identification: { brand: "Samsung", model: "Galaxy A15", capacity: "128GB" },
        seller: { condition: "used" },
        overrides: {
            CARRIER: "Desbloqueado",
            CELLPHONES_ANATEL_HOMOLOGATION_NUMBER: "1234567890",
            ALPHANUMERIC_MODELS: "SM-A155M"
        }
    });

    assert.equal(result.ready, true);
    assert.equal(result.pending.length, 0);
});
