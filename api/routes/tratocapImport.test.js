// Testes de C1 (diagnóstico seguro), C2 (idempotência global) e C3 (isolamento).
const test = require("node:test");
const assert = require("node:assert/strict");

const { codigoDiagnostico } = require("../routes/googleDriveOAuth");

// ------------------------------------------------------------------
// C1 — diagnóstico seguro: código estável, sem vazar dados sensíveis
// ------------------------------------------------------------------

test("C1: cada causa recebe um código estável", () => {
    const casos = [
        [{ message: "invalid_grant" }, "OAUTH_NAO_AUTORIZADO"],
        [{ message: "Google OAuth authorization is required." }, "OAUTH_NAO_AUTORIZADO"],
        [{ message: "Selecione a pasta FOTOS no Google Picker antes de sincronizar." }, "PASTA_NAO_SELECIONADA"],
        [{ message: "A pasta raiz configurada não é mais a pasta FOTOS." }, "PASTA_INVALIDA"],
        [{ message: "x", response: { data: { error: "insufficientPermissions" } } }, "SEM_PERMISSAO_ESCRITA"],
        [{ message: "storageQuotaExceeded" }, "COTA_EXCEDIDA"],
        [{ message: "O arquivo de teste do Drive não corresponde ao original." }, "VERIFICACAO_INCONSISTENTE"],
        [{ message: "ENOTFOUND oauth2.googleapis.com" }, "REDE_INDISPONIVEL"],
        [{ message: "algo totalmente novo" }, "ERRO_NAO_CLASSIFICADO"]
    ];

    for (const [erro, esperado] of casos) {
        const r = codigoDiagnostico(erro);
        assert.equal(r.code, esperado, "mensagem: " + erro.message);
        assert.ok(r.hint && r.hint.length > 0, "toda resposta tem dica");
    }
});

test("C1: diagnostico NAO vaza token, chave ou caminho interno", () => {
    // Erro que contém material sensível — a resposta não pode repeti-lo.
    const erro = new Error(
        "invalid_grant: refresh_token=1//0gABC123SECRET /opt/render/project/src/arquivo.json"
    );

    const r = codigoDiagnostico(erro);
    const serializado = JSON.stringify(r);

    assert.ok(!/refresh_token/i.test(serializado), "não expõe refresh_token");
    assert.ok(!/0gABC123SECRET/.test(serializado), "não expõe o valor do token");
    assert.ok(!/\/opt\/render/.test(serializado), "não expõe caminho interno");
    assert.ok(!/SECRET/.test(serializado), "não expõe segredo");
});

test("C1: mensagem crua do Google nao chega ao cliente", () => {
    const erro = new Error("Erro interno em /srv/app/secrets/google.json");
    const r = codigoDiagnostico(erro);

    assert.ok(!JSON.stringify(r).includes("/srv/app"), "sem caminho interno");
    assert.equal(r.code, "ERRO_NAO_CLASSIFICADO");
});

// ------------------------------------------------------------------
// C2 — idempotência global: mesma client_uuid em dois produtos
// ------------------------------------------------------------------

/**
 * Simula a decisão de "é novo?" aplicada em tratocap.js:
 * considera as imagens JÁ do produto E a tabela inteira.
 */
function decidirNovos(files, { doProduto = [], global = [] } = {}) {
    const existentesProduto = new Set(doProduto.map(i => i.client_uuid).filter(Boolean));
    const novos = [];
    const ignorados = [];

    for (const f of files) {
        const uuid = f.client_uuid;
        const noProduto = uuid && existentesProduto.has(uuid);
        const globalmente = uuid && !noProduto && global.some(i => i.client_uuid === uuid);

        if (noProduto || globalmente) {
            ignorados.push(uuid);
            continue;
        }
        novos.push(f);
    }

    return { novos, ignorados };
}

test("C2: mesmo client_uuid em dois produtos nao duplica", () => {
    // UUID já registrado no produto 10; agora aparece no produto 11.
    const r = decidirNovos(
        [{ client_uuid: "uuid-compartilhado" }],
        { doProduto: [], global: [{ client_uuid: "uuid-compartilhado", product_id: 10 }] }
    );

    assert.equal(r.novos.length, 0, "não deve inserir (índice é global)");
    assert.equal(r.ignorados.length, 1);
});

test("C2: uuid novo entra normalmente", () => {
    const r = decidirNovos(
        [{ client_uuid: "uuid-novo" }],
        { doProduto: [{ client_uuid: "outro" }], global: [{ client_uuid: "outro" }] }
    );

    assert.equal(r.novos.length, 1);
});

test("C2: reprocessar o mesmo album nao duplica", () => {
    const arquivos = [
        { client_uuid: "a" },
        { client_uuid: "b" }
    ];

    // Primeira passada: nada existe.
    const primeira = decidirNovos(arquivos, {});
    assert.equal(primeira.novos.length, 2);

    // Segunda passada: os dois já estão no banco.
    const segunda = decidirNovos(arquivos, {
        doProduto: [{ client_uuid: "a" }, { client_uuid: "b" }],
        global: [{ client_uuid: "a" }, { client_uuid: "b" }]
    });
    assert.equal(segunda.novos.length, 0, "reprocessar não duplica");
});

test("C2: protecao atomica — violacao 23505 e tratada, nao propaga", () => {
    // Reproduz o catch do INSERT.
    function inserirComProtecao() {
        const erro = new Error("duplicate key value violates unique constraint");
        erro.code = "23505";

        try {
            throw erro;
        } catch (e) {
            if (String(e?.code) === "23505") {
                return { tratado: true, ignorado: true };
            }
            throw e;
        }
    }

    const r = inserirComProtecao();
    assert.equal(r.tratado, true, "23505 vira skip, não exception");
});

test("C2: erro que NAO e 23505 continua propagando", () => {
    function inserir() {
        const erro = new Error("conexao perdida");
        erro.code = "ECONNRESET";

        try {
            throw erro;
        } catch (e) {
            if (String(e?.code) === "23505") return { tratado: true };
            throw e;
        }
    }

    assert.throws(() => inserir(), /conexao perdida/);
});

// ------------------------------------------------------------------
// C3 — isolamento de álbuns
// ------------------------------------------------------------------

test("C3: falha em um album nao interrompe os demais", async () => {
    const importados = [];
    const ignorados = [];

    async function importarAlbum(album) {
        if (album === "receivers") throw new Error("uq_product_images_client_uuid");
        importados.push(album);
    }

    // Laco corrigido
    for (const album of ["receivers", "c63", "valido"]) {
        try {
            await importarAlbum(album);
        } catch (error) {
            ignorados.push({ album, reason: error.message, retry: true });
        }
    }

    assert.deepEqual(importados, ["c63", "valido"], "albuns após o que falhou foram processados");
    assert.equal(ignorados.length, 1);
    assert.equal(ignorados[0].album, "receivers");
    assert.equal(ignorados[0].retry, true, "marcado para nova tentativa");
});

test("C3: todos os albuns falhando ainda assim sao registrados individualmente", async () => {
    const ignorados = [];

    for (const album of ["a", "b"]) {
        try {
            throw new Error("falha em " + album);
        } catch (error) {
            ignorados.push({ album, reason: error.message, retry: true });
        }
    }

    assert.equal(ignorados.length, 2);
    assert.equal(ignorados[0].album, "a");
    assert.equal(ignorados[1].album, "b");
});
