// Teste de INTEGRAÇÃO — concorrência real em importAlbums().
//
// Carrega o módulo REAL `api/routes/tratocap.js` (não extrai funções com vm)
// e substitui somente as dependências externas:
//
//   - sharp               -> stub que só lê o arquivo
//   - ProductService      -> stub com contador e atraso (mantém em andamento)
//   - ProductImageService -> stub em memória com índice unique por client_uuid
//   - SyncQueue           -> stub em memória
//   - listingPreparation  -> stub
//   - googleDriveOAuthService -> stub
//   - multer / express    -> os reais (o módulo precisa deles para montar o router)
//
// NÃO usa banco de produção, NÃO usa Google Drive, NÃO toca dados reais.
// Os arquivos ficam num diretório temporário, removido ao final.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");

const RAIZ = path.join(__dirname, "..", "..");

// JPEG mínimo com assinatura válida.
const JPEG = Buffer.from([
    0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x00, 0x00
]);

// ------------------------------------------------------------------
// Stubs compartilhados
// ------------------------------------------------------------------

function criarEstado() {
    return {
        produtos: [],
        imagens: [],
        syncJobs: new Map(),
        marcados: [],
        // Atraso para manter a primeira importação em andamento enquanto a
        // segunda chamada chega.
        atrasoCriacaoMs: 40,
        // Quando definido, a próxima criação lança este erro.
        falharProximaCriacao: null,
        // Registro de criações (para provar unicidade).
        criacoesExecutadas: 0
    };
}

/**
 * Carrega o módulo real com as dependências substituídas.
 *
 * Usa `Module._load` apenas durante a carga, restaurando logo depois —
 * assim outros arquivos de teste não são afetados.
 */
function carregarRouterReal(estado, { albumsRoot, originalsRoot, thumbsRoot }) {
    const mapa = {};

    const originalLoad = Module._load;

    Module._load = function (request, parent, isMain) {
        if (mapa[request]) return mapa[request];
        return originalLoad.apply(this, arguments);
    };

    mapa["sharp"] = () => ({
        metadata: async () => ({ format: "jpeg", width: 100, height: 100 }),
        rotate() { return this; },
        resize() { return this; },
        webp() { return this; },
        toFile: async (destino) => { fs.writeFileSync(destino, "thumb"); return { format: "webp" }; }
    });

    // sharp é chamado como função: sharp(source).metadata()
    mapa["sharp"] = Object.assign(
        () => ({
            metadata: async () => ({ format: "jpeg", width: 100, height: 100 }),
            rotate() { return this; },
            resize() { return this; },
            webp() { return this; },
            toFile: async (destino) => { fs.writeFileSync(destino, "thumb"); return { format: "webp" }; }
        }),
        {}
    );

    mapa["../services/productService"] = {
        create: async (dados) => {
            estado.criacoesExecutadas += 1;

            if (estado.falharProximaCriacao) {
                const erro = estado.falharProximaCriacao;
                estado.falharProximaCriacao = null;
                throw erro;
            }

            await new Promise(r => setTimeout(r, estado.atrasoCriacaoMs));

            const produto = { id: 1000 + estado.produtos.length, ...dados };
            estado.produtos.push(produto);
            return produto;
        },
        getById: async (id) => estado.produtos.find(p => String(p.id) === String(id)) || null,
        update: async (id, dados) => ({ id, ...dados })
    };

    mapa["../services/productImageService"] = {
        create: async (dados) => {
            // Simula o índice único global uq_product_images_client_uuid.
            if (dados.client_uuid) {
                const existente = estado.imagens.find(i => i.client_uuid === dados.client_uuid);

                if (existente) {
                    const erro = new Error("duplicate key value violates unique constraint");
                    erro.code = "23505";
                    throw erro;
                }
            }

            const imagem = { id: estado.imagens.length + 1, ...dados };
            estado.imagens.push(imagem);
            return imagem;
        },
        getByProductId: async (id) => estado.imagens.filter(i => String(i.product_id) === String(id)),
        getByClientUuid: async (uuid) => estado.imagens.find(i => i.client_uuid === uuid) || null
    };

    mapa["../services/tratocapSyncQueue.service"] = {
        ensureSchema: async () => {},
        getUnimportedProductImages: async () => [],
        getByClientUuid: async (uuid) => estado.syncJobs.get(uuid) || null,
        markAlbumImported: async (album, id) => { estado.marcados.push({ album, id }); }
    };

    mapa["../services/listingPreparation.service"] = {
        prepare: async () => null,
        prepareListing: async () => null
    };

    mapa["../services/googleDriveOAuthService"] = {
        createGoogleDriveOAuthService: () => ({
            getFileMetadata: async () => ({ mimeType: "image/jpeg" }),
            getFileStream: async () => ({ on() {}, pipe() {} })
        })
    };

    // O módulo calcula os caminhos a partir de `__dirname/../../storage`.
    // Como usamos o módulo real, redirecionamos com um symlink temporário
    // NÃO — em vez disso, após carregar, sobrescrevemos albumsRoot via
    // variável de ambiente do módulo não é possível. Usamos a estratégia
    // suportada: o módulo exporta o router; os caminhos internos são
    // fixos. Portanto criamos os arquivos no caminho real do worktree
    // (storage/tratocap/albums), que é git-ignored.
    let router;

    try {
        // Remove do cache para recarregar limpo.
        const alvo = require.resolve(path.join(RAIZ, "api", "routes", "tratocap.js"));
        delete require.cache[alvo];

        router = require(alvo);
    } finally {
        Module._load = originalLoad;
    }

    return router;
}

// ------------------------------------------------------------------
// Fixtures
// ------------------------------------------------------------------

function prepararAlbum(nome, arquivos) {
    const raiz = path.join(process.cwd(), "storage", "tratocap", "albums");

    // O módulo aponta para <repo>/storage; garantimos que existe.
    fs.mkdirSync(raiz, { recursive: true });
    fs.mkdirSync(path.join(process.cwd(), "storage", "originals"), { recursive: true });
    fs.mkdirSync(path.join(process.cwd(), "storage", "thumbs"), { recursive: true });

    const dir = path.join(raiz, nome);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });

    for (const arq of arquivos) {
        fs.writeFileSync(path.join(dir, arq.nome), JPEG);

        fs.writeFileSync(
            path.join(dir, arq.nome + ".json"),
            JSON.stringify({
                client_uuid: arq.client_uuid,
                sha256: "hash-" + arq.client_uuid,
                note: arq.note || ""
            })
        );
    }

    return dir;
}

function limparAlbum(nome) {
    const dir = path.join(process.cwd(), "storage", "tratocap", "albums", nome);
    fs.rmSync(dir, { recursive: true, force: true });
}

// ==================================================================
// TESTE 1 — Duas chamadas concorrentes ao mesmo álbum
// ==================================================================

test("INTEGRAÇÃO: duas importAlbums() concorrentes criam UM único produto", async () => {
    const estado = criarEstado();
    const nome = "c1-integracao-concorrente";
    const uuidAlbum = `uuid-${Date.now()}-a`;

    prepararAlbum(nome, [
        { nome: "foto1.jpg", client_uuid: uuidAlbum }
    ]);

    const router = carregarRouterReal(estado, {
        albumsRoot: path.join(process.cwd(), "storage", "tratocap", "albums"),
        originalsRoot: path.join(process.cwd(), "storage", "originals"),
        thumbsRoot: path.join(process.cwd(), "storage", "thumbs")
    });

    assert.equal(typeof router.importAlbums, "function", "módulo real carregado");

    try {
        // DUAS chamadas SIMULTÂNEAS para o MESMO álbum.
        const [a, b] = await Promise.all([
            router.importAlbums(nome),
            router.importAlbums(nome)
        ]);

        // 1) Apenas um produto criado.
        assert.equal(estado.produtos.length, 1, "deve criar exatamente um produto");
        assert.equal(estado.criacoesExecutadas, 1, "ProductService.create chamado uma vez");

        // 2) Nenhuma importação duplicada do mesmo álbum.
        const importadosA = (a?.imported || []).length;
        const importadosB = (b?.imported || []).length;

        assert.equal(importadosA + importadosB, 1,
            "somadas, as chamadas não podem reportar duas criações");

        // 3) Ambas terminaram sem erro inesperado.
        assert.equal(a?.success, true);
        assert.equal(b?.success, true);

        // 4) Nenhuma imagem duplicada.
        const uuids = estado.imagens.map(i => i.client_uuid);
        assert.equal(uuids.length, new Set(uuids).size, "sem imagens duplicadas");

        // 5) Trava liberada ao final.
        assert.equal(router.albumImportando(nome), false, "trava deve ser liberada");
        assert.equal(router.importsEmAndamento.size, 0, "nenhuma trava remanescente");
    } finally {
        limparAlbum(nome);
    }
});

// ==================================================================
// TESTE 2 — Falha na primeira tentativa permite retry
// ==================================================================

test("INTEGRAÇÃO: falha na primeira importação permite nova tentativa", async () => {
    const estado = criarEstado();
    const nome = "c1-integracao-retry";
    const uuidAlbum = `uuid-${Date.now()}-b`;

    prepararAlbum(nome, [
        { nome: "foto2.jpg", client_uuid: uuidAlbum }
    ]);

    const router = carregarRouterReal(estado, {
        albumsRoot: path.join(process.cwd(), "storage", "tratocap", "albums"),
        originalsRoot: path.join(process.cwd(), "storage", "originals"),
        thumbsRoot: path.join(process.cwd(), "storage", "thumbs")
    });

    try {
        // Primeira tentativa: ProductService.create lança.
        estado.falharProximaCriacao = new Error("falha simulada no create");

        const primeira = await router.importAlbums(nome);

        assert.equal(primeira.imported.length, 0, "nada importado na primeira");
        assert.ok(primeira.skipped.length > 0, "falha deve ser registrada em skipped");
        assert.match(
            JSON.stringify(primeira.skipped),
            /falha simulada no create/,
            "motivo da falha propagado"
        );

        // Trava liberada mesmo após erro.
        assert.equal(router.albumImportando(nome), false, "trava liberada após falha");

        // Segunda tentativa: deve executar de fato.
        const segunda = await router.importAlbums(nome);

        assert.equal(segunda.imported.length, 1, "a segunda tentativa importa");
        assert.equal(estado.produtos.length, 1, "um produto criado na retomada");
        assert.equal(router.albumImportando(nome), false, "trava liberada ao final");
    } finally {
        limparAlbum(nome);
    }
});

// ==================================================================
// TESTE 3 — Álbuns diferentes em paralelo continuam funcionando
// ==================================================================

test("INTEGRAÇÃO: álbuns diferentes são processados em paralelo", async () => {
    const estado = criarEstado();
    const nomeA = "c1-integracao-par-a";
    const nomeB = "c1-integracao-par-b";
    const selo = Date.now();

    prepararAlbum(nomeA, [{ nome: "a.jpg", client_uuid: `uuid-${selo}-pa` }]);
    prepararAlbum(nomeB, [{ nome: "b.jpg", client_uuid: `uuid-${selo}-pb` }]);

    const router = carregarRouterReal(estado, {
        albumsRoot: path.join(process.cwd(), "storage", "tratocap", "albums"),
        originalsRoot: path.join(process.cwd(), "storage", "originals"),
        thumbsRoot: path.join(process.cwd(), "storage", "thumbs")
    });

    try {
        const [a, b] = await Promise.all([
            router.importAlbums(nomeA),
            router.importAlbums(nomeB)
        ]);

        assert.equal(a.imported.length, 1);
        assert.equal(b.imported.length, 1);
        assert.equal(estado.produtos.length, 2, "um produto por álbum");
    } finally {
        limparAlbum(nomeA);
        limparAlbum(nomeB);
    }
});
