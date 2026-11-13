// Testes de autorização da publicação e do CORS.
const test = require("node:test");
const assert = require("node:assert/strict");

const requirePublishKey = require("./publishKeyAuth");

function criarReq({ header, body } = {}) {
    const req = {
        headers: {},
        body: body || {},
        get(nome) {
            const chave = String(nome || "").toLowerCase();
            if (chave === "authorization") return header;
            return this.headers[chave];
        }
    };
    return req;
}

function criarRes() {
    const res = {
        statusCode: 200,
        corpo: null,
        cabecalhos: {},
        set(k, v) { this.cabecalhos[k] = v; return this; },
        status(codigo) { this.statusCode = codigo; return this; },
        json(payload) { this.corpo = payload; return this; }
    };
    return res;
}

function executar({ header, body } = {}) {
    const req = criarReq({ header, body });
    const res = criarRes();
    let avancou = false;

    requirePublishKey(req, res, () => { avancou = true; });

    return { req, res, avancou };
}

const ORIGINAL = process.env.TRATO_VENDEDOR_ADMIN_KEY;

function comChave(valor, fn) {
    if (valor === undefined) delete process.env.TRATO_VENDEDOR_ADMIN_KEY;
    else process.env.TRATO_VENDEDOR_ADMIN_KEY = valor;

    try {
        return fn();
    } finally {
        if (ORIGINAL === undefined) delete process.env.TRATO_VENDEDOR_ADMIN_KEY;
        else process.env.TRATO_VENDEDOR_ADMIN_KEY = ORIGINAL;
    }
}

test("acesso autorizado pelo header Authorization", () => {
    const { avancou, res } = comChave("chave-segura-123", () =>
        executar({ header: "Bearer chave-segura-123" })
    );

    assert.equal(avancou, true);
    assert.equal(res.statusCode, 200);
    assert.equal(res.cabecalhos["Cache-Control"], "no-store");
});

test("acesso autorizado pela chave no corpo (adminKey)", () => {
    const { avancou, req } = comChave("outra-chave", () =>
        executar({ body: { adminKey: "outra-chave", productId: 1 } })
    );

    assert.equal(avancou, true);
    assert.equal(Object.hasOwn(req.body, "adminKey"), false, "chave removida do corpo");
    assert.equal(req.body.productId, 1, "resto do corpo preservado");
});

test("acesso NÃO autorizado retorna 401", () => {
    const { avancou, res } = comChave("chave-certa", () =>
        executar({ header: "Bearer chave-errada" })
    );

    assert.equal(avancou, false);
    assert.equal(res.statusCode, 401);
    assert.equal(res.corpo.code, "UNAUTHORIZED");
    assert.ok(!JSON.stringify(res.corpo).includes("chave-certa"), "não expõe a chave");
});

test("sem chave enviada retorna 401", () => {
    const { avancou, res } = comChave("chave-certa", () => executar({}));

    assert.equal(avancou, false);
    assert.equal(res.statusCode, 401);
});

test("chave ausente no servidor desabilita a publicação (503)", () => {
    const { avancou, res } = comChave(undefined, () =>
        executar({ header: "Bearer qualquer" })
    );

    assert.equal(avancou, false);
    assert.equal(res.statusCode, 503, "falha fechado quando não configurada");
    assert.equal(res.corpo.code, "ADMIN_KEY_NOT_CONFIGURED");
});

test("chave vazia no servidor também falha fechado", () => {
    const { avancou, res } = comChave("", () => executar({ header: "Bearer " }));

    assert.equal(avancou, false);
    assert.notEqual(res.statusCode, 200);
});

test("resposta de erro nunca contém a chave esperada", () => {
    const segredo = "SEGREDO-NAO-DEVE-VAZAR";

    const { res } = comChave(segredo, () => executar({ header: "Bearer errado" }));
    const texto = JSON.stringify(res.corpo);

    assert.ok(!texto.includes(segredo));
    assert.ok(!texto.toLowerCase().includes("segredo"));
});

test("comparação é sensível a maiúsculas e minúsculas", () => {
    const { avancou } = comChave("ChaveCase", () => executar({ header: "Bearer chavecase" }));
    assert.equal(avancou, false, "não deve aceitar variação de caixa");
});

test("CORS: mesma origem e origens configuradas passam; estranhas são recusadas", () => {
    // Reproduz a regra aplicada em api/server.js.
    const origens = ["http://localhost:3000", "http://127.0.0.1:3000"];

    const permitir = origem => {
        if (!origem) return true;
        return origens.includes(String(origem).trim().replace(/\/+$/, ""));
    };

    assert.equal(permitir(undefined), true, "sem Origin (curl/app) passa");
    assert.equal(permitir("http://localhost:3000"), true);
    assert.equal(permitir("https://site-malicioso.example"), false);
    assert.equal(permitir("http://localhost:8080"), false);
    assert.equal(permitir("http://localhost:3000.evil.com"), false, "não aceita sufixo");
});
