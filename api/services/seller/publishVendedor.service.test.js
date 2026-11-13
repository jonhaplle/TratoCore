const test = require("node:test");
const assert = require("node:assert/strict");

const { normalizeOverrides } = require("./publishVendedor.service");

test("normaliza overrides em objeto para a lista do item.service", () => {
    const list = normalizeOverrides({
        BRAND: "Samsung",
        COLOR: { value_id: "52049", value_name: "Preto" },
        INTERNAL_MEMORY: "128 GB",
        SELLER_PACKAGE_WEIGHT: { value_struct: { number: 400, unit: "g" } },
        VAZIO: ""
    });

    assert.deepEqual(list, [
        { id: "BRAND", value_name: "Samsung" },
        { id: "COLOR", value_id: "52049", value_name: "Preto" },
        { id: "INTERNAL_MEMORY", value_name: "128 GB" },
        { id: "SELLER_PACKAGE_WEIGHT", value_struct: { number: 400, unit: "g" } }
    ]);
});

test("normaliza overrides em lista e descarta itens sem valor", () => {
    const list = normalizeOverrides([
        { id: "CARRIER", value_id: "298335", value_name: "Claro" },
        { id: "X" },
        null
    ]);

    assert.deepEqual(list, [{ id: "CARRIER", value_id: "298335", value_name: "Claro" }]);
});

test("lista vazia e nulo não quebram", () => {
    assert.deepEqual(normalizeOverrides(null), []);
    assert.deepEqual(normalizeOverrides([]), []);
});
