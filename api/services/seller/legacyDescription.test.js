// Testes P2: a descrição antiga do cadastro NÃO influencia a nova descrição.
const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

const servicePath = require.resolve("./sellerListing.service");
const publishPath = require.resolve("./publishVendedor.service");

const DESCRICAO_ANTIGA =
    "Smartphone com tela ampla, conjunto de câmeras triplas e bateria de longa duração. " +
    "Acompanha carregador rápido e garantia de 12 meses.";

function createStubs({ productDescription = DESCRICAO_ANTIGA } = {}) {
    const chamadas = { createDescription: [], update: [] };

    const product = {
        id: 900,
        title: "Samsung Galaxy A16 5G Azul Escuro",
        description: productDescription,
        sale_price: 999,
        quantity: 1,
        condition: "used",
        brand: "",
        model: "",
        color: "",
        line: "",
        ml_item_id: null
    };

    const apiService = {
        async getAccessToken() { return "token"; },
        async getMe() { return { id: 1 }; },
        async getShippingPreferences() { return { modes: ["custom"] }; },
        async validateItem() { return {}; },
        async publishItem() {
            return { id: "MLB1234567890", permalink: "https://produto.mercadolivre.com.br/MLB-1234567890", status: "active" };
        },
        async createDescription(itemId, texto) {
            chamadas.createDescription.push({ itemId, texto });
            return { ok: true };
        }
    };

    const stubs = {
        "../productService": {
            async getById() { return { ...product }; },
            async update(id, dados) {
                chamadas.update.push({ id, dados });
                return { ...product, ...dados };
            }
        },
        "../productImageService": {
            async getByProductId() {
                return [{ id: 1, original_url: "/storage/originals/foto.jpg", file_name: "foto.jpg", is_main: true }];
            }
        },
        "../ml/publicationSpec.service": {
            async resolve() {
                return {
                    category_id: "MLB1055",
                    category: { id: "MLB1055", name: "Celulares e Smartphones", settings: { max_title_length: 60 }, path_from_root: [] },
                    listing_type: { id: "gold_pro" },
                    attributes: [
                        { id: "BRAND", name: "Marca", value_type: "string", tags: { required: true }, values: [] },
                        { id: "MODEL", name: "Modelo", value_type: "string", tags: { required: true }, values: [] },
                        { id: "ITEM_CONDITION", name: "Condição", value_type: "list", tags: { required: true }, values: [{ id: "2230581", name: "Usado" }] }
                    ],
                    conditionalAttributes: { required_attributes: [] },
                    prediction: { attributes: [] }
                };
            }
        },
        "../ml/api.service": apiService,
        "../ml/mlProduct.service": {
            async savePublication() {}
        },
        "../ml/priceReference.service": {
            async reference() {
                return { suggested: null, explanation: [], sources: [], references: [], warning: "sem referência" };
            }
        },
        "../ml/token.service": { async refresh() { return "token"; } },
        "./identificationVendedor.service": {
            async identify() {
                return {
                    identification: { brand: "", model: "", capacity: "", color: "", features: ["Tela grande"] },
                    seller: {
                        observation: "Samsung Galaxy A16 5G, usado, funciona",
                        condition: "used",
                        condition_label: "Usado",
                        working: true,
                        incomplete: false,
                        accessories: [],
                        defects: []
                    },
                    evidence: [],
                    hypotheses: [],
                    questions: [],
                    confidence: { score: 0, level: "LOW" },
                    images: { supplied: 1, analyzed: 0 },
                    ai: { ok: false, error: "teste" },
                    warnings: []
                };
            }
        }
    };

    const itemStub = {
        async build() {
            return {
                category_id: "MLB1055",
                price: 999,
                attributes: [
                    { id: "BRAND", value_name: "Samsung" },
                    { id: "MODEL", value_name: "Galaxy A16 5G" }
                ],
                pictures: []
            };
        },
        async uploadPictures() { return [{ id: "PIC-1" }]; }
    };

    return { chamadas, stubs, itemStub };
}

function load(stubs, itemStub) {
    const originalLoad = Module._load;
    for (const p of [servicePath, publishPath]) delete require.cache[p];

    Module._load = function (request, parent, isMain) {
        if (parent?.filename === servicePath && Object.hasOwn(stubs, request)) return stubs[request];
        if (parent?.filename === publishPath) {
            if (request === "../ml/item.service") return itemStub;
            if (Object.hasOwn(stubs, request)) return stubs[request];
        }
        return originalLoad.call(this, request, parent, isMain);
    };

    try {
        return { seller: require(servicePath), publish: require(publishPath) };
    } finally {
        Module._load = originalLoad;
    }
}

test("P2: descrição antiga do cadastro não entra na descrição da revisão", async () => {
    const { stubs, itemStub } = createStubs();
    const { seller } = load(stubs, itemStub);

    const review = await seller.buildReview({
        productId: 900,
        sellerObservation: "Samsung Galaxy A16 5G, usado, funciona",
        overrides: { condition: "used", sale_price: 999 }
    });

    const descricao = review.description.value;

    assert.ok(
        !descricao.includes("câmeras triplas"),
        "não deve reaproveitar característica não confirmada do cadastro"
    );
    assert.ok(!/garantia de 12 meses/i.test(descricao), "não deve herdar garantia");
    assert.ok(!/carregador rápido/i.test(descricao), "não deve herdar acessório do cadastro");
    assert.ok(!descricao.includes(DESCRICAO_ANTIGA), "não deve conter o texto antigo");
});

test("P2: a tela informa que a descrição antiga foi ignorada", async () => {
    const { stubs, itemStub } = createStubs();
    const { seller } = load(stubs, itemStub);

    const review = await seller.buildReview({
        productId: 900,
        sellerObservation: "usado, funciona",
        overrides: { condition: "used", sale_price: 999 }
    });

    assert.equal(review.legacy_description_ignored, true);
    assert.equal(review.description_source, "evidencias");
});

test("P2: descrição escrita na revisão é usada como está", async () => {
    const { stubs, itemStub } = createStubs();
    const { seller } = load(stubs, itemStub);

    const review = await seller.buildReview({
        productId: 900,
        sellerObservation: "usado",
        overrides: { condition: "used", sale_price: 999, description: "Texto aprovado pelo vendedor." }
    });

    assert.equal(review.description.value, "Texto aprovado pelo vendedor.");
    assert.equal(review.description_source, "revisao");
});

test("P2: publicação envia a descrição aprovada, nunca a do cadastro", async () => {
    const { stubs, itemStub, chamadas } = createStubs();
    const { seller } = load(stubs, itemStub);

    await seller.publish({
        productId: 900,
        approve: true,
        overrides: {
            title: "Samsung Galaxy A16 5G Usado",
            description: "Descrição verificada na revisão.",
            sale_price: 999,
            condition: "used"
        }
    });

    assert.equal(chamadas.createDescription.length, 1, "deve gravar a descrição no ML");
    assert.equal(chamadas.createDescription[0].texto, "Descrição verificada na revisão.");
    assert.ok(
        !chamadas.createDescription[0].texto.includes("câmeras triplas"),
        "não deve enviar texto antigo do cadastro"
    );
});

test("P2: sem descrição na revisão, nada é enviado ao ML", async () => {
    const { stubs, itemStub, chamadas } = createStubs();
    const { seller } = load(stubs, itemStub);

    await seller.publish({
        productId: 900,
        approve: true,
        overrides: { title: "Samsung Galaxy A16 5G Usado", sale_price: 999, condition: "used" }
    });

    assert.equal(chamadas.createDescription.length, 0, "não deve usar o cadastro como fallback");
});

test("P2: descrição vinda apenas das evidências não inventa características", async () => {
    const { stubs, itemStub } = createStubs();

    // Usa o parser REAL de declarações do vendedor (não o stub fixo), para
    // provar que o defeito declarado aparece e nada além dele é inventado.
    const identificacaoReal = require("./identificationVendedor.service");
    const declaracoes = identificacaoReal.parseSellerDeclarations(
        "Samsung Galaxy A16 5G, usado, funciona, risco na traseira"
    );

    stubs["./identificationVendedor.service"] = {
        async identify() {
            return {
                identification: { brand: "", model: "", capacity: "", color: "", features: [] },
                seller: {
                    observation: declaracoes.text,
                    condition: declaracoes.condition,
                    condition_label: "Usado",
                    working: declaracoes.working,
                    incomplete: declaracoes.incomplete,
                    accessories: declaracoes.accessories,
                    defects: declaracoes.defects
                },
                evidence: [],
                hypotheses: [],
                questions: [],
                confidence: { score: 0, level: "LOW" },
                images: { supplied: 1, analyzed: 0 },
                ai: { ok: false, error: "teste" },
                warnings: []
            };
        }
    };

    const { seller } = load(stubs, itemStub);

    const review = await seller.buildReview({
        productId: 900,
        sellerObservation: "Samsung Galaxy A16 5G, usado, funciona, risco na traseira",
        overrides: { condition: "used", sale_price: 999 }
    });

    const descricao = review.description.value;

    assert.match(descricao, /Estado: usado/i);
    assert.match(descricao, /Risco/i, "defeito declarado deve aparecer");
    assert.ok(!/câmera|tela ampla|garantia|bateria/i.test(descricao), "não inventa especificações");
    assert.ok(!descricao.includes("câmeras triplas"), "não herda o cadastro");
});
