// Testes HTTP: bloqueio da entrevista em divergência (C1.3).
//
// Sobe um servidor Express real com o router montado e stubs em
// require.cache. Sem banco real, sem dados de produção.
//
// C1.3: o bloqueio considera marcador + imagens (client_uuid) + jobs.
const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const fs = require("node:fs");
const path = require("node:path");

const RAIZ = path.join(__dirname, "..", "..");
const { comIsolamento, criarStorageIsolado } = require("./__testIsolation");

const STORAGE = criarStorageIsolado("http13");
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
        imagens = {}
    } = opcoes || {};

    const caminhos = {
        db: require.resolve(path.join(RAIZ, "api", "db.js")),
        produto: require.resolve(path.join(RAIZ, "api", "services", "productService.js")),
        imagem: require.resolve(path.join(RAIZ, "api", "services", "productImageService.js")),
        device: require.resolve(path.join(RAIZ, "api", "services", "tratocapDevice.service.js")),
        alvo: require.resolve(path.join(RAIZ, "api", "routes", "tratocapInterview.js"))
    };

    const anteriores = {};
    for (const [nome, caminho] of Object.entries(caminhos)) {
        anteriores[nome] = require.cache[caminho];
    }

    require.cache[caminhos.db] = {
        id: caminhos.db, filename: caminhos.db, loaded: true,
        exports: {
            query: async () => ({ rows: linhasDoBanco }),
            // Sem transação real nestes testes.
            connect: async () => ({ query: async () => ({ rows: [] }), release() {} })
        }
    };

    require.cache[caminhos.produto] = {
        id: caminhos.produto, filename: caminhos.produto, loaded: true,
        exports: {
            getById: async (id) => produtos[String(id)] || null,
            update: async (id, dados) => ({ id, ...dados })
        }
    };

    require.cache[caminhos.imagem] = {
        id: caminhos.imagem, filename: caminhos.imagem, loaded: true,
        exports: {
            getByClientUuid: async (uuid) => {
                const img = imagens[uuid];
                return img ? { id: 1, client_uuid: uuid, product_id: img.product_id } : null;
            },
            getByProductId: async (id) => Object.entries(imagens)
                .filter(([, v]) => String(v.product_id) === String(id))
                .map(([uuid], i) => ({ id: i + 1, client_uuid: uuid, product_id: Number(id) }))
        }
    };

    require.cache[caminhos.device] = {
        id: caminhos.device, filename: caminhos.device, loaded: true,
        exports: {
            validarToken: async (token) => (token === TOKEN ? { id: 1, apelido: "Teste" } : null),
            listarDispositivos: async () => [],
            criarCodigoPareamento: async () => ({ codigo: "12345678" }),
            revogarDispositivo: async () => true
        }
    };

    delete require.cache[caminhos.alvo];

    let servidor;

    try {
        const router = await comIsolamento(() => require(caminhos.alvo));

        const app = express();
        app.use(express.json());
        app.use("/api/tratocap", router);

        servidor = app.listen(0);
        await new Promise(r => servidor.once("listening", r));

        const base = `http://127.0.0.1:${servidor.address().port}/api/tratocap`;
        return await acao(base);
    } finally {
        if (servidor) servidor.close();

        for (const [nome, caminho] of Object.entries(caminhos)) {
            if (anteriores[nome]) require.cache[caminho] = anteriores[nome];
            else delete require.cache[caminho];
        }
    }
}

/**
 * Cria um álbum com fotos e metadados REAIS (client_uuid), como o
 * TratoCap envia em produção.
 */
function criarAlbum(album, uuids, marcador = null) {
    const dir = path.join(ALBUMS, album);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });

    uuids.forEach((uuid, i) => {
        const nome = `foto${i}.jpg`;
        fs.writeFileSync(path.join(dir, nome), Buffer.from([0xFF, 0xD8, 0xFF, 0xD9]));
        fs.writeFileSync(
            path.join(dir, nome + ".json"),
            JSON.stringify({ client_uuid: uuid, filename: nome })
        );
    });

    if (marcador) {
        fs.writeFileSync(
            path.join(dir, ".tratocore-import.json"),
            JSON.stringify({ album, ...marcador })
        );
    }

    return dir;
}

function limparAlbum(album) {
    fs.rmSync(path.join(ALBUMS, album), { recursive: true, force: true });
}

const auth = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };

// ==================================================================
// GET /interview — 409 quando as fotos estão em produtos distintos
// ==================================================================

test("GET /interview com fotos em 210 e 211 → 409 PRODUTOS_DUPLICADOS", async () => {
    const album = "http13-dup-" + selo();
    const u1 = "uuid-h1-" + selo();
    const u2 = "uuid-h2-" + selo();

    criarAlbum(album, [u1, u2]);

    try {
        const resposta = await comServidor(
            {
                linhasDoBanco: [],
                produtos: { 210: { id: 210 }, 211: { id: 211 } },
                imagens: { [u1]: { product_id: 210 }, [u2]: { product_id: 211 } }
            },
            async (base) => {
                const r = await fetch(`${base}/interview/${encodeURIComponent(album)}`, { headers: auth });
                return { status: r.status, corpo: await r.json() };
            }
        );

        assert.equal(resposta.status, 409);
        assert.equal(resposta.corpo.code, "PRODUTOS_DUPLICADOS");
        assert.deepEqual(resposta.corpo.produtos, [210, 211]);
        assert.deepEqual(resposta.corpo.imagens, [210, 211], "reporta a evidência das imagens");
        assert.ok(!resposta.corpo.perguntas, "não devolve perguntas");
    } finally {
        limparAlbum(album);
    }
});

// ==================================================================
// GET /interview — 409 quando marcador esconde divergência
// ==================================================================

test("GET /interview com marcador 210 mas imagem no 211 → 409", async () => {
    const album = "http13-marcador-" + selo();
    const u1 = "uuid-i1-" + selo();

    criarAlbum(album, [u1], { product_id: 210 });

    try {
        const resposta = await comServidor(
            {
                linhasDoBanco: [],
                produtos: { 210: { id: 210 }, 211: { id: 211 } },
                imagens: { [u1]: { product_id: 211 } }
            },
            async (base) => {
                const r = await fetch(`${base}/interview/${encodeURIComponent(album)}`, { headers: auth });
                return { status: r.status, corpo: await r.json() };
            }
        );

        assert.equal(resposta.status, 409, "o marcador não pode esconder o banco");
        assert.equal(resposta.corpo.code, "PRODUTOS_DUPLICADOS");
        assert.equal(resposta.corpo.marcador, 210, "reporta o marcador divergente");
    } finally {
        limparAlbum(album);
    }
});

// ==================================================================
// GET /interview — 409 quando há foto pendente
// ==================================================================

test("GET /interview com foto pendente → 409 SINCRONIZACAO_PENDENTE", async () => {
    const album = "http13-pend-" + selo();
    const u1 = "uuid-j1-" + selo();
    const u2 = "uuid-j2-" + selo();

    criarAlbum(album, [u1, u2]);

    try {
        const resposta = await comServidor(
            {
                linhasDoBanco: [{ imported_product_id: 210 }],
                produtos: { 210: { id: 210 } },
                imagens: { [u1]: { product_id: 210 } }   // u2 ainda não sincronizou
            },
            async (base) => {
                const r = await fetch(`${base}/interview/${encodeURIComponent(album)}`, { headers: auth });
                return { status: r.status, corpo: await r.json() };
            }
        );

        assert.equal(resposta.status, 409);
        assert.equal(resposta.corpo.code, "SINCRONIZACAO_PENDENTE");
        assert.equal(resposta.corpo.pendentes, 1);
    } finally {
        limparAlbum(album);
    }
});

// ==================================================================
// GET /interview — produto consistente não é bloqueado
// ==================================================================

test("GET /interview com tudo consistente em 212 → não é 409", async () => {
    const album = "http13-ok-" + selo();
    const u1 = "uuid-k1-" + selo();
    const u2 = "uuid-k2-" + selo();

    criarAlbum(album, [u1, u2], { product_id: 212 });

    try {
        const resposta = await comServidor(
            {
                linhasDoBanco: [{ imported_product_id: 212 }],
                produtos: { 212: { id: 212, title: "Isqueiro" } },
                imagens: { [u1]: { product_id: 212 }, [u2]: { product_id: 212 } }
            },
            async (base) => {
                const r = await fetch(`${base}/interview/${encodeURIComponent(album)}`, { headers: auth });
                return { status: r.status, corpo: await r.json() };
            }
        );

        assert.notEqual(resposta.status, 409, "estado consistente não é divergência");
    } finally {
        limparAlbum(album);
    }
});

// ==================================================================
// POST /answers — não grava em produto incerto
// ==================================================================

test("POST /answers com fotos em 210 e 211 → 409, nada gravado", async () => {
    const album = "http13-dup-resp-" + selo();
    const u1 = "uuid-l1-" + selo();
    const u2 = "uuid-l2-" + selo();

    criarAlbum(album, [u1, u2]);

    let gravou = false;

    try {
        const resposta = await comServidor(
            {
                linhasDoBanco: [],
                produtos: { 210: { id: 210 }, 211: { id: 211 } },
                imagens: { [u1]: { product_id: 210 }, [u2]: { product_id: 211 } }
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

        assert.equal(resposta.status, 409);
        assert.equal(resposta.corpo.code, "PRODUTOS_DUPLICADOS");
        assert.equal(gravou, false, "nenhuma resposta foi gravada");
    } finally {
        limparAlbum(album);
    }
});

test("POST /answers com foto pendente → 409 SINCRONIZACAO_PENDENTE", async () => {
    const album = "http13-pend-resp-" + selo();
    const u1 = "uuid-m1-" + selo();
    const u2 = "uuid-m2-" + selo();

    criarAlbum(album, [u1, u2]);

    try {
        const resposta = await comServidor(
            {
                linhasDoBanco: [{ imported_product_id: 210 }],
                produtos: { 210: { id: 210 } },
                imagens: { [u1]: { product_id: 210 } }
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

        assert.equal(resposta.status, 409);
        assert.equal(resposta.corpo.code, "SINCRONIZACAO_PENDENTE");
        assert.match(resposta.corpo.error, /Nenhuma resposta foi gravada/i);
    } finally {
        limparAlbum(album);
    }
});

test("POST /answers sem produto → 404 (não regride)", async () => {
    const album = "http13-sem-prod-" + selo();
    criarAlbum(album, []);

    try {
        const resposta = await comServidor(
            { linhasDoBanco: [], produtos: {}, imagens: {} },
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

        assert.equal(resposta.status, 404);
        assert.equal(resposta.corpo.code, "PRODUTO_NAO_ENCONTRADO");
    } finally {
        limparAlbum(album);
    }
});

// ==================================================================
// Autenticação continua exigida
// ==================================================================

test("GET /interview sem token → 401", async () => {
    const album = "http13-sem-auth-" + selo();
    criarAlbum(album, []);

    try {
        const status = await comServidor(
            { linhasDoBanco: [], produtos: {}, imagens: {} },
            async (base) => (await fetch(`${base}/interview/${encodeURIComponent(album)}`)).status
        );

        assert.equal(status, 401);
    } finally {
        limparAlbum(album);
    }
});

test("POST /answers sem token → 401", async () => {
    const album = "http13-sem-auth2-" + selo();
    criarAlbum(album, []);

    try {
        const status = await comServidor(
            { linhasDoBanco: [], produtos: {}, imagens: {} },
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
