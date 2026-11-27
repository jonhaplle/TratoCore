// Testes de `resolverProdutoDoAlbum` — resolução determinística do produto.
//
// Cobre os 5 cenários exigidos e prova que a divergência entre dois produtos
// NUNCA resulta em escolha arbitrária.
//
// Carrega o módulo REAL `api/routes/tratocapInterview.js` com stubs de
// `../db` e `../services/productService` ativos durante todo o `await`.
// Sem banco real, sem dados de produção.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const RAIZ = path.join(__dirname, "..", "..");
const { comIsolamento, criarStorageIsolado } = require("./__testIsolation");

// Storage exclusivo deste arquivo: isola os fixtures do diretório global,
// que outros testes varrem em paralelo.
const STORAGE = criarStorageIsolado("resolver");
const ALBUMS = path.join(STORAGE, "tratocap", "albums");

const selo = () => Date.now() + "-" + Math.random().toString(36).slice(2, 7);

// ------------------------------------------------------------------
// Stubs em require.cache
//
// O módulo faz `require("../db")` DENTRO de `resolverProdutoDoAlbum`, ou
// seja, a resolução acontece na chamada — não no carregamento. O cache
// precisa permanecer trocado durante todo o `await`.
// ------------------------------------------------------------------

async function comStubs(opcoes, acao) {
    const { linhasDoBanco = [], produtos = {}, falharBanco = false } = opcoes || {};

    const caminhoDb = require.resolve(path.join(RAIZ, "api", "db.js"));
    const caminhoProduto = require.resolve(path.join(RAIZ, "api", "services", "productService.js"));
    const caminhoAlvo = require.resolve(path.join(RAIZ, "api", "routes", "tratocapInterview.js"));

    const anteriores = {
        db: require.cache[caminhoDb],
        produto: require.cache[caminhoProduto],
        alvo: require.cache[caminhoAlvo]
    };

    require.cache[caminhoDb] = {
        id: caminhoDb,
        filename: caminhoDb,
        loaded: true,
        exports: {
            query: async () => {
                if (falharBanco) throw new Error("tabela inexistente");
                return { rows: linhasDoBanco };
            }
        }
    };

    require.cache[caminhoProduto] = {
        id: caminhoProduto,
        filename: caminhoProduto,
        loaded: true,
        exports: {
            getById: async (id) => produtos[String(id)] || null
        }
    };

    delete require.cache[caminhoAlvo];

    try {
        const mod = await comIsolamento(() => require(caminhoAlvo));
        return await acao(mod);
    } finally {
        if (anteriores.db) require.cache[caminhoDb] = anteriores.db;
        else delete require.cache[caminhoDb];

        if (anteriores.produto) require.cache[caminhoProduto] = anteriores.produto;
        else delete require.cache[caminhoProduto];

        if (anteriores.alvo) require.cache[caminhoAlvo] = anteriores.alvo;
        else delete require.cache[caminhoAlvo];
    }
}

function criarMarcador(album, conteudo) {
    const dir = path.join(ALBUMS, album);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });

    if (conteudo !== undefined) {
        fs.writeFileSync(
            path.join(dir, ".tratocore-import.json"),
            typeof conteudo === "string" ? conteudo : JSON.stringify(conteudo)
        );
    }

    return dir;
}

function limparAlbum(album) {
    fs.rmSync(path.join(ALBUMS, album), { recursive: true, force: true });
}

// ==================================================================
// 1 — Nenhum produto encontrado
// ==================================================================

test("resolverProdutoDoAlbum: sem marcador e sem jobs → null", async () => {
    const album = "res-zero-" + selo();
    criarMarcador(album);

    try {
        const r = await comStubs({ linhasDoBanco: [] }, (mod) => mod.resolverProdutoDoAlbum(album));
        assert.equal(r, null, "nenhum produto deve ser resolvido");
    } finally {
        limparAlbum(album);
    }
});

test("resolverProdutoDoAlbum: id existe no banco mas produto foi removido → null", async () => {
    const album = "res-orfao-" + selo();
    criarMarcador(album);

    try {
        const r = await comStubs(
            { linhasDoBanco: [{ imported_product_id: 999 }], produtos: {} },
            (mod) => mod.resolverProdutoDoAlbum(album)
        );
        assert.equal(r, null);
    } finally {
        limparAlbum(album);
    }
});

// ==================================================================
// 2 — Um produto encontrado
// ==================================================================

test("resolverProdutoDoAlbum: um único job → devolve o produto", async () => {
    const album = "res-um-" + selo();
    criarMarcador(album);

    try {
        const r = await comStubs(
            {
                linhasDoBanco: [{ imported_product_id: 212 }],
                produtos: { 212: { id: 212, title: "Isqueiro" } }
            },
            (mod) => mod.resolverProdutoDoAlbum(album)
        );

        assert.ok(r.produto, "deve devolver o produto");
        assert.equal(r.produto.id, 212);
        assert.equal(r.erro, undefined);
    } finally {
        limparAlbum(album);
    }
});

// ==================================================================
// 3 — Dois produtos encontrados
// ==================================================================

test("resolverProdutoDoAlbum: dois jobs → divergência, SEM escolher", async () => {
    const album = "res-dois-" + selo();
    criarMarcador(album);

    try {
        const r = await comStubs(
            {
                linhasDoBanco: [{ imported_product_id: 211 }, { imported_product_id: 210 }],
                produtos: { 210: { id: 210 }, 211: { id: 211 } }
            },
            (mod) => mod.resolverProdutoDoAlbum(album)
        );

        assert.equal(r.erro, "produtos_duplicados", "deve reportar divergência");
        assert.equal(r.produto, undefined, "NÃO devolve um produto escolhido");
        assert.deepEqual(r.produtos, [210, 211], "lista ordenada e completa");
    } finally {
        limparAlbum(album);
    }
});

test("resolverProdutoDoAlbum: ordem dos jobs no banco NÃO altera o resultado", async () => {
    const album = "res-ordem-" + selo();
    criarMarcador(album);

    try {
        const r1 = await comStubs(
            {
                linhasDoBanco: [{ imported_product_id: 211 }, { imported_product_id: 210 }],
                produtos: { 210: { id: 210 }, 211: { id: 211 } }
            },
            (mod) => mod.resolverProdutoDoAlbum(album)
        );

        const r2 = await comStubs(
            {
                linhasDoBanco: [{ imported_product_id: 210 }, { imported_product_id: 211 }],
                produtos: { 210: { id: 210 }, 211: { id: 211 } }
            },
            (mod) => mod.resolverProdutoDoAlbum(album)
        );

        assert.deepEqual(r1.produtos, r2.produtos, "mesma lista independente da ordem");
        assert.equal(r1.erro, r2.erro);
    } finally {
        limparAlbum(album);
    }
});

test("resolverProdutoDoAlbum: três produtos também divergem", async () => {
    const album = "res-tres-" + selo();
    criarMarcador(album);

    try {
        const r = await comStubs(
            {
                linhasDoBanco: [
                    { imported_product_id: 3 },
                    { imported_product_id: 1 },
                    { imported_product_id: 2 }
                ],
                produtos: { 1: {}, 2: {}, 3: {} }
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
// 4 — Marcador válido tem precedência
// ==================================================================

test("resolverProdutoDoAlbum: marcador válido tem precedência sobre o banco", async () => {
    const album = "res-marcador-" + selo();
    criarMarcador(album, { album, product_id: 210, imported_at: "2026-11-24T00:00:00.000Z" });

    try {
        const r = await comStubs(
            {
                linhasDoBanco: [{ imported_product_id: 999 }],
                produtos: { 210: { id: 210, title: "Produto 01" }, 999: { id: 999 } }
            },
            (mod) => mod.resolverProdutoDoAlbum(album)
        );

        assert.equal(r.produto.id, 210, "marcador vence");
        assert.equal(r.erro, undefined, "sem divergência — marcador decidiu");
    } finally {
        limparAlbum(album);
    }
});

// ==================================================================
// 5 — Marcador inválido cai para o banco
// ==================================================================

test("resolverProdutoDoAlbum: marcador corrompido cai para a consulta no banco", async () => {
    const album = "res-corrompido-" + selo();
    criarMarcador(album, "{ nao e json");

    try {
        const r = await comStubs(
            { linhasDoBanco: [{ imported_product_id: 212 }], produtos: { 212: { id: 212 } } },
            (mod) => mod.resolverProdutoDoAlbum(album)
        );

        assert.equal(r.produto.id, 212, "usa o banco quando o marcador é ilegível");
    } finally {
        limparAlbum(album);
    }
});

test("resolverProdutoDoAlbum: marcador com product_id inválido cai para o banco", async () => {
    const album = "res-id-invalido-" + selo();
    criarMarcador(album, { album, product_id: "abc" });

    try {
        const r = await comStubs(
            { linhasDoBanco: [{ imported_product_id: 210 }], produtos: { 210: { id: 210 } } },
            (mod) => mod.resolverProdutoDoAlbum(album)
        );

        assert.equal(r.produto.id, 210);
    } finally {
        limparAlbum(album);
    }
});

test("resolverProdutoDoAlbum: marcador apontando para produto inexistente cai para o banco", async () => {
    const album = "res-marcador-orfao-" + selo();
    criarMarcador(album, { album, product_id: 555 });

    try {
        const r = await comStubs(
            { linhasDoBanco: [{ imported_product_id: 212 }], produtos: { 212: { id: 212 } } },
            (mod) => mod.resolverProdutoDoAlbum(album)
        );

        assert.equal(r.produto.id, 212);
    } finally {
        limparAlbum(album);
    }
});

// ==================================================================
// Divergência 210/211 — NUNCA escolha arbitrária
// ==================================================================

test("resolverProdutoDoAlbum: nunca escolhe entre 210 e 211", async () => {
    const album = "res-nunca-" + selo();
    criarMarcador(album);

    try {
        const r = await comStubs(
            {
                linhasDoBanco: [{ imported_product_id: 210 }, { imported_product_id: 211 }],
                produtos: { 210: { id: 210 }, 211: { id: 211 } }
            },
            (mod) => mod.resolverProdutoDoAlbum(album)
        );

        assert.equal(r.erro, "produtos_duplicados");
        assert.ok(!r.produto, "não retorna produto algum");
        assert.ok(r.produtos.includes(210) && r.produtos.includes(211));
    } finally {
        limparAlbum(album);
    }
});

test("encontrarProdutoDoAlbum: devolve null quando há divergência", async () => {
    const album = "res-encontrar-" + selo();
    criarMarcador(album);

    try {
        const produto = await comStubs(
            {
                linhasDoBanco: [{ imported_product_id: 210 }, { imported_product_id: 211 }],
                produtos: { 210: { id: 210 }, 211: { id: 211 } }
            },
            (mod) => mod.encontrarProdutoDoAlbum(album)
        );

        assert.equal(produto, null, "divergência nunca vira um produto escolhido");
    } finally {
        limparAlbum(album);
    }
});

// ==================================================================
// Banco indisponível
// ==================================================================

test("resolverProdutoDoAlbum: banco indisponível devolve null (sem marcador)", async () => {
    const album = "res-sem-banco-" + selo();
    criarMarcador(album);

    try {
        const r = await comStubs({ falharBanco: true }, (mod) => mod.resolverProdutoDoAlbum(album));
        assert.equal(r, null, "sem banco e sem marcador não há como resolver");
    } finally {
        limparAlbum(album);
    }
});

// ==================================================================
// A query NÃO usa LIMIT (auditoria)
// ==================================================================

test("a consulta de jobs NÃO usa LIMIT 1", () => {
    const fonte = fs.readFileSync(
        path.join(RAIZ, "api", "routes", "tratocapInterview.js"), "utf8"
    );

    const inicio = fonte.indexOf("async function resolverProdutoDoAlbum");
    const fim = fonte.indexOf("async function encontrarProdutoDoAlbum");

    assert.ok(inicio > 0 && fim > inicio, "função não localizada");

    const bloco = fonte.slice(inicio, fim);

    assert.ok(!/LIMIT\s+1/i.test(bloco), "a consulta não pode limitar a 1 linha");
    assert.match(bloco, /DISTINCT imported_product_id/);
    assert.match(bloco, /sort\(/, "ids devem ser ordenados (determinístico)");
});
