const test = require("node:test");
const assert = require("node:assert/strict");

const catalog = require("./productCatalog.service");

test("reconhece Galaxy A15 e sugere 128GB como hipótese", () => {
    const entry = catalog.getCatalogEntry({ brand: "Samsung", model: "Galaxy A15" });

    assert.ok(entry);
    assert.equal(entry.capacity, "128GB");
    assert.match(entry._reason, /confirme/i);
});

test("encontra o modelo quando só há o nome do aparelho", () => {
    const entry = catalog.getCatalogEntry({ model: "Samsung Galaxy A15 5G" });

    assert.ok(entry);
    assert.equal(entry.model, "Galaxy A15");
});

test("só o nome do aparelho, sem marca e sem marca no nome, não basta", () => {
    assert.equal(catalog.getCatalogEntry({ model: "Galaxy A15 5G" }), null);
});

test("iPhone é reconhecido mesmo sem marca declarada", () => {
    assert.equal(catalog.getCatalogEntry({ model: "iPhone 13" })?.model, "iPhone 13");
});

test("só o nome do modelo sem marca não basta para outras marcas", () => {
    assert.equal(catalog.getCatalogEntry({ model: "Galaxy A15" }), null);
});

test("não confunde modelo parecido", () => {
    assert.equal(catalog.getCatalogEntry({ model: "Galaxy A54" }), null);
});

test("exige a marca para modelos curtos", () => {
    assert.equal(catalog.getCatalogEntry({ brand: "Motorola", model: "G54" })?.model, "Moto G54");
    assert.equal(catalog.getCatalogEntry({ model: "G54" }), null);
});

test("produto desconhecido não gera sugestão", () => {
    assert.equal(catalog.getCatalogEntry({ model: "Geladeira Frost Free" }), null);
    assert.equal(catalog.getCatalogEntry({}), null);
});

test("iPhone 11 é sugerido com 64GB e pede confirmação", () => {
    const entry = catalog.getCatalogEntry({ brand: "Apple", model: "iPhone 11" });

    assert.equal(entry.capacity, "64GB");
    assert.match(entry._reason, /64GB e 128GB/);
});
