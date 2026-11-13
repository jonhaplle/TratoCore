const test = require("node:test");
const assert = require("node:assert/strict");

const attributeResolver = require("./attributeResolver.service");

function definition(id, options = {}) {
    return { id, name: id, value_type: "string", tags: { required: true }, values: [], ...options };
}

function build(observation) {
    return attributeResolver.build({
        product: { title: "Produto", seller_observation: observation },
        categoryAttributes: [definition("MODEL")],
        prediction: null
    });
}

test("nome comercial declarado na observação vira MODEL", () => {
    const result = build("Dados RPG Kit com 7 dados verdes, usados, em ótimo estado");

    assert.deepEqual(result.attributes.find(item => item.id === "MODEL"), {
        id: "MODEL",
        value_name: "Dados RPG Kit com 7 dados verdes"
    });
});

test("declaração em terceira pessoa não vira modelo", () => {
    assert.deepEqual(build("O vendedor declara: aliança em prata.").missing.map(item => item.id), ["MODEL"]);
    assert.deepEqual(build("eu vendo uma bicicleta antiga").missing.map(item => item.id), ["MODEL"]);
});

test("palavras de estado são removidas do modelo declarado", () => {
    const result = build("Galaxy A15 usado");

    assert.equal(result.attributes.find(item => item.id === "MODEL").value_name, "Galaxy A15");
});

test("observação sem nome de produto não gera modelo", () => {
    assert.deepEqual(build("usado, funciona").missing.map(item => item.id), ["MODEL"]);
    assert.deepEqual(build("").missing.map(item => item.id), ["MODEL"]);
});
