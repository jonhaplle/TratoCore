// Testes de C1 — middleware distingue falha de infraestrutura de credencial inválida.
//
// Antes: exceção em validarToken caía no catch, o fluxo continuava e
// respondia como "credencial inválida" (ou 503 ATIVACAO_PENDENTE).
// Agora: exceção => 503 VERIFICACAO_INDISPONIVEL, sem descartar o token.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const FONTE = fs.readFileSync(path.join(__dirname, "tratocapInterview.js"), "utf8");

/** Espelha a decisão do requireSyncKey com dependências injetadas. */
async function classificar({ credencial = "", validarToken, syncKey = "" } = {}) {
    if (!credencial) {
        return { status: 401, code: "UNAUTHORIZED" };
    }

    try {
        const dispositivo = await validarToken(credencial);
        if (dispositivo) {
            return { status: 200, modo: "dispositivo", dispositivo };
        }
    } catch (error) {
        return { status: 503, code: "VERIFICACAO_INDISPONIVEL" };
    }

    if (syncKey && syncKey === credencial) {
        return { status: 200, modo: "chave_compartilhada" };
    }

    return { status: 401, code: "REVOGADO" };
}

// ------------------------------------------------------------------
// 1. Token válido
// ------------------------------------------------------------------

test("1. token valido retorna 200", async () => {
    const r = await classificar({
        credencial: "token-valido",
        validarToken: async () => ({ id: 1, apelido: "Teste" })
    });

    assert.equal(r.status, 200);
    assert.equal(r.modo, "dispositivo");
});

// ------------------------------------------------------------------
// 2. Token inválido
// ------------------------------------------------------------------

test("2. token invalido retorna 401 REVOGADO", async () => {
    const r = await classificar({
        credencial: "token-invalido",
        validarToken: async () => null
    });

    assert.equal(r.status, 401);
    assert.equal(r.code, "REVOGADO");
});

// ------------------------------------------------------------------
// 3. Banco indisponível durante validarToken
// ------------------------------------------------------------------

test("3. banco indisponivel retorna 503 VERIFICACAO_INDISPONIVEL", async () => {
    const r = await classificar({
        credencial: "token-qualquer",
        validarToken: async () => { throw new Error("connect ECONNREFUSED"); }
    });

    assert.equal(r.status, 503);
    assert.equal(r.code, "VERIFICACAO_INDISPONIVEL");
});

test("3b. excecao NAO vira token invalido", async () => {
    const r = await classificar({
        credencial: "token-qualquer",
        validarToken: async () => { throw new Error("timeout"); }
    });

    assert.notEqual(r.status, 401);
    assert.notEqual(r.code, "REVOGADO");
});

test("3c. falha de banco nao apaga a sessao do vendedor", async () => {
    // O app trata 503 como INDETERMINADO -> token preservado.
    const r = await classificar({
        credencial: "token",
        validarToken: async () => { throw new Error("SSL required"); }
    });

    assert.equal(r.code, "VERIFICACAO_INDISPONIVEL");
    assert.notEqual(r.code, "REVOGADO");
});

// ------------------------------------------------------------------
// 5. Resposta REVOGADO
// ------------------------------------------------------------------

test("5. credencial existente e invalida retorna REVOGADO mesmo sem SYNC_KEY", async () => {
    const r = await classificar({
        credencial: "token-invalido",
        validarToken: async () => null,
        syncKey: ""
    });

    assert.equal(r.status, 401);
    assert.equal(r.code, "REVOGADO");
});

test("5b. chave compartilhada valida continua funcionando", async () => {
    const r = await classificar({
        credencial: "chave-xyz",
        validarToken: async () => null,
        syncKey: "chave-xyz"
    });

    assert.equal(r.status, 200);
    assert.equal(r.modo, "chave_compartilhada");
});

// ------------------------------------------------------------------
// Sem credencial continua 401
// ------------------------------------------------------------------

test("sem credencial retorna 401 UNAUTHORIZED", async () => {
    const r = await classificar({
        credencial: "",
        validarToken: async () => null
    });

    assert.equal(r.status, 401);
    assert.equal(r.code, "UNAUTHORIZED");
});

// ------------------------------------------------------------------
// Estrutura do código: o catch faz return
// ------------------------------------------------------------------

test("C1: o catch do middleware faz return antes do fallback", () => {
    const inicio = FONTE.indexOf("// 1) Token de dispositivo pareado.");
    const trecho = FONTE.substring(inicio, inicio + 1200);

    const catchPos = trecho.indexOf("} catch (error) {");
    assert.ok(catchPos > 0, "deve existir catch");

    const aposCatch = trecho.substring(catchPos, catchPos + 700);

    assert.match(aposCatch, /return res\.status\(503\)/, "catch deve retornar 503");
    assert.match(aposCatch, /VERIFICACAO_INDISPONIVEL/, "código específico");
});

test("C1: autenticação continua obrigatória", () => {
    assert.match(FONTE, /if \(!enviada\)\s*\{[\s\S]{0,120}status\(401\)/);
});

// ------------------------------------------------------------------
// Regressão das rotas protegidas
// ------------------------------------------------------------------

test("regressao: rotas de entrevista continuam protegidas", () => {
    assert.match(FONTE, /router\.get\("\/interview\/:album", requireSyncKey/);
    assert.match(FONTE, /router\.post\("\/answers", requireSyncKey/);
});

test("regressao: pareamento continua publico mas valida codigo", () => {
    assert.match(FONTE, /router\.post\("\/devices\/pair", async/);
    assert.match(FONTE, /CODIGO_INVALIDO/);
});
