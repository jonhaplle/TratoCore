// Testes HTTP: 409 PRODUTOS_DUPLICADOS em GET /interview e POST /answers.
//
// Sobe um servidor Express real com o router montado e stubs em
// require.cache. Sem banco real, sem dados de produção.
const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const fs = require("node:fs");
const path = require("node:path");

const RAIZ = path.join(__dirname, "..", "..");
const { comIsolamento, criarStorageIsolado } = require("./__testIsolation");

// Storage exclusivo deste arquivo: isola os fixtures do diretório global,
// que outros testes varrem em paralelo.
const STORAGE = criarStorageIsolado("httpdup");
const ALBUMS = path.join(STORAGE, "tratocap", "albums");
const selo = () => Date.now() + "-" + Math.random().toString(36).slice(2, 7);

const TOKEN = "dispositivo-teste-valido-1234567890";

// ------------------------------------------------------------------
// Servidor com stubs
// ------------------------------------------------------------------

async function comServidor(opcoes, acao) {
    const {
        linhasDoBanco = [],
        produtos = {},
        criarAlbumEm = null
    } = opcoes || {};

    const caminhoDb = require.resolve(path.join(RAIZ, "api", "db.js"));
    const caminhoProduto = require.resolve(path.join(RAIZ, "api", "services", "productService.js"));
    const caminhoDevice = require.resolve(path.join(RAIZ, "api", "services", "tratocapDevice.service.js"));
    const caminhoAlvo = require.resolve(path.join(RAIZ, "api", "routes", "tratocapInterview.js"));

    const anteriores = {};
    for (const [nome, caminho] of Object.entries({
        db: caminhoDb, produto: caminhoProduto, device: caminhoDevice, alvo: caminhoAlvo
    })) {
        anteriores[nome] = require.cache[caminho];
    }

    require.cache[caminhoDb] = {
        id: caminhoDb, filename: caminhoDb, loaded: true,
        exports: { query: async () => ({ rows: linhasDoBanco }) }
    };

    require.cache[caminhoProduto] = {
        id: caminhoProduto, filename: caminhoProduto, loaded: true,
        exports: {
            getById: async (id) => produtos[String(id)] || null,
            update: async (id, dados) => ({ id, ...dados })
        }
    };

    require.cache[caminhoDevice] = {
        id: caminhoDevice, filename: caminhoDevice, loaded: true,
        exports: {
            validarToken: async (token) => (token === TOKEN ? { id: 1, apelido: "Teste" } : null),
            listarDispositivos: async () => [],
            criarCodigoPareamento: async () => ({ codigo: "12345678" }),
            revogarDispositivo: async () => true
        }
    };

    delete require.cache[caminhoAlvo];

    let servidor;

    try {
        const router = await comIsolamento(() => require(caminhoAlvo));

        const app = express();
        app.use(express.json());
        app.use("/api/tratocap", router);

        servidor = app.listen(0);
        await new Promise(r => servidor.once("listening", r));

        const base = `http://127.0.0.1:${servidor.address().port}/api/tratocap`;

        return await acao(base);
    } finally {
        if (servidor) servidor.close();

        for (const [nome, caminho] of Object.entries({
            db: caminhoDb, produto: caminhoProduto, device: caminhoDevice, alvo: caminhoAlvo
        })) {
            if (anteriores[nome]) require.cache[caminho] = anteriores[nome];
            else delete require.cache[caminho];
        }
    }
}

function criarAlbum(album) {
    const dir = path.join(ALBUMS, album);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "foto.jpg"), Buffer.from([0xFF, 0xD8, 0xFF, 0xD9]));
    return dir;
}

function limparAlbum(album) {
    fs.rmSync(path.join(ALBUMS, album), { recursive: true, force: true });
}

const auth = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };

// ==================================================================
// GET /interview — 409 quando há divergência
// ==================================================================

test("GET /interview com 210 e 211 → 409 PRODUTOS_DUPLICADOS", async () => {
    const album = "http-dup-" + selo();
    criarAlbum(album);

    try {
        const resposta = await comServidor(
            {
                linhasDoBanco: [{ imported_product_id: 210 }, { imported_product_id: 211 }],
                produtos: { 210: { id: 210 }, 211: { id: 211 } }
            },
            async (base) => {
                const r = await fetch(`${base}/interview/${encodeURIComponent(album)}`, { headers: auth });
                return { status: r.status, corpo: await r.json() };
            }
        );

        assert.equal(resposta.status, 409, "deve ser 409, não 200 nem 404");
        assert.equal(resposta.corpo.code, "PRODUTOS_DUPLICADOS");
        assert.deepEqual(resposta.corpo.produtos, [210, 211], "lista os dois produtos");
        assert.match(resposta.corpo.error, /reconciliar/);
        assert.ok(!resposta.corpo.perguntas, "não devolve perguntas de um produto escolhido");
    } finally {
        limparAlbum(album);
    }
});

test("GET /interview com produto único → 200 (não regride)", async () => {
    const album = "http-um-" + selo();
    criarAlbum(album);

    try {
        const resposta = await comServidor(
            {
                linhasDoBanco: [{ imported_product_id: 212 }],
                produtos: { 212: { id: 212, title: "Isqueiro" } }
            },
            async (base) => {
                const r = await fetch(`${base}/interview/${encodeURIComponent(album)}`, { headers: auth });
                return { status: r.status, corpo: await r.json() };
            }
        );

        // 200 ou um erro de revisão — o importante é NÃO ser 409.
        assert.notEqual(resposta.status, 409, "produto único não é divergência");
    } finally {
        limparAlbum(album);
    }
});

// ==================================================================
// POST /answers — 409 quando há divergência
// ==================================================================

test("POST /answers com 210 e 211 → 409 PRODUTOS_DUPLICADOS", async () => {
    const album = "http-dup-resp-" + selo();
    criarAlbum(album);

    try {
        const resposta = await comServidor(
            {
                linhasDoBanco: [{ imported_product_id: 210 }, { imported_product_id: 211 }],
                produtos: { 210: { id: 210 }, 211: { id: 211 } }
            },
            async (base) => {
                const r = await fetch(`${base}/answers`, {
                    method: "POST",
                    headers: auth,
                    body: JSON.stringify({
                        album,
                        respostas: [{ atributo_id: "BRAND", valor: "Marca X" }]
                    })
                });
                return { status: r.status, corpo: await r.json() };
            }
        );

        assert.equal(resposta.status, 409, "não deve gravar em produto arbitrário");
        assert.equal(resposta.corpo.code, "PRODUTOS_DUPLICADOS");
        assert.deepEqual(resposta.corpo.produtos, [210, 211]);
    } finally {
        limparAlbum(album);
    }
});

test("POST /answers sem produto → 404 (não regride)", async () => {
    const album = "http-sem-prod-" + selo();
    criarAlbum(album);

    try {
        const resposta = await comServidor(
            { linhasDoBanco: [], produtos: {} },
            async (base) => {
                const r = await fetch(`${base}/answers`, {
                    method: "POST",
                    headers: auth,
                    body: JSON.stringify({
                        album,
                        respostas: [{ atributo_id: "BRAND", valor: "Marca X" }]
                    })
                });
                return { status: r.status, corpo: await r.json() };
            }
        );

        assert.equal(resposta.status, 404, "sem produto continua 404");
        assert.equal(resposta.corpo.code, "PRODUTO_NAO_ENCONTRADO");
    } finally {
        limparAlbum(album);
    }
});

// ==================================================================
// Autenticação continua exigida
// ==================================================================

test("GET /interview sem token → 401 (não regride)", async () => {
    const album = "http-sem-auth-" + selo();
    criarAlbum(album);

    try {
        const status = await comServidor(
            { linhasDoBanco: [], produtos: {} },
            async (base) => (await fetch(`${base}/interview/${encodeURIComponent(album)}`)).status
        );

        assert.equal(status, 401);
    } finally {
        limparAlbum(album);
    }
});

test("POST /answers sem token → 401 (não regride)", async () => {
    const album = "http-sem-auth2-" + selo();
    criarAlbum(album);

    try {
        const status = await comServidor(
            { linhasDoBanco: [], produtos: {} },
            async (base) => (await fetch(`${base}/answers`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ album, respostas: [{ atributo_id: "BRAND", valor: "X" }] })
            })).status
        );

        assert.equal(status, 401);
    } finally {
        limparAlbum(album);
    }
});
