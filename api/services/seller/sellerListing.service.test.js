// Teste de integração do fluxo do vendedor (serviços reais, rede simulada).
const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

const sellerServicePath = require.resolve("./sellerListing.service");
const publishServicePath = require.resolve("./publishVendedor.service");

const CELL_ATTRIBUTES = [
    { id: "BRAND", name: "Marca", value_type: "string", tags: { required: true }, values: [] },
    { id: "MODEL", name: "Modelo", value_type: "string", tags: { required: true }, values: [] },
    { id: "IS_DUAL_SIM", name: "É Dual SIM", value_type: "boolean", tags: { required: true }, values: [{ id: "242085", name: "Sim" }, { id: "242084", name: "Não" }] },
    { id: "COLOR", name: "Cor", value_type: "string", tags: { required: true }, values: [] },
    { id: "MANUFACTURER", name: "Fabricante", value_type: "string", tags: { required: true }, values: [] },
    { id: "CARRIER", name: "Operadora", value_type: "list", tags: { required: true }, values: [{ id: "1", name: "Desbloqueado" }] },
    { id: "ITEM_CONDITION", name: "Condição", value_type: "list", tags: { required: true }, values: [{ id: "2230581", name: "Usado" }] },
    { id: "INTERNAL_MEMORY", name: "Memória interna", value_type: "number_unit", tags: {}, allowed_units: [{ id: "GB" }], default_unit: "GB", values: [] }
];

function makeStubs({ throwsOnValidate = null } = {}) {
    const calls = { publishItem: 0, validate: 0, upload: 0, update: 0, saved: null, description: 0 };

    const product = {
        id: 901,
        title: "Samsung Galaxy A15 128GB Usado",
        description: "**Samsung Galaxy A15 128GB**\n\n• Estado: usado",
        sale_price: 825,
        quantity: 1,
        condition: "used",
        brand: "Samsung",
        model: "Galaxy A15",
        line: "Galaxy",
        color: "Preto",
        ml_item_id: null,
        ml_listing_type: "gold_pro"
    };

    const apiService = {
        async getAccessToken() { return "token"; },
        async validateItem(item) {
            calls.validate += 1;
            calls.validatedItem = item;
            if (throwsOnValidate) throw throwsOnValidate;
            return {};
        },
        async publishItem(item) {
            calls.publishItem += 1;
            calls.publishedItem = item;
            return {
                id: "MLB9999999999",
                permalink: "https://produto.mercadolivre.com.br/MLB-9999999999-samsung-galaxy-a15",
                status: "active"
            };
        },
        async createDescription() { calls.description += 1; return { ok: true }; }
    };

    const stubs = {
        "../productService": {
            async getById() { return { ...product }; },
            async update(id, data) { calls.update += 1; calls.updated = data; return { ...product, ...data }; }
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
                    category: { id: "MLB1055", name: "Celulares e Smartphones", settings: { max_title_length: 60 }, path_from_root: [{ id: "MLB1055", name: "Celulares e Smartphones" }] },
                    listing_type: { id: "gold_pro" },
                    attributes: CELL_ATTRIBUTES,
                    conditionalAttributes: { required_attributes: [] },
                    prediction: { attributes: [] }
                };
            }
        },
        "../ml/api.service": apiService,
        "../ml/mlProduct.service": {
            async savePublication(productId, ml) { calls.saved = { productId, ml }; }
        },
        "../ml/priceReference.service": {
            async reference() {
                return {
                    query: "Samsung Galaxy A15 128GB",
                    confidence: "none",
                    is_estimate: false,
                    suggested: null,
                    explanation: [],
                    sources: [],
                    references: [],
                    warning: "Sem referência."
                };
            }
        },
        "../ml/token.service": { async refresh() { return "token"; } },
        "./identificationVendedor.service": {
            async identify() {
                return {
                    identification: {},
                    seller: {
                        observation: "Samsung Galaxy A15 usado, funciona",
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
                    ai: { ok: false, error: "sem IA no teste" },
                    warnings: []
                };
            }
        }
    };

    const itemStub = {
        async build(productArg, pictures, spec, overrides) {
            calls.buildOverrides = overrides;
            return {
                category_id: spec.category_id,
                price: productArg.sale_price,
                condition: productArg.condition,
                attributes: [
                    { id: "BRAND", value_name: "Samsung" },
                    { id: "MODEL", value_name: "Galaxy A15" }
                ],
                pictures: []
            };
        },
        async uploadPictures() {
            calls.upload += 1;
            return [{ id: "PIC-1" }];
        }
    };

    return { calls, stubs, itemStub, product };
}

function load(stubs, itemStub, failAt = []) {
    const originalLoad = Module._load;
    for (const path of [sellerServicePath, publishServicePath]) delete require.cache[path];

    Module._load = function (request, parent, isMain) {
        if (parent?.filename === sellerServicePath && Object.hasOwn(stubs, request)) {
            if (failAt.some(entry => entry.path === sellerServicePath && entry.request === request)) {
                throw Object.assign(new Error("stub failure"), { code: "STUB" });
            }
            return stubs[request];
        }

        if (parent?.filename === publishServicePath) {
            if (request === "../ml/item.service") return itemStub;
            if (Object.hasOwn(stubs, request)) return stubs[request];
        }

        return originalLoad.call(this, request, parent, isMain);
    };

    try {
        return {
            seller: require(sellerServicePath),
            publish: require(publishServicePath)
        };
    } finally {
        Module._load = originalLoad;
    }
}

test("revisão monta título, descrição, preço e atributos a partir do produto", async () => {
    const { stubs, itemStub } = makeStubs();
    const { seller } = load(stubs, itemStub);

    const review = await seller.buildReview({
        productId: 901,
        sellerObservation: "Samsung Galaxy A15 usado, funciona",
        overrides: { condition: "used", brand: "Samsung", model: "Galaxy A15" }
    });

    assert.equal(review.success, true);
    assert.equal(review.category.id, "MLB1055");
    assert.equal(review.title.value, "Samsung Galaxy A15 128GB Usado");
    assert.match(review.description.value, /Estado: usado/);
    assert.equal(review.price.origin, "seller");
    assert.equal(review.price.value, 825);

    const filled = Object.fromEntries(review.attributes.filled.map(item => [item.id, item.value_name]));
    assert.equal(filled.BRAND, "Samsung");
    assert.equal(filled.ITEM_CONDITION, "Usado");

    // Operadora é exigida e não pode ser inventada: fica pendente.
    assert.ok(review.attributes.pending.some(item => item.id === "CARRIER"));
    assert.equal(review.ready_to_publish, false);
    assert.ok(review.blocked_by.some(text => /atributo/.test(text)));
});

test("publicar sem aprovação explícita é recusado", async () => {
    const { stubs, itemStub, calls } = makeStubs();
    const { seller } = load(stubs, itemStub);

    await assert.rejects(
        () => seller.publish({ productId: 901, approve: false }),
        error => error.code === "ML_APPROVAL_REQUIRED" && error.status === 428
    );

    assert.equal(calls.publishItem, 0);
    assert.equal(calls.upload, 0);
});

test("publicação aprovada valida, envia foto uma vez e retorna link e ID", async () => {
    const { stubs, itemStub, calls } = makeStubs();
    const { seller } = load(stubs, itemStub);

    const result = await seller.publish({
        productId: 901,
        approve: true,
        overrides: {
            title: "Samsung Galaxy A15 128GB Usado",
            description: "Descrição aprovada",
            sale_price: 800,
            condition: "used"
        },
        identification: { brand: "Samsung", model: "Galaxy A15", color: "Preto" },
        attributeOverrides: [
            { id: "CARRIER", value_id: "1", value_name: "Desbloqueado" }
        ]
    });

    assert.equal(calls.update, 1, "o cadastro do produto deve persistir o que foi aprovado");
    assert.equal(calls.validate, 1);
    assert.equal(calls.upload, 1);
    assert.equal(calls.publishItem, 1);
    assert.equal(result.published, true);
    assert.equal(result.item_id, "MLB9999999999");
    assert.match(result.permalink, /mercadolivre\.com\.br/);
    assert.equal(calls.saved.ml.id, "MLB9999999999");
    assert.equal(calls.description, 1);

    // Overrides chegam ao item.service no formato aceito.
    assert.deepEqual(calls.buildOverrides, [
        { id: "CARRIER", value_id: "1", value_name: "Desbloqueado" }
    ]);
});

test("dry run não envia fotos nem cria anúncio", async () => {
    const { stubs, itemStub, calls } = makeStubs();
    const { seller } = load(stubs, itemStub);

    const result = await seller.publish({
        productId: 901,
        approve: true,
        dryRun: true,
        overrides: { title: "Samsung Galaxy A15", sale_price: 800, condition: "used" }
    });

    assert.equal(result.dryRun, true);
    assert.equal(result.published, false);
    assert.equal(calls.upload, 0);
    assert.equal(calls.publishItem, 0);
    assert.equal(calls.validate, 0);
    assert.equal(result.item.category_id, "MLB1055");
});

test("validação do ML com atributo faltando vira pedido de informação, sem publicar", async () => {
    const validationError = new Error("missing");
    validationError.response = {
        status: 400,
        data: {
            cause: [{ code: "item.attribute.missing_required", message: "The attributes [CARRIER] are required" }]
        }
    };

    const { stubs, itemStub, calls } = makeStubs({ throwsOnValidate: validationError });
    const { seller } = load(stubs, itemStub);

    await assert.rejects(
        () => seller.publish({
            productId: 901,
            approve: true,
            overrides: { title: "Samsung Galaxy A15", sale_price: 800, condition: "used" }
        }),
        error => error.code === "ML_MISSING_ATTRIBUTES" && error.missing.some(item => item.id === "CARRIER")
    );

    assert.equal(calls.publishItem, 0);
    assert.equal(calls.upload, 0);
});

test("produto já publicado não é publicado de novo", async () => {
    const { stubs, itemStub, calls } = makeStubs();
    stubs["../productService"].getById = async () => ({
        id: 901,
        title: "x",
        sale_price: 10,
        ml_item_id: "MLB1",
        ml_permalink: "https://produto.mercadolivre.com.br/MLB-1",
        ml_status: "active"
    });

    const { publish } = load(stubs, itemStub);

    await assert.rejects(
        () => publish.publishSellerListing({ productId: 901, dryRun: true }),
        error => error.status === 409 && error.ml.id === "MLB1"
    );

    assert.equal(calls.publishItem, 0);
});
