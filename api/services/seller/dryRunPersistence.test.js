// Testes: dry-run nunca altera o banco; publicação real persiste só após sucesso.
const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

const servicePath = require.resolve("./sellerListing.service");

const PRODUTO_ORIGINAL = {
    id: 900,
    title: "Título ANTIGO do cadastro",
    description: "Descrição ANTIGA do cadastro",
    sale_price: 500,
    quantity: 1,
    condition: "used",
    brand: "",
    model: "",
    line: "",
    color: "",
    ml_item_id: null
};

function montarStubs({ publicarFalha = false, validacaoFalha = false } = {}) {
    // Simula o banco: update registra a chamada e altera o estado.
    const banco = { ...PRODUTO_ORIGINAL };
    const chamadas = { update: [], build: 0 };

    const stubs = {
        "../productService": {
            async getById() { return { ...banco }; },
            async update(id, dados) {
                chamadas.update.push({ id, dados });
                Object.assign(banco, dados);
                return { ...banco };
            }
        },
        "../productImageService": {
            async getByProductId() {
                return [{ original_url: "/storage/originals/f.jpg", file_name: "f.jpg" }];
            }
        },
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
        "../ml/api.service": {
            async getAccessToken() { return "token"; },
            async getMe() { return { id: 1 }; },
            async getShippingPreferences() { return { modes: ["custom"] }; },
            async validateItem() {
                if (validacaoFalha) {
                    const erro = new Error("Atributos obrigatórios");
                    erro.code = "ML_MISSING_ATTRIBUTES";
                    erro.status = 422;
                    erro.missing = [{ id: "BRAND", name: "Marca" }];
                    throw erro;
                }
                return {};
            },
            async publishItem() {
                if (publicarFalha) {
                    const erro = new Error("Mercado Livre recusou");
                    erro.response = { status: 400, data: { cause: [{ code: "item.invalid" }] } };
                    throw erro;
                }
                return {
                    id: "MLB777",
                    permalink: "https://produto.mercadolivre.com.br/MLB-777",
                    status: "active"
                };
            },
            async createDescription() { return { ok: true }; }
        },
        "../ml/mlProduct.service": { async savePublication() {} },
        "../ml/priceReference.service": {
            async reference() { return { suggested: null, explanation: [], sources: [], references: [] }; }
        },
        "../ml/similarPackageReference.service": {
            async findPackageReference() { return { found: false, reason: "search_failed" }; }
        }
    };

    const itemStub = {
        async build() {
            chamadas.build += 1;
            return { category_id: "MLB1055", price: 999, attributes: [], pictures: [] };
        },
        async uploadPictures() { return [{ id: "PIC" }]; }
    };

    return { stubs, itemStub, chamadas, banco };
}

function carregar(stubs, itemStub) {
    const publishPath = require.resolve("./publishVendedor.service");
    const originalLoad = Module._load;
    delete require.cache[servicePath];
    delete require.cache[publishPath];

    Module._load = function (request, parent, isMain) {
        if (parent?.filename === servicePath && Object.hasOwn(stubs, request)) return stubs[request];
        if (parent?.filename === publishPath) {
            if (request === "../ml/item.service") return itemStub;
            if (Object.hasOwn(stubs, request)) return stubs[request];
        }
        return originalLoad.call(this, request, parent, isMain);
    };

    try {
        return require(servicePath);
    } finally {
        Module._load = originalLoad;
    }
}

const OVERRIDES = {
    title: "Samsung Galaxy A16 5G Usado",
    description: "Descrição NOVA aprovada",
    sale_price: 1999,
    condition: "used"
};

test("dry-run NÃO altera o banco", async () => {
    const { stubs, itemStub, chamadas, banco } = montarStubs();
    const seller = carregar(stubs, itemStub);

    const antes = { ...banco };
    const resultado = await seller.publish({ productId: 900, approve: true, dryRun: true, overrides: OVERRIDES });

    assert.equal(chamadas.update.length, 0, "nenhum update no dry-run");
    assert.deepEqual(banco, antes, "o registro permanece idêntico");
    assert.equal(resultado.persisted, false);
});

test("dry-run preserva título, descrição, preço e demais campos", async () => {
    const { stubs, itemStub, banco } = montarStubs();
    const seller = carregar(stubs, itemStub);

    const antes = {
        title: banco.title,
        description: banco.description,
        sale_price: banco.sale_price,
        quantity: banco.quantity,
        brand: banco.brand,
        model: banco.model,
        color: banco.color
    };

    await seller.publish({ productId: 900, approve: true, dryRun: true, overrides: OVERRIDES });

    assert.deepEqual({
        title: banco.title,
        description: banco.description,
        sale_price: banco.sale_price,
        quantity: banco.quantity,
        brand: banco.brand,
        model: banco.model,
        color: banco.color
    }, antes);
});

test("sem aprovação não publica e não persiste", async () => {
    const { stubs, itemStub, chamadas } = montarStubs();
    const seller = carregar(stubs, itemStub);

    await assert.rejects(
        () => seller.publish({ productId: 900, approve: false, dryRun: false, overrides: OVERRIDES }),
        /aprovação do vendedor é obrigatória/i
    );

    assert.equal(chamadas.update.length, 0, "nada persistido sem aprovação");
    assert.equal(chamadas.build, 0, "nem chegou a montar o anúncio");
});

test("publicação real persiste depois do sucesso", async () => {
    const { stubs, itemStub, chamadas, banco } = montarStubs();
    const seller = carregar(stubs, itemStub);

    const resultado = await seller.publish({ productId: 900, approve: true, dryRun: false, overrides: OVERRIDES });

    assert.equal(chamadas.update.length, 1, "persistiu exatamente uma vez");
    assert.equal(banco.title, "Samsung Galaxy A16 5G Usado");
    assert.equal(Number(banco.sale_price), 1999);
    assert.equal(banco.description, "Descrição NOVA aprovada");
    assert.equal(resultado.persisted, true);
    assert.equal(resultado.item_id, "MLB777");
});

test("falha de validação não deixa o cadastro parcialmente atualizado", async () => {
    const { stubs, itemStub, chamadas, banco } = montarStubs({ validacaoFalha: true });
    const seller = carregar(stubs, itemStub);

    const antes = { ...banco };

    await assert.rejects(() => seller.publish({ productId: 900, approve: true, dryRun: false, overrides: OVERRIDES }));

    assert.equal(chamadas.update.length, 0, "nenhum update quando a validação falha");
    assert.deepEqual(banco, antes, "cadastro intacto");
});

test("falha de publicação não deixa o cadastro parcialmente atualizado", async () => {
    const { stubs, itemStub, chamadas, banco } = montarStubs({ publicarFalha: true });
    const seller = carregar(stubs, itemStub);

    const antes = { ...banco };

    await assert.rejects(() => seller.publish({ productId: 900, approve: true, dryRun: false, overrides: OVERRIDES }));

    assert.equal(chamadas.update.length, 0, "nenhum update quando o ML recusa");
    assert.deepEqual(banco, antes, "cadastro intacto");
});

test("dry-run não envia fotos nem cria anúncio", async () => {
    const { stubs, itemStub } = montarStubs();
    let uploads = 0;
    let publicados = 0;

    const itemOriginal = itemStub.build;
    itemStub.build = async (...args) => { return itemOriginal(...args); };
    itemStub.uploadPictures = async () => { uploads += 1; return [{ id: "PIC" }]; };
    stubs["../ml/api.service"].publishItem = async () => { publicados += 1; return { id: "X" }; };

    const seller = carregar(stubs, itemStub);
    const r = await seller.publish({ productId: 900, approve: true, dryRun: true, overrides: OVERRIDES });

    assert.equal(uploads, 0);
    assert.equal(publicados, 0);
    assert.equal(r.published, false);
});
