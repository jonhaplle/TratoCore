// Testes: o Vendedor Automático exige embalagem na publicação (ME2).
const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

const publishPath = require.resolve("./publishVendedor.service");

function load(stubs, itemStub) {
    const originalLoad = Module._load;
    delete require.cache[publishPath];

    Module._load = function (request, parent, isMain) {
        if (parent?.filename === publishPath) {
            if (request === "../ml/item.service") return itemStub;
            if (Object.hasOwn(stubs, request)) return stubs[request];
        }
        return originalLoad.call(this, request, parent, isMain);
    };

    try {
        return require(publishPath);
    } finally {
        Module._load = originalLoad;
    }
}

function stubsBase(optionsRecebidas) {
    return {
        "../productService": {
            async getById() {
                return {
                    id: 1,
                    title: "Samsung Galaxy A16 5G",
                    sale_price: 999,
                    quantity: 1,
                    condition: "used",
                    brand: "Samsung",
                    model: "Galaxy A16 5G",
                    ml_item_id: null
                };
            }
        },
        "../productImageService": {
            async getByProductId() {
                return [{ original_url: "/storage/originals/f.jpg", file_name: "f.jpg" }];
            }
        },
        "../ml/api.service": {
            async getAccessToken() { return "token"; },
            async getMe() { return { id: 1 }; },
            async getShippingPreferences() { return { modes: ["me2"] }; }
        },
        "../ml/mlProduct.service": { async savePublication() {} },
        "../ml/publicationSpec.service": {
            async resolve() {
                return {
                    category_id: "MLB1055",
                    category: { id: "MLB1055", name: "Celulares", settings: { max_title_length: 60 } },
                    listing_type: { id: "gold_pro" },
                    attributes: [],
                    conditionalAttributes: { required_attributes: [] },
                    prediction: { attributes: [] }
                };
            }
        },
        "../ml/similarPackageReference.service": {
            async findPackageReference() { return { found: false, reason: "search_failed" }; }
        }
    };
}

test("publicação do Vendedor Automático liga requirePackageDimensions", async () => {
    const opcoes = [];
    const itemStub = {
        async build(product, pictures, spec, overrides, shipping, options) {
            opcoes.push(options);
            return { category_id: "MLB1055", attributes: [], pictures: [] };
        },
        async uploadPictures() { return [{ id: "PIC" }]; }
    };

    const publish = load(stubsBase(opcoes), itemStub);

    await publish.publishSellerListing({ productId: 1, dryRun: true });

    assert.equal(opcoes.length, 1);
    assert.equal(
        opcoes[0].requirePackageDimensions,
        true,
        "sem isto o ML recusa com missing.seller.package.dimensions"
    );
    assert.equal(opcoes[0].skipPictureUpload, true);
});

test("dry run continua não enviando fotos nem criando anúncio", async () => {
    let uploads = 0;
    let publicados = 0;

    const itemStub = {
        async build() { return { category_id: "MLB1055", attributes: [], pictures: [] }; },
        async uploadPictures() { uploads += 1; return [{ id: "PIC" }]; }
    };

    const stubs = stubsBase([]);
    stubs["../ml/api.service"].publishItem = async () => { publicados += 1; };

    const publish = load(stubs, itemStub);
    const resultado = await publish.publishSellerListing({ productId: 1, dryRun: true });

    assert.equal(uploads, 0, "dry run não envia fotos");
    assert.equal(publicados, 0, "dry run não cria anúncio");
    assert.equal(resultado.published, false);
});
