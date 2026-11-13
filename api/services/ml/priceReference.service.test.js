const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

const servicePath = require.resolve("./priceReference.service");

function loadWith(apiServiceStub) {
    const originalLoad = Module._load;
    delete require.cache[servicePath];

    Module._load = function (request, parent, isMain) {
        if (parent?.filename === servicePath && request === "./api.service") {
            return apiServiceStub;
        }
        return originalLoad.call(this, request, parent, isMain);
    };

    try {
        return require(servicePath);
    } finally {
        Module._load = originalLoad;
    }
}

const API = "https://api.mercadolibre.com";

/**
 * Simula o Mercado Livre:
 * - /products/search devolve catálogo do Galaxy A15;
 * - /products/{id}/items devolve ofertas;
 * - a busca aberta continua bloqueada (403), como na conta real.
 */
function makeHttp({ offers = [], ownItems = [], productName = "Samsung Galaxy A15 (128 Gb) Preto", offersStatus = 200 } = {}) {
    return {
        async get(url, options = {}) {
            if (url.includes("/sites/MLB/search")) {
                const error = new Error("forbidden");
                error.response = { status: 403, data: { message: "forbidden" } };
                throw error;
            }

            if (url.includes("/products/search")) {
                return {
                    data: {
                        results: [
                            { id: "MLB47310063", name: productName },
                            { id: "MLB25887680", name: "Capa GKK para Samsung Galaxy S10 preta" }
                        ]
                    }
                };
            }

            if (/\/products\/[^/]+\/items$/.test(url)) {
                if (offersStatus !== 200) {
                    const error = new Error("not found");
                    error.response = { status: offersStatus, data: { message: "No winners found" } };
                    throw error;
                }
                return { data: { results: offers } };
            }

            if (url.endsWith("/users/me")) {
                return { data: { id: 1155087423 } };
            }

            if (url.includes("/items/search")) {
                return { data: { results: ownItems.map(item => item.id) } };
            }

            if (url.includes(`${API}/items/`)) {
                return {
                    data: ownItems.map(item => ({ code: 200, body: item }))
                };
            }

            throw new Error(`unexpected url ${url}`);
        }
    };
}

test("sem termo suficiente não inventa preço", async () => {
    const service = loadWith({ async getAccessToken() { return "token"; } });
    service.setHttpClient(makeHttp());

    const result = await service.reference({ identification: {}, condition: "used" });

    assert.equal(result.suggested, null);
    assert.match(result.warning, /termo de busca/i);
});

test("ofertas de catálogo no mesmo estado definem preço sem estimativa", async () => {
    const service = loadWith({ async getAccessToken() { return "token"; } });
    service.setHttpClient(makeHttp({
        offers: [
            { item_id: "MLB1", price: 900, condition: "used" },
            { item_id: "MLB2", price: 950, condition: "used" },
            { item_id: "MLB3", price: 1050, condition: "used" }
        ]
    }));

    const result = await service.reference({
        identification: { brand: "Samsung", model: "Galaxy A15", capacity: "128GB" },
        condition: "used"
    });

    assert.equal(result.suggested, 950);
    assert.equal(result.is_estimate, false);
    assert.equal(result.confidence, "medium");
    assert.equal(result.sources[0].product.id, "MLB47310063");
});

test("ofertas de produto novo geram estimativa de usado marcada como tal", async () => {
    const service = loadWith({ async getAccessToken() { return "token"; } });
    service.setHttpClient(makeHttp({
        offers: [
            { item_id: "MLB1", price: 1000, condition: "new" },
            { item_id: "MLB2", price: 1200, condition: "new" },
            { item_id: "MLB3", price: 1100, condition: "new" }
        ]
    }));

    const result = await service.reference({
        identification: { brand: "Samsung", model: "Galaxy A15", capacity: "128GB" },
        condition: "used"
    });

    assert.equal(result.is_estimate, true);
    assert.equal(result.suggested, 770);
    assert.ok(result.explanation.some(text => /ESTIMATIVA/.test(text)));
});

test("catálogo de outro modelo é descartado e cai para a amostra da loja", async () => {
    const service = loadWith({ async getAccessToken() { return "token"; } });
    service.setHttpClient(makeHttp({
        productName: "Capa GKK para Samsung Galaxy A05 cinza",
        offersStatus: 404,
        ownItems: [
            { id: "MLB10", price: 300, status: "active", category_id: "MLB1055", condition: "used" },
            { id: "MLB11", price: 320, status: "active", category_id: "MLB1055", condition: "used" },
            { id: "MLB12", price: 400, status: "active", category_id: "MLB1055", condition: "used" }
        ]
    }));

    const result = await service.reference({
        identification: { brand: "Samsung", model: "Galaxy A15" },
        condition: "used",
        categoryId: "MLB1055"
    });

    assert.equal(result.is_estimate, true);
    assert.equal(result.sources[0].type, "seller_category_sample");
    assert.equal(result.suggested, 320);
});

test("sem referência nenhuma devolve null com explicação", async () => {
    const service = loadWith({ async getAccessToken() { return "token"; } });
    service.setHttpClient(makeHttp({ offersStatus: 404, ownItems: [] }));

    const result = await service.reference({
        identification: { brand: "Samsung", model: "Galaxy A15" },
        condition: "used",
        categoryId: "MLB1055"
    });

    assert.equal(result.suggested, null);
    assert.match(result.warning, /referência disponível/i);
});

test("o termo de busca não repete palavras da linha", () => {
    const service = loadWith({ async getAccessToken() { return "token"; } });

    assert.equal(
        service.buildSearchTerm({ brand: "Samsung", line: "Galaxy", model: "Galaxy A15", capacity: "128GB" }),
        "Samsung Galaxy A15 128GB"
    );
});

test("produto de catálogo precisa bater marca e modelo", () => {
    const service = loadWith({ async getAccessToken() { return "token"; } });

    assert.equal(service.productMatches({ name: "Samsung Galaxy A15 (128 Gb) Preto" }, { brand: "Samsung", model: "Galaxy A15" }), true);
    assert.equal(service.productMatches({ name: "Samsung Galaxy A05 Preto" }, { brand: "Samsung", model: "Galaxy A15" }), false);
    assert.equal(service.productMatches({ name: "Capa para Galaxy A15" }, { brand: "Samsung", model: "Galaxy A15" }), false);
});

test("acessórios e peças nunca viram referência de preço do produto", () => {
    const service = loadWith({ async getAccessToken() { return "token"; } });

    assert.equal(service.isAccessoryProduct("Capa de silicone para iPhone 11"), true);
    assert.equal(service.isAccessoryProduct("Tela para iPhone 11 A2221"), true);
    assert.equal(service.isAccessoryProduct("Bateria compatível com Galaxy A15"), true);
    assert.equal(service.isAccessoryProduct("Samsung Galaxy A15 (128 Gb) Preto"), false);
    assert.equal(service.isAccessoryProduct("iPhone 13 128GB Meia-noite"), false);
});

test("ofertas de acessório são ignoradas na busca de catálogo", async () => {
    const service = loadWith({ async getAccessToken() { return "token"; } });

    service.setHttpClient({
        async get(url) {
            if (url.includes("/products/search")) {
                return {
                    data: {
                        results: [
                            { id: "MLB-ACC", name: "Capa para Samsung Galaxy A15" },
                            { id: "MLB-PHN", name: "Samsung Galaxy A15 128GB Preto" }
                        ]
                    }
                };
            }
            if (url.includes("MLB-ACC/items")) {
                return { data: { results: [{ item_id: "X1", price: 25, condition: "new" }, { item_id: "X2", price: 30, condition: "new" }, { item_id: "X3", price: 28, condition: "new" }] } };
            }
            if (url.includes("MLB-PHN/items")) {
                return { data: { results: [{ item_id: "Y1", price: 1200, condition: "new" }, { item_id: "Y2", price: 1250, condition: "new" }, { item_id: "Y3", price: 1300, condition: "new" }] } };
            }
            throw new Error("unexpected " + url);
        }
    });

    const result = await service.reference({
        identification: { brand: "Samsung", model: "Galaxy A15", capacity: "128GB" },
        condition: "new"
    });

    assert.equal(result.sources[0].product.id, "MLB-PHN");
    assert.equal(result.suggested, 1250);
});

test("resumo ignora amostras insuficientes", () => {
    const service = loadWith({ async getAccessToken() { return "token"; } });
    assert.equal(service.summarize([100]), null);
});

test("descarta oferta com valor absurdo antes de calcular a mediana", () => {
    const service = loadWith({ async getAccessToken() { return "token"; } });

    // Uma oferta de R$ 750.000 nao pode virar mediana de um celular de R$ 1.300.
    assert.deepEqual(
        service.removeOutliers([1299.9, 750000, 1249.9]),
        [1299.9, 1249.9]
    );

    assert.deepEqual(
        service.removeOutliers([1000, 1200, 1100]),
        [1000, 1200, 1100]
    );

    // Com apenas 2 precos, um deles 10x acima do outro e oferta inconsistente.
    assert.deepEqual(service.removeOutliers([100, 5000]), [100]);
    // Precos proximos (2 ofertas reais) sao preservados.
    assert.deepEqual(service.removeOutliers([1200, 1300]), [1200, 1300]);
});
