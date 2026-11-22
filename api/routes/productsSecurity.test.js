// Testes de segurança e validação da API de produtos.
//
// Cenários T1–T10 da auditoria + proteção da exclusão.
// Os testes de middleware executam o requireAdminKey real; os de
// classificação de erro executam responderErro real.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const RAIZ = path.join(__dirname, "..", "..");
const FONTE_ROTAS = fs.readFileSync(path.join(RAIZ, "api", "routes", "products.js"), "utf8");

// ------------------------------------------------------------------
// Helpers: simulam req/res do Express sem subir servidor.
// ------------------------------------------------------------------

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
        get(nome) {
            return String(nome).toLowerCase() === "authorization" ? header : undefined;
        }
    };
}

const CHAVE = "chave-de-teste-para-validacao-1234";

function comChave(valor, fn) {
    const anterior = process.env.TRATO_VENDEDOR_ADMIN_KEY;
    if (valor === undefined) delete process.env.TRATO_VENDEDOR_ADMIN_KEY;
    else process.env.TRATO_VENDEDOR_ADMIN_KEY = valor;
    try { return fn(); } finally {
        if (anterior === undefined) delete process.env.TRATO_VENDEDOR_ADMIN_KEY;
        else process.env.TRATO_VENDEDOR_ADMIN_KEY = anterior;
    }
}

// ==================================================================
// T1 — POST sem chave → 401
// ==================================================================
test("T1: POST /api/products sem chave retorna 401", () => {
    const requireAdminKey = require(path.join(RAIZ, "api", "middleware", "publishKeyAuth"));

    comChave(CHAVE, () => {
        const res = fakeRes();
        let passou = false;

        requireAdminKey(fakeReq({ body: {} }), res, () => { passou = true; });

        assert.equal(passou, false, "não deve chamar next()");
        assert.equal(res.statusCode, 401);
        assert.equal(res.corpo.code, "UNAUTHORIZED");
    });
});

// ==================================================================
// T2 — POST com chave válida e body {} → 400 (validação, não 500)
// ==================================================================
test("T2: título ausente gera ValidationError com status 400", () => {
    const { ValidationError, responderErro } = require(path.join(RAIZ, "api", "errors"));

    const err = new ValidationError("Título obrigatório.");
    const res = fakeRes();

    responderErro(res, err);

    assert.equal(res.statusCode, 400);
    assert.equal(res.corpo.message, "Título obrigatório.");
    assert.equal(res.corpo.success, false);
});

test("T2b: productService lança ValidationError para título vazio", () => {
    const caminho = path.join(RAIZ, "api", "services", "productService.js");
    const fonte = fs.readFileSync(caminho, "utf8");

    assert.match(fonte, /throw new ValidationError\("Título obrigatório\."\)/);
    assert.ok(!fonte.includes('throw new Error("T'),
        "não deve usar Error genérico para validação");
});

// ==================================================================
// T3 — POST com título, sem chave → 401
// ==================================================================
test("T3: POST com título válido mas sem chave retorna 401", () => {
    const requireAdminKey = require(path.join(RAIZ, "api", "middleware", "publishKeyAuth"));

    comChave(CHAVE, () => {
        const res = fakeRes();
        let passou = false;

        requireAdminKey(
            fakeReq({ body: { title: "Realme C63" } }),
            res,
            () => { passou = true; }
        );

        assert.equal(passou, false);
        assert.equal(res.statusCode, 401);
    });
});

// ==================================================================
// T4 — POST com chave válida → next()
// ==================================================================
test("T4: chave válida autoriza a escrita", () => {
    const requireAdminKey = require(path.join(RAIZ, "api", "middleware", "publishKeyAuth"));

    comChave(CHAVE, () => {
        const res = fakeRes();
        let passou = false;

        requireAdminKey(
            fakeReq({ header: `Bearer ${CHAVE}`, body: { title: "Realme C63" } }),
            res,
            () => { passou = true; }
        );

        assert.equal(passou, true, "deve chamar next()");
        assert.equal(res.statusCode, null);
    });
});

// ==================================================================
// T5 — GET /api/products continua público
// ==================================================================
test("T5: GET / não passa por autenticação", () => {
    assert.match(FONTE_ROTAS, /router\.get\("\/", controller\.getAll\);/);
    assert.ok(!/router\.get\("\/", requireAdminKey/.test(FONTE_ROTAS));
});

// ==================================================================
// T6 — GET /:id continua público
// ==================================================================
test("T6: GET /:id não passa por autenticação", () => {
    assert.match(FONTE_ROTAS, /router\.get\("\/:id", controller\.getById\);/);
});

// ==================================================================
// T7 — DELETE sem chave → 401 (teste obrigatório da missão)
// ==================================================================
test("T7: DELETE /:id exige autenticação", () => {
    assert.match(
        FONTE_ROTAS,
        /router\.delete\("\/:id", requireAdminKey, controller\.remove\);/,
        "DELETE deve usar requireAdminKey"
    );
});

test("T7b: DELETE sem chave é rejeitado pelo middleware", () => {
    const requireAdminKey = require(path.join(RAIZ, "api", "middleware", "publishKeyAuth"));

    comChave(CHAVE, () => {
        const res = fakeRes();
        let passou = false;

        requireAdminKey(fakeReq({}), res, () => { passou = true; });

        assert.equal(passou, false, "exclusão não pode passar sem chave");
        assert.equal(res.statusCode, 401);
    });
});

test("T7c: DELETE com chave errada é rejeitado", () => {
    const requireAdminKey = require(path.join(RAIZ, "api", "middleware", "publishKeyAuth"));

    comChave(CHAVE, () => {
        const res = fakeRes();
        let passou = false;

        requireAdminKey(fakeReq({ header: "Bearer chave-errada" }), res, () => { passou = true; });

        assert.equal(passou, false);
        assert.equal(res.statusCode, 401);
    });
});

// ==================================================================
// T8 — frontend envia a chave
// ==================================================================
test("T8: app.js envia Authorization no POST", () => {
    const fonte = fs.readFileSync(path.join(RAIZ, "public", "app.js"), "utf8");

    assert.match(fonte, /function cabecalhosComChave\(\)/);
    assert.match(fonte, /Authorization": `Bearer \$\{chave\}`/);
    assert.match(fonte, /headers: cabecalhosComChave\(\)/);
});

test("T8b: produtos.js envia Authorization em PUT/DELETE/improve-ai", () => {
    const fonte = fs.readFileSync(path.join(RAIZ, "public", "produtos.js"), "utf8");

    assert.match(fonte, /function cabecalhosEscrita\(\)/);

    const ocorrencias = (fonte.match(/headers: cabecalhosEscrita\(\)/g) || []).length;
    assert.ok(ocorrencias >= 3, `esperado ao menos 3 usos, encontrado ${ocorrencias}`);
});

// ==================================================================
// Segurança: chave nunca vai para storage
// ==================================================================
test("SEGURANÇA: chave não é gravada em localStorage ou sessionStorage", () => {
    for (const arquivo of ["app.js", "produtos.js"]) {
        const fonte = fs.readFileSync(path.join(RAIZ, "public", arquivo), "utf8");

        // Captura qualquer uso de storage ligado à chave.
        const suspeito = /(localStorage|sessionStorage)[^\n]*(adminKey|chaveAdministrativa|chaveAdmin|chave)\b/i;
        assert.ok(!suspeito.test(fonte), `${arquivo}: chave não pode ir para storage`);

        const inverso = /(adminKey|chaveAdministrativa|chaveAdmin)[^\n]*(localStorage|sessionStorage)/i;
        assert.ok(!inverso.test(fonte), `${arquivo}: chave não pode ir para storage`);
    }
});

test("SEGURANÇA: campo da chave é password e sem autocomplete", () => {
    const html = fs.readFileSync(path.join(RAIZ, "public", "index.html"), "utf8");
    const bloco = html.substring(html.indexOf('id="adminKey"') - 300, html.indexOf('id="adminKey"') + 200);

    assert.match(bloco, /type="password"/);
    assert.match(bloco, /autocomplete="off"/);
});

// ==================================================================
// T9 — TratoCap não usa a rota HTTP
// ==================================================================
test("T9: TratoCap usa ProductService direto (não a rota protegida)", () => {
    const fonte = fs.readFileSync(path.join(RAIZ, "api", "routes", "tratocap.js"), "utf8");

    assert.match(fonte, /ProductService\.create\(/, "TratoCap deve usar o service");
    assert.ok(!/fetch\(["'`][^"'`]*\/api\/products/.test(fonte),
        "TratoCap não deve chamar a rota HTTP de produtos");
});

// ==================================================================
// T10 — chave não configurada → 503 (falha fechada)
// ==================================================================
test("T10: servidor sem chave configurada retorna 503", () => {
    const requireAdminKey = require(path.join(RAIZ, "api", "middleware", "publishKeyAuth"));

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
// Classificação de erros
// ==================================================================
test("erro interno continua 500", () => {
    const { responderErro } = require(path.join(RAIZ, "api", "errors"));

    const res = fakeRes();
    responderErro(res, new Error("falha de banco"));

    assert.equal(res.statusCode, 500);
});

test("produto inexistente retorna 404", () => {
    const { NotFoundError, responderErro } = require(path.join(RAIZ, "api", "errors"));

    const res = fakeRes();
    responderErro(res, new NotFoundError("Produto não encontrado."));

    assert.equal(res.statusCode, 404);
    assert.equal(res.corpo.code, "NOT_FOUND");
});

test("controller usa responderErro em todos os handlers", () => {
    const fonte = fs.readFileSync(
        path.join(RAIZ, "api", "controllers", "productsController.js"), "utf8"
    );

    const usos = (fonte.match(/return responderErro\(res, err\);/g) || []).length;
    assert.ok(usos >= 6, `esperado ao menos 6 usos, encontrado ${usos}`);
});

// ==================================================================
// Estrutura: todas as rotas de escrita protegidas
// ==================================================================
test("todas as rotas de escrita usam requireAdminKey", () => {
    for (const rota of [
        'router.post("/", requireAdminKey',
        'router.put("/:id", requireAdminKey',
        'router.delete("/:id", requireAdminKey',
        'router.post("/:id/improve-ai", requireAdminKey',
        'router.post("/:id/prepare-listing", requireAdminKey'
    ]) {
        assert.ok(FONTE_ROTAS.includes(rota), `faltando proteção: ${rota}`);
    }
});

test("a chave não é devolvida em nenhuma resposta", () => {
    const fonte = fs.readFileSync(
        path.join(RAIZ, "api", "middleware", "publishKeyAuth.js"), "utf8"
    );

    // A única menção a `esperada` deve ser no safeEqual, nunca numa resposta.
    assert.ok(!/json\([^)]*esperada/.test(fonte), "a chave não pode aparecer em json()");
});

test("a chave é removida do corpo antes de next()", () => {
    const fonte = fs.readFileSync(
        path.join(RAIZ, "api", "middleware", "publishKeyAuth.js"), "utf8"
    );

    assert.match(fonte, /delete req\.body\.adminKey/);
});
