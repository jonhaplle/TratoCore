const test = require("node:test");
const assert = require("node:assert/strict");

const copy = require("./listingCopy.service");

test("melhoria sem IA organiza a descrição sem inventar fatos", () => {
    const result = copy.improveWithoutAI({
        title: "Samsung Galaxy A15 Usado",
        description: "Celular em bom estado. Segundo o vendedor, funciona bem. #promo",
        identification: { brand: "Samsung", model: "Galaxy A15" },
        condition: "used",
        accessories: ["Carregador"]
    });

    assert.match(result.description, /Samsung Galaxy A15/);
    assert.match(result.description, /Estado: usado/);
    assert.match(result.description, /Carregador/);
    assert.match(result.description, /Despacho imediato/);

    // O que não deve aparecer em anúncio é removido do texto original.
    assert.ok(!/segundo o vendedor/i.test(result.description));
    assert.ok(!/#promo/.test(result.description));

    // Nenhum fato novo é criado.
    assert.ok(!/garantia/i.test(result.description));
    assert.ok(!/novo/i.test(result.description));
    assert.equal(result.provider, "regras_locais");
});

test("melhoria sem IA remove menções à inteligência artificial", () => {
    const result = copy.improveWithoutAI({
        description: "Produto analisado por IA, ótimo estado",
        identification: { model: "Galaxy A15" },
        condition: "used"
    });

    assert.ok(!/\bIA\b/.test(result.description));
    assert.ok(!/intelig[êe]ncia artificial/i.test(result.description));
});

test("melhoria sem IA sem estado não afirma condição", () => {
    const result = copy.improveWithoutAI({
        description: "Produto como está",
        identification: { model: "Galaxy A15" },
        condition: ""
    });

    assert.ok(!/Estado:/i.test(result.description));
});

test("melhoria sem IA mantém o título enviado", () => {
    const result = copy.improveWithoutAI({ title: "Samsung Galaxy A15 128GB Usado" });

    assert.equal(result.title, "Samsung Galaxy A15 128GB Usado");
});
