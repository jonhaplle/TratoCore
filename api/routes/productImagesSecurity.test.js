// Testes de segurança das rotas de imagens de produto.
//
// Escritas exigem a chave administrativa; leituras continuam públicas.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const RAIZ = path.join(__dirname, "..", "..");
const ROTAS = fs.readFileSync(path.join(RAIZ, "api", "routes", "productImages.js"), "utf8");
const pub = (n) => fs.readFileSync(path.join(RAIZ, "public", n), "utf8");

const CHAVE = "chave-teste-imagens-123456";

function fakeRes() {
    return {
        statusCode: null,
        corpo: null,
        headers: {},
        set(k, v) { this.headers[k] = v; return this; },
        status(c) { this.statusCode = c; return this; },
        json(b) { this.corpo = b; return this; }
    };
}

function fakeReq({ header = "", body = {} } = {}) {
    return {
        body,
        get(n) { return String(n).toLowerCase() === "authorization" ? header : undefined; }
    };
}

function comChave(valor, fn) {
    const anterior = process.env.TRATO_VENDEDOR_ADMIN_KEY;
    if (valor === undefined) delete process.env.TRATO_VENDEDOR_ADMIN_KEY;
    else process.env.TRATO_VENDEDOR_ADMIN_KEY = valor;
    try { return fn(); } finally {
        if (anterior === undefined) delete process.env.TRATO_VENDEDOR_ADMIN_KEY;
        else process.env.TRATO_VENDEDOR_ADMIN_KEY = anterior;
    }
}

const requireAdminKey = require(path.join(RAIZ, "api", "middleware", "publishKeyAuth"));

// ==================================================================
// Escrita sem chave -> 401
// ==================================================================

test("escrita sem chave retorna 401", () => {
    comChave(CHAVE, () => {
        const res = fakeRes();
        let passou = false;

        requireAdminKey(fakeReq({ body: {} }), res, () => { passou = true; });

        assert.equal(passou, false);
        assert.equal(res.statusCode, 401);
        assert.equal(res.corpo.code, "UNAUTHORIZED");
    });
});

test("chave incorreta retorna 401", () => {
    comChave(CHAVE, () => {
        const res = fakeRes();
        let passou = false;

        requireAdminKey(fakeReq({ header: "Bearer chave-errada" }), res, () => { passou = true; });

        assert.equal(passou, false);
        assert.equal(res.statusCode, 401);
    });
});

test("escrita com chave válida é autorizada", () => {
    comChave(CHAVE, () => {
        const res = fakeRes();
        let passou = false;

        requireAdminKey(fakeReq({ header: `Bearer ${CHAVE}`, body: {} }), res, () => { passou = true; });

        assert.equal(passou, true);
        assert.equal(res.statusCode, null);
    });
});

test("sem chave configurada no servidor: 503 (falha fechada)", () => {
    comChave(undefined, () => {
        const res = fakeRes();
        let passou = false;

        requireAdminKey(fakeReq({ body: {} }), res, () => { passou = true; });

        assert.equal(passou, false);
        assert.equal(res.statusCode, 503);
        assert.equal(res.corpo.code, "ADMIN_KEY_NOT_CONFIGURED");
    });
});

// ==================================================================
// Rotas: quem exige chave e quem não
// ==================================================================

test("POST /api/product-images exige chave", () => {
    assert.match(ROTAS, /router\.post\("\/", requireAdminKey, ProductImageController\.create\)/);
});

test("PUT /main/:imageId exige chave", () => {
    const trecho = ROTAS.substring(
        ROTAS.indexOf('"/product/:productId/main/:imageId"') - 60,
        ROTAS.indexOf('"/product/:productId/main/:imageId"') + 80
    );
    assert.match(trecho, /requireAdminKey/);
});

test("PUT /selection exige chave", () => {
    const trecho = ROTAS.substring(
        ROTAS.indexOf('"/product/:productId/selection"') - 60,
        ROTAS.indexOf('"/product/:productId/selection"') + 80
    );
    assert.match(trecho, /requireAdminKey/);
});

test("DELETE /:id exige chave", () => {
    const trecho = ROTAS.substring(
        ROTAS.indexOf('router.delete('),
        ROTAS.indexOf('router.delete(') + 120
    );
    assert.match(trecho, /requireAdminKey/);
});

test("GET /product/:productId continua público", () => {
    const trecho = ROTAS.substring(
        ROTAS.indexOf('"/product/:productId"') - 40,
        ROTAS.indexOf('"/product/:productId"') + 60
    );
    assert.ok(!/requireAdminKey/.test(trecho), "leitura não deve exigir chave");
});

test("GET /product/:productId/main continua público", () => {
    const trecho = ROTAS.substring(
        ROTAS.indexOf('"/product/:productId/main"') - 40,
        ROTAS.indexOf('"/product/:productId/main"') + 60
    );
    assert.ok(!/requireAdminKey/.test(trecho));
});

test("GET /drive/:fileId continua público (imagens do anúncio)", () => {
    const trecho = ROTAS.substring(
        ROTAS.indexOf('"/drive/:fileId"') - 40,
        ROTAS.indexOf('"/drive/:fileId"') + 60
    );
    assert.ok(!/requireAdminKey/.test(trecho));
});

test("todas as rotas de escrita estão protegidas", () => {
    const escritas = ROTAS.match(/router\.(post|put|delete)\(/g) || [];
    const protegidas = ROTAS.match(/router\.(post|put|delete)\([\s\S]{0,80}?requireAdminKey/g) || [];

    assert.equal(protegidas.length, escritas.length,
        `escritas: ${escritas.length}, protegidas: ${protegidas.length}`);
});

// ==================================================================
// TratoCap — usa o service diretamente, não a rota
// ==================================================================

test("TratoCap cria imagens via ProductImageService (não pela rota HTTP)", () => {
    const importacao = fs.readFileSync(
        path.join(RAIZ, "api", "services", "tratocapImport.service.js"), "utf8"
    );

    assert.match(importacao, /ProductImageService\.create\(/);
    assert.ok(!importacao.includes("/api/product-images"),
        "a importação não deve chamar a rota HTTP");
});

test("a rota do TratoCap também usa o service", () => {
    const tratocap = fs.readFileSync(
        path.join(RAIZ, "api", "routes", "tratocap.js"), "utf8"
    );

    assert.match(tratocap, /ProductImageService\.create\(/);
});

// ==================================================================
// Frontend envia a chave
// ==================================================================

test("app.js envia a chave no POST de imagem", () => {
    const js = pub("app.js");

    // Localiza a chamada fetch que usa API_PRODUCT_IMAGES como URL
    // (a primeira ocorrência é só a declaração da constante).
    const chamada = /fetch\(\s*API_PRODUCT_IMAGES,([\s\S]{0,300})/.exec(js);
    assert.ok(chamada, "chamada fetch(API_PRODUCT_IMAGES, ...) deve existir");

    const bloco = chamada[1];

    assert.match(bloco, /method: "POST"/);
    assert.match(bloco, /headers: cabecalhosComChave\(\)/);
});

test("produto.js envia a chave no PUT de seleção", () => {
    const js = pub("produto.js");

    const chamada = /fetch\(`\/api\/product-images\/product\/[^`]*\/selection`,([\s\S]{0,400})/.exec(js);
    assert.ok(chamada, "fetch do endpoint /selection deve existir");

    const bloco = chamada[1];

    assert.match(bloco, /method: "PUT"/);
    // A chave aparece como propriedade (com ou sem aspas).
    assert.match(bloco, /"?Authorization"?\s*:\s*`Bearer \$\{chave\}`/);
});

test("produto.html tem campo de chave administrativa", () => {
    const html = pub("produto.html");

    assert.match(html, /id="adminKey"/);
    assert.match(html, /type="password"/);
    assert.match(html, /autocomplete="off"/);
});

test("produto.js avisa antes de chamar o servidor sem chave", () => {
    assert.match(pub("produto.js"), /Informe a chave administrativa para salvar/);
});

// ==================================================================
// A chave nunca vai para storage
// ==================================================================

test("SEGURANÇA: produto.js não grava a chave em storage", () => {
    const js = pub("produto.js")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^[ \t]*\/\/.*$/gm, "");

    assert.ok(!/(localStorage|sessionStorage)\.setItem\([^)]*chave/i.test(js));
});

test("SEGURANÇA: middleware não devolve a chave", () => {
    const fonte = fs.readFileSync(
        path.join(RAIZ, "api", "middleware", "publishKeyAuth.js"), "utf8"
    );

    assert.ok(!/json\([^)]*esperada/.test(fonte));
});

// ==================================================================
// Rotas de leitura do proxy de teste continuam funcionando
// ==================================================================

test("proxy existente de imagens do Drive permanece intacto", () => {
    assert.match(ROTAS, /getFileMetadata/);
    assert.match(ROTAS, /getFileStream/);
    assert.match(ROTAS, /createProductImagesRouter/);
});
