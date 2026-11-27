// Testes de `resolverProdutoDoAlbum` — resolução DETERMINÍSTICA e CONSISTENTE.
//
// C1.3: o marcador deixou de ter precedência cega. Todas as fontes
// (marcador, imagens por client_uuid, jobs) precisam concordar.
//
// Carrega o módulo REAL `api/routes/tratocapInterview.js` com stubs de
// `../db` e `../services/productService`/`productImageService` ativos
// durante todo o `await`. Sem banco real, sem dados de produção.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const RAIZ = path.join(__dirname, "..", "..");
const { comIsolamento, criarStorageIsolado } = require("./__testIsolation");

// Storage exclusivo deste arquivo (ver __testIsolation.js).
const STORAGE = criarStorageIsolado("resolver13");
const ALBUMS = path.join(STORAGE, "tratocap", "albums");

const selo = () => Date.now() + "-" + Math.random().toString(36).slice(2, 7);

// ------------------------------------------------------------------
// Stubs
// ------------------------------------------------------------------

/**
 * Executa `acao` com stubs de db, productService e productImageService.
 *
 * @param {object} opcoes
 * @param {Array} opcoes.linhasDoBanco linhas de tratocap_sync_jobs
 * @param {object} opcoes.produtos mapa id -> produto
 * @param {object} opcoes.imagens mapa client_uuid -> { product_id }
 * @param {boolean} opcoes.falharBanco
 */
async function comStubs(opcoes, acao) {
    const {
        linhasDoBanco = [],
        produtos = {},
        imagens = {},
        falharBanco = false
    } = opcoes || {};

    const caminhoDb = require.resolve(path.join(RAIZ, "api", "db.js"));
    const caminhoProduto = require.resolve(path.join(RAIZ, "api", "services", "productService.js"));
    const caminhoImagem = require.resolve(path.join(RAIZ, "api", "services", "productImageService.js"));
    const caminhoAlvo = require.resolve(path.join(RAIZ, "api", "routes", "tratocapInterview.js"));

    const caminhos = { db: caminhoDb, produto: caminhoProduto, imagem: caminhoImagem, alvo: caminhoAlvo };
    const anteriores = {};

    for (const [nome, caminho] of Object.entries(caminhos)) {
        anteriores[nome] = require.cache[caminho];
    }

    require.cache[caminhoDb] = {
        id: caminhoDb, filename: caminhoDb, loaded: true,
        exports: {
            query: async () => {
                if (falharBanco) throw new Error("tabela inexistente");
                return { rows: linhasDoBanco };
            }
        }
    };

    require.cache[caminhoProduto] = {
        id: caminhoProduto, filename: caminhoProduto, loaded: true,
        exports: {
            getById: async (id) => produtos[String(id)] || null
        }
    };

    require.cache[caminhoImagem] = {
        id: caminhoImagem, filename: caminhoImagem, loaded: true,
        exports: {
            getByClientUuid: async (uuid) => {
                const img = imagens[uuid];
                return img ? { id: 1, client_uuid: uuid, product_id: img.product_id } : null;
            }
        }
    };

    delete require.cache[caminhoAlvo];

    try {
        const mod = await comIsolamento(() => require(caminhoAlvo));
        return await acao(mod);
    } finally {
        for (const [nome, caminho] of Object.entries(caminhos)) {
            if (anteriores[nome]) require.cache[caminho] = anteriores[nome];
            else delete require.cache[caminho];
        }
    }
}

/**
 * Cria um álbum com as fotos informadas.
 *
 * @param {string} album
 * @param {Array<{uuid: string|null}>} fotos uuid null = foto sem metadados
 * @param {object|null} marcador conteúdo do marcador (null = ausente)
 */
function criarAlbum(album, fotos, marcador = null) {
    const dir = path.join(ALBUMS, album);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });

    fotos.forEach((foto, i) => {
        const nome = `foto${i}.jpg`;
        fs.writeFileSync(path.join(dir, nome), Buffer.from([0xFF, 0xD8, 0xFF, 0xD9]));

        if (foto.uuid !== null) {
            fs.writeFileSync(
                path.join(dir, nome + ".json"),
                JSON.stringify({ client_uuid: foto.uuid })
            );
        }
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

// ==================================================================
// 1 — Marcador correto e banco correto
// ==================================================================

test("marcador correto + banco correto → resolve o produto", async () => {
    const album = "c13-ok-" + selo();
    const u1 = "uuid-a-" + selo();
    const u2 = "uuid-b-" + selo();

    criarAlbum(album, [{ uuid: u1 }, { uuid: u2 }], { product_id: 210 });

    try {
        const r = await comStubs(
            {
                linhasDoBanco: [{ imported_product_id: 210 }],
                produtos: { 210: { id: 210, title: "Produto 01" } },
                imagens: { [u1]: { product_id: 210 }, [u2]: { product_id: 210 } }
            },
            (mod) => mod.resolverProdutoDoAlbum(album)
        );

        assert.ok(r.produto, "deve resolver");
        assert.equal(r.produto.id, 210);
        assert.equal(r.erro, undefined);
    } finally {
        limparAlbum(album);
    }
});

test("sem marcador, mas banco consistente → resolve o produto", async () => {
    const album = "c13-sem-marcador-" + selo();
    const u1 = "uuid-c-" + selo();

    criarAlbum(album, [{ uuid: u1 }]);

    try {
        const r = await comStubs(
            {
                linhasDoBanco: [{ imported_product_id: 212 }],
                produtos: { 212: { id: 212 } },
                imagens: { [u1]: { product_id: 212 } }
            },
            (mod) => mod.resolverProdutoDoAlbum(album)
        );

        assert.equal(r.produto.id, 212);
    } finally {
        limparAlbum(album);
    }
});

// ==================================================================
// 2 — Marcador divergente do banco
// ==================================================================

test("marcador diz 210 mas as imagens estão no 211 → divergência", async () => {
    const album = "c13-marcador-div-" + selo();
    const u1 = "uuid-d-" + selo();

    criarAlbum(album, [{ uuid: u1 }], { product_id: 210 });

    try {
        const r = await comStubs(
            {
                linhasDoBanco: [{ imported_product_id: 211 }],
                produtos: { 210: { id: 210 }, 211: { id: 211 } },
                imagens: { [u1]: { product_id: 211 } }
            },
            (mod) => mod.resolverProdutoDoAlbum(album)
        );

        assert.equal(r.erro, "produtos_duplicados", "marcador não pode esconder o banco");
        assert.ok(!r.produto, "não devolve produto");
        assert.deepEqual(r.produtos, [210, 211], "inclui o do marcador e o do banco");
        assert.equal(r.marcador, 210, "reporta o valor do marcador");
        assert.deepEqual(r.imagens, [211], "reporta o valor das imagens");
    } finally {
        limparAlbum(album);
    }
});

test("marcador aponta para produto que não existe mais → divergência com o banco", async () => {
    const album = "c13-marcador-morto-" + selo();
    const u1 = "uuid-e-" + selo();

    criarAlbum(album, [{ uuid: u1 }], { product_id: 555 });

    try {
        const r = await comStubs(
            {
                linhasDoBanco: [{ imported_product_id: 212 }],
                produtos: { 212: { id: 212 } },     // 555 não existe
                imagens: { [u1]: { product_id: 212 } }
            },
            (mod) => mod.resolverProdutoDoAlbum(album)
        );

        // O marcador cita 555; o banco diz 212. Divergência — não escolher.
        assert.equal(r.erro, "produtos_duplicados");
        assert.deepEqual(r.produtos, [212, 555]);
    } finally {
        limparAlbum(album);
    }
});

// ==================================================================
// 3 — Imagens divididas entre dois produtos
// ==================================================================

test("fotos do álbum em 210 e 211 (caso Produto 01) → divergência", async () => {
    const album = "c13-divididas-" + selo();
    const u1 = "uuid-f1-" + selo();
    const u2 = "uuid-f2-" + selo();

    criarAlbum(album, [{ uuid: u1 }, { uuid: u2 }]);

    try {
        const r = await comStubs(
            {
                linhasDoBanco: [],
                produtos: { 210: { id: 210 }, 211: { id: 211 } },
                imagens: { [u1]: { product_id: 210 }, [u2]: { product_id: 211 } }
            },
            (mod) => mod.resolverProdutoDoAlbum(album)
        );

        assert.equal(r.erro, "produtos_duplicados");
        assert.deepEqual(r.produtos, [210, 211]);
        assert.deepEqual(r.imagens, [210, 211], "as duas fontes de imagem aparecem");
    } finally {
        limparAlbum(album);
    }
});

test("três produtos nas imagens → divergência", async () => {
    const album = "c13-tres-" + selo();
    const us = ["uuid-g1-" + selo(), "uuid-g2-" + selo(), "uuid-g3-" + selo()];

    criarAlbum(album, us.map(u => ({ uuid: u })));

    try {
        const r = await comStubs(
            {
                linhasDoBanco: [],
                produtos: { 1: {}, 2: {}, 3: {} },
                imagens: { [us[0]]: { product_id: 1 }, [us[1]]: { product_id: 2 }, [us[2]]: { product_id: 3 } }
            },
            (mod) => mod.resolverProdutoDoAlbum(album)
        );

        assert.equal(r.erro, "produtos_duplicados");
        assert.deepEqual(r.produtos, [1, 2, 3], "ordenados");
    } finally {
        limparAlbum(album);
    }
});

// ==================================================================
// 4 — Imagem ainda pendente de sincronização
// ==================================================================

test("foto do álbum sem imagem no banco → sincronizacao_pendente", async () => {
    const album = "c13-pendente-" + selo();
    const u1 = "uuid-h1-" + selo();
    const u2 = "uuid-h2-" + selo();

    criarAlbum(album, [{ uuid: u1 }, { uuid: u2 }]);

    try {
        const r = await comStubs(
            {
                linhasDoBanco: [{ imported_product_id: 210 }],
                produtos: { 210: { id: 210 } },
                // u2 ainda não existe no banco.
                imagens: { [u1]: { product_id: 210 } }
            },
            (mod) => mod.resolverProdutoDoAlbum(album)
        );

        assert.equal(r.erro, "sincronizacao_pendente");
        assert.equal(r.pendentes, 1, "uma foto pendente");
        assert.ok(!r.produto, "não decide com informação incompleta");
    } finally {
        limparAlbum(album);
    }
});

test("foto sem metadados (client_uuid ausente) → sincronizacao_pendente", async () => {
    const album = "c13-sem-meta-" + selo();
    const u1 = "uuid-i1-" + selo();

    criarAlbum(album, [{ uuid: u1 }, { uuid: null }]);

    try {
        const r = await comStubs(
            {
                linhasDoBanco: [{ imported_product_id: 210 }],
                produtos: { 210: { id: 210 } },
                imagens: { [u1]: { product_id: 210 } }
            },
            (mod) => mod.resolverProdutoDoAlbum(album)
        );

        assert.equal(r.erro, "sincronizacao_pendente");
        assert.equal(r.pendentes, 1);
    } finally {
        limparAlbum(album);
    }
});

// ==================================================================
// 5 — Jobs com produtos diferentes
// ==================================================================

test("jobs apontando para 210 e 211 → divergência mesmo com marcador 210", async () => {
    const album = "c13-jobs-" + selo();
    const u1 = "uuid-j1-" + selo();

    criarAlbum(album, [{ uuid: u1 }], { product_id: 210 });

    try {
        const r = await comStubs(
            {
                linhasDoBanco: [{ imported_product_id: 210 }, { imported_product_id: 211 }],
                produtos: { 210: { id: 210 }, 211: { id: 211 } },
                imagens: { [u1]: { product_id: 210 } }
            },
            (mod) => mod.resolverProdutoDoAlbum(album)
        );

        assert.equal(r.erro, "produtos_duplicados");
        assert.deepEqual(r.jobs, [210, 211], "reporta os dois jobs");
    } finally {
        limparAlbum(album);
    }
});

// ==================================================================
// 6 — Reinicialização durante a reconciliação
// ==================================================================

test("reinício apagou o marcador mas o banco está consistente → resolve", async () => {
    const album = "c13-reboot-" + selo();
    const u1 = "uuid-k1-" + selo();
    const u2 = "uuid-k2-" + selo();

    // Disco efêmero: fotos sincronizadas, mas sem marcador.
    criarAlbum(album, [{ uuid: u1 }, { uuid: u2 }], null);

    try {
        const r = await comStubs(
            {
                linhasDoBanco: [{ imported_product_id: 212 }],
                produtos: { 212: { id: 212 } },
                imagens: { [u1]: { product_id: 212 }, [u2]: { product_id: 212 } }
            },
            (mod) => mod.resolverProdutoDoAlbum(album)
        );

        assert.equal(r.produto.id, 212, "o banco é durável; o marcador não é necessário");
    } finally {
        limparAlbum(album);
    }
});

test("reinício no meio da reconciliação deixa divergência visível", async () => {
    const album = "c13-reboot-meio-" + selo();
    const u1 = "uuid-l1-" + selo();
    const u2 = "uuid-l2-" + selo();

    // Cenário real do Produto 01: marcador apagado, fotos em produtos distintos.
    criarAlbum(album, [{ uuid: u1 }, { uuid: u2 }], null);

    try {
        const r = await comStubs(
            {
                linhasDoBanco: [{ imported_product_id: 210 }, { imported_product_id: 211 }],
                produtos: { 210: { id: 210 }, 211: { id: 211 } },
                imagens: { [u1]: { product_id: 210 }, [u2]: { product_id: 211 } }
            },
            (mod) => mod.resolverProdutoDoAlbum(album)
        );

        assert.equal(r.erro, "produtos_duplicados");
        assert.deepEqual(r.produtos, [210, 211]);
    } finally {
        limparAlbum(album);
    }
});

// ==================================================================
// 7 — Estados vazios / banco indisponível
// ==================================================================

test("álbum sem fotos e sem jobs → null", async () => {
    const album = "c13-vazio-" + selo();
    criarAlbum(album, []);

    try {
        const r = await comStubs(
            { linhasDoBanco: [], produtos: {}, imagens: {} },
            (mod) => mod.resolverProdutoDoAlbum(album)
        );

        assert.equal(r, null);
    } finally {
        limparAlbum(album);
    }
});

test("banco indisponível → null", async () => {
    const album = "c13-sem-banco-" + selo();
    criarAlbum(album, [{ uuid: "uuid-m-" + selo() }]);

    try {
        const r = await comStubs({ falharBanco: true }, (mod) => mod.resolverProdutoDoAlbum(album));
        assert.equal(r, null);
    } finally {
        limparAlbum(album);
    }
});

test("produto citado existe no banco mas foi removido → null", async () => {
    const album = "c13-orfao-" + selo();
    const u1 = "uuid-n-" + selo();

    criarAlbum(album, [{ uuid: u1 }]);

    try {
        const r = await comStubs(
            {
                linhasDoBanco: [{ imported_product_id: 999 }],
                produtos: {},
                imagens: { [u1]: { product_id: 999 } }
            },
            (mod) => mod.resolverProdutoDoAlbum(album)
        );

        assert.equal(r, null);
    } finally {
        limparAlbum(album);
    }
});

// ==================================================================
// 8 — Auditoria estática
// ==================================================================

test("a consulta de jobs NÃO usa LIMIT 1", () => {
    const fonte = fs.readFileSync(
        path.join(RAIZ, "api", "routes", "tratocapInterview.js"), "utf8"
    );

    const inicio = fonte.indexOf("async function coletarEvidenciaDoAlbum");
    const fim = fonte.indexOf("async function resolverProdutoDoAlbum");

    assert.ok(inicio > 0 && fim > inicio, "função não localizada");

    const bloco = fonte.slice(inicio, fim);

    assert.ok(!/LIMIT\s+1/i.test(bloco), "a consulta não pode limitar a 1 linha");
    assert.match(bloco, /DISTINCT imported_product_id/);
});

test("o marcador NÃO tem retorno antecipado com precedência cega", () => {
    const fonte = fs.readFileSync(
        path.join(RAIZ, "api", "routes", "tratocapInterview.js"), "utf8"
    );

    const inicio = fonte.indexOf("async function resolverProdutoDoAlbum");
    const bloco = fonte.slice(inicio, inicio + 2000);

    // O marcador entra na UNIÃO de fontes, não num `return` precoce.
    assert.ok(!/if \(marcador\) \{\s*return/.test(bloco), "marcador não pode retornar antes da checagem");
    assert.match(bloco, /fontes\.add\(marcador\.product_id\)/, "marcador entra no conjunto de fontes");
});
