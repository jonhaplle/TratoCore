// Testes de C1.2 — reconciliação de marcador e detecção de produtos duplicados.
//
// Carrega o módulo REAL api/routes/tratocap.js com dependências externas
// substituídas. Sem banco real, sem Drive, sem dados de produção.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const { comIsolamento, criarStorageIsolado } = require("./__testIsolation");

const RAIZ = path.join(__dirname, "..", "..");
// Storage exclusivo deste arquivo: isola os fixtures do diretório global,
// que outros testes varrem em paralelo.
const STORAGE = criarStorageIsolado("c12");
const ALBUMS = path.join(STORAGE, "tratocap", "albums");

const JPEG = Buffer.from([
    0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x00, 0x00
]);

const selo = () => Date.now() + "-" + Math.random().toString(36).slice(2, 7);

// ------------------------------------------------------------------
// Carregamento com stubs
// ------------------------------------------------------------------

async function carregarRouter(estado) {
    const mapa = {};
    const original = Module._load;

    Module._load = function (r) { return mapa[r] ?? original.apply(this, arguments); };

    mapa["sharp"] = () => ({
        metadata: async () => {
            if (estado.falharSharpAte > 0) {
                estado.falharSharpAte -= 1;
                throw new Error("falha simulada no sharp");
            }
            return { format: "jpeg", width: 10, height: 10 };
        },
        rotate() { return this; },
        resize() { return this; },
        webp() { return this; },
        toFile: async (d) => { fs.writeFileSync(d, "thumb"); return {}; }
    });

    mapa["../services/productService"] = {
        create: async (d) => {
            estado.criacoes = (estado.criacoes || 0) + 1;
            const p = { id: 9000 + estado.produtos.length, ...d };
            estado.produtos.push(p);
            return p;
        },
        getById: async (id) => estado.produtos.find(p => String(p.id) === String(id)) || null,
        update: async (id, d) => ({ id, ...d })
    };

    mapa["../services/productImageService"] = {
        create: async (d) => {
            if (d.client_uuid) {
                const ex = estado.imagens.find(i => i.client_uuid === d.client_uuid);
                if (ex) { const e = new Error("dup"); e.code = "23505"; throw e; }
            }
            const img = { id: estado.imagens.length + 1, ...d };
            estado.imagens.push(img);
            return img;
        },
        getByProductId: async (id) => estado.imagens.filter(i => String(i.product_id) === String(id)),
        getByClientUuid: async (u) => estado.imagens.find(i => i.client_uuid === u) || null
    };

    mapa["../services/tratocapSyncQueue.service"] = {
        ensureSchema: async () => {},
        getUnimportedProductImages: async () => (estado.fila || []).slice(),
        getByClientUuid: async () => null,
        markAlbumImported: async (album, id) => { estado.marcados.push({ album, id }); }
    };

    mapa["../services/listingPreparation.service"] = {
        prepare: async () => ({ status: "ready_for_review" }),
        prepareListing: async () => null
    };

    mapa["../services/googleDriveOAuthService"] = {
        createGoogleDriveOAuthService: () => ({
            getFileMetadata: async () => ({ mimeType: "image/jpeg" }),
            getFileStream: async () => ({ on() {}, pipe() {} })
        })
    };

    let router;

    try {
        const alvo = require.resolve(path.join(RAIZ, "api", "routes", "tratocap.js"));
        delete require.cache[alvo];
        router = await comIsolamento(() => require(alvo));
    } finally {
        Module._load = original;
    }

    return router;
}

function novoEstado() {
    return { produtos: [], imagens: [], marcados: [], fila: [], criacoes: 0, falharSharpAte: 0 };
}

// ------------------------------------------------------------------
// Fixtures
// ------------------------------------------------------------------

/**
 * Cria um álbum. `semMetadados` adiciona fotos que acabaram de chegar:
 * ainda não têm `.json` com `client_uuid` (upload em andamento).
 */
function criarAlbum(nome, uuids, { marcador = null, semMetadados = 0 } = {}) {
    const dir = path.join(ALBUMS, nome);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });

    for (const u of uuids) {
        fs.writeFileSync(path.join(dir, `${u}.jpg`), JPEG);
        fs.writeFileSync(path.join(dir, `${u}.jpg.json`),
            JSON.stringify({ client_uuid: u, sha256: "sha-" + u, note: "" }));
    }

    for (let i = 0; i < semMetadados; i++) {
        fs.writeFileSync(path.join(dir, `recebendo_${i}.jpg`), JPEG);
    }

    if (marcador) {
        fs.writeFileSync(path.join(dir, ".tratocore-import.json"), JSON.stringify(marcador));
    }

    return dir;
}
function limparAlbum(nome) {
    fs.rmSync(path.join(ALBUMS, nome), { recursive: true, force: true });
}

function lerMarcador(nome) {
    const p = path.join(ALBUMS, nome, ".tratocore-import.json");
    if (!fs.existsSync(p)) return null;
    try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch (_) { return "CORROMPIDO"; }
}

// ==================================================================
// CENÁRIO 1 — Álbum sem marcador + 1 produto reconciliado → grava marcador
// ==================================================================

test("C1.2-1: produto reconciliado por client_uuid GRAVA o marcador", async () => {
    const estado = novoEstado();
    const nome = "c12-um-" + selo();
    const u1 = "uuid-c12a-" + selo();

    criarAlbum(nome, [u1]);

    // Produto existe, imagens vinculadas, MAS sem marcador (caso isqueiros).
    estado.produtos.push({ id: 212, title: nome });
    estado.imagens.push({ id: 1, product_id: 212, client_uuid: u1 });

    const router = await carregarRouter(estado);

    try {
        const rel = await router.recuperarAlbunsNoBoot();

        const marcador = lerMarcador(nome);
        assert.ok(marcador, "marcador DEVE ser gravado (C1.2)");
        assert.equal(marcador.product_id, 212);
        assert.equal(marcador.images, 1);
        assert.equal(marcador.new_images, 0);
        assert.equal(marcador.reconciliado, true, "marcado como reconciliado");
        assert.ok(!marcador.pendente, "não é pendente");

        assert.ok(rel.jaVinculados.some(j =>
            j.album === nome && j.produto_id === 212 && j.motivo === "reconciliado e marcador gravado"));

        assert.equal(estado.produtos.length, 1, "não cria produto novo");
        assert.ok(estado.marcados.some(m => m.album === nome && m.id === 212), "SyncQueue marcada");
    } finally {
        limparAlbum(nome);
    }
});

// ==================================================================
// CENÁRIO 2 — Álbum sem marcador + 2 produtos → divergência
// ==================================================================

test("C1.2-2: dois produtos no mesmo álbum → erro, SEM escolher nem gravar marcador", async () => {
    const estado = novoEstado();
    const nome = "c12-dois-" + selo();
    const u1 = "uuid-c12b1-" + selo();
    const u2 = "uuid-c12b2-" + selo();

    criarAlbum(nome, [u1, u2]);

    // Reproduz "Produto 01": foto 1 no produto 210, foto 2 no produto 211.
    estado.produtos.push({ id: 210, title: nome });
    estado.produtos.push({ id: 211, title: nome });
    estado.imagens.push({ id: 1, product_id: 210, client_uuid: u1 });
    estado.imagens.push({ id: 2, product_id: 211, client_uuid: u2 });

    const router = await carregarRouter(estado);

    try {
        const rel = await router.recuperarAlbunsNoBoot();

        const erro = rel.erros.find(e => e.album === nome && e.etapa === "produtos_duplicados");
        assert.ok(erro, "deve registrar produtos_duplicados");
        assert.match(erro.motivo, /210/, "lista o produto 210");
        assert.match(erro.motivo, /211/, "lista o produto 211");
        assert.match(erro.motivo, /reconciliação manual/, "indica ação necessária");

        assert.equal(lerMarcador(nome), null, "NÃO grava marcador — não escolhe arbitrariamente");
        assert.equal(estado.produtos.length, 2, "não cria produto novo");
        assert.equal(estado.marcados.length, 0, "SyncQueue não é marcada");
    } finally {
        limparAlbum(nome);
    }
});

test("C1.2-2b: três produtos no álbum também é divergência", async () => {
    const estado = novoEstado();
    const nome = "c12-tres-" + selo();
    const ids = ["uuid-c12c1-" + selo(), "uuid-c12c2-" + selo(), "uuid-c12c3-" + selo()];

    criarAlbum(nome, ids);

    for (let i = 0; i < 3; i++) {
        estado.produtos.push({ id: 300 + i, title: nome });
        estado.imagens.push({ id: i + 1, product_id: 300 + i, client_uuid: ids[i] });
    }

    const router = await carregarRouter(estado);

    try {
        const rel = await router.recuperarAlbunsNoBoot();

        assert.ok(rel.erros.some(e => e.etapa === "produtos_duplicados" && /3 produtos/.test(e.motivo)));
        assert.equal(lerMarcador(nome), null);
    } finally {
        limparAlbum(nome);
    }
});

// ==================================================================
// CENÁRIO 3 — Álbum sem marcador + 0 produtos → importação normal
// ==================================================================

test("C1.2-3: sem produto e sem marcador → importação normal cria produto e marcador", async () => {
    const estado = novoEstado();
    const nome = "c12-novo-" + selo();
    const u1 = "uuid-c12d-" + selo();

    criarAlbum(nome, [u1]);

    const router = await carregarRouter(estado);

    try {
        const rel = await router.recuperarAlbunsNoBoot();

        assert.equal(estado.produtos.length, 1, "cria um produto");
        assert.equal(estado.imagens.length, 1, "vincula a imagem");

        const marcador = lerMarcador(nome);
        assert.ok(marcador, "marcador gravado pelo fluxo de importação");
        assert.equal(marcador.product_id, estado.produtos[0].id);

        assert.ok(rel.importados.some(i => i.album === nome), "registrado como importado");
    } finally {
        limparAlbum(nome);
    }
});

// ==================================================================
// CENÁRIO 4 — Marcador existente e concluído → não sobrescreve
// ==================================================================

test("C1.2-4: marcador concluído existente NÃO é sobrescrito", async () => {
    const estado = novoEstado();
    const nome = "c12-existe-" + selo();
    const u1 = "uuid-c12e-" + selo();
    const original = {
        album: nome, product_id: 400, images: 1, new_images: 1,
        imported_at: "2026-11-01T00:00:00.000Z", incremental: false
    };

    criarAlbum(nome, [u1], { marcador: original });

    estado.produtos.push({ id: 400, title: nome });
    estado.imagens.push({ id: 1, product_id: 400, client_uuid: u1 });

    const router = await carregarRouter(estado);

    try {
        let importou = 0;
        await router.recuperarAlbunsNoBoot({
            importar: async () => { importou += 1; return { imported: [] }; }
        });

        const marcador = lerMarcador(nome);
        assert.equal(marcador.imported_at, original.imported_at, "imported_at preservado");
        assert.equal(marcador.product_id, 400, "product_id preservado");
        assert.equal(importou, 0, "não importa");
    } finally {
        limparAlbum(nome);
    }
});

// ==================================================================
// CENÁRIO 5 — Marcador pendente → C1.1 preservado
// ==================================================================

test("C1.2-5: marcador pendente continua retomando (C1.1 preservado)", async () => {
    const estado = novoEstado();
    const nome = "c12-pendente-" + selo();
    const u1 = "uuid-c12f-" + selo();

    criarAlbum(nome, [u1], {
        marcador: {
            album: nome, product_id: 500, images: 0, new_images: 0,
            imported_at: new Date().toISOString(), incremental: false, pendente: true
        }
    });

    estado.produtos.push({ id: 500, title: nome });

    const router = await carregarRouter(estado);

    try {
        const rel = await router.recuperarAlbunsNoBoot();

        assert.ok(rel.retomados.some(r => r.album === nome && r.etapa === "retomado"),
            "retomada executada");

        const marcador = lerMarcador(nome);
        assert.ok(!marcador.pendente, "pendente removido");
        assert.equal(marcador.product_id, 500);
        assert.equal(estado.produtos.length, 1, "mesmo produto");
        assert.equal(estado.imagens.length, 1, "imagem vinculada");
    } finally {
        limparAlbum(nome);
    }
});

// ==================================================================
// CENÁRIO 6 — Reconciliação + concorrência
// ==================================================================

test("C1.2-6: recuperações concorrentes gravam o marcador uma vez", async () => {
    const estado = novoEstado();
    const nome = "c12-conc-" + selo();
    const u1 = "uuid-c12g-" + selo();

    criarAlbum(nome, [u1]);

    estado.produtos.push({ id: 600, title: nome });
    estado.imagens.push({ id: 1, product_id: 600, client_uuid: u1 });

    const router = await carregarRouter(estado);

    try {
        await Promise.all([
            router.recuperarAlbunsNoBoot(),
            router.recuperarAlbunsNoBoot()
        ]);

        const marcador = lerMarcador(nome);
        assert.ok(marcador, "marcador gravado");
        assert.equal(marcador.product_id, 600);
        assert.equal(estado.produtos.length, 1, "sem produto novo");
        assert.equal(router.albumImportando(nome), false, "trava liberada");
    } finally {
        limparAlbum(nome);
    }
});

// ==================================================================
// CENÁRIO 7 — Marcador gravado é lido corretamente na próxima execução
// ==================================================================

test("C1.2-7: marcador reconciliado é reconhecido na execução seguinte", async () => {
    const estado = novoEstado();
    const nome = "c12-idempotente-" + selo();
    const u1 = "uuid-c12h-" + selo();

    criarAlbum(nome, [u1]);

    estado.produtos.push({ id: 700, title: nome });
    estado.imagens.push({ id: 1, product_id: 700, client_uuid: u1 });

    const router = await carregarRouter(estado);

    try {
        // 1ª execução: reconcilia e grava o marcador.
        const r1 = await router.recuperarAlbunsNoBoot();

        assert.ok(lerMarcador(nome), "marcador criado na 1ª execução");
        assert.ok(r1.jaVinculados.some(j => j.motivo === "reconciliado e marcador gravado"));

        // 2ª execução: marcador já existe → "marcador presente".
        const r2 = await router.recuperarAlbunsNoBoot();

        assert.ok(r2.jaVinculados.some(j =>
            j.album === nome && j.motivo === "marcador presente"),
            "2ª execução reconhece o marcador");

        assert.equal(estado.produtos.length, 1, "nenhum produto novo");
        assert.equal(estado.criacoes, 0, "ProductService.create nunca chamado");
    } finally {
        limparAlbum(nome);
    }
});

// ==================================================================
// Extra — não escolhe o "primeiro" quando há dois produtos
// ==================================================================

test("extra: ordem das fotos no disco NÃO influencia a decisão", async () => {
    const estado = novoEstado();
    const nome = "c12-ordem-" + selo();
    const u1 = "uuid-c12i1-" + selo();
    const u2 = "uuid-c12i2-" + selo();

    // Foto do 211 vem PRIMEIRO no nome do arquivo.
    criarAlbum(nome, [u1, u2]);

    estado.produtos.push({ id: 210, title: nome });
    estado.produtos.push({ id: 211, title: nome });
    estado.imagens.push({ id: 1, product_id: 210, client_uuid: u1 });
    estado.imagens.push({ id: 2, product_id: 211, client_uuid: u2 });

    const router = await carregarRouter(estado);

    try {
        const rel = await router.recuperarAlbunsNoBoot();

        // Independente da ordem, detecta divergência.
        assert.ok(rel.erros.some(e => e.etapa === "produtos_duplicados"));
        assert.equal(lerMarcador(nome), null, "não escolheu nenhum dos dois");
        assert.equal(estado.marcados.length, 0);
    } finally {
        limparAlbum(nome);
    }
});

// ==================================================================
// C1.3 — condição de corrida: foto em trânsito não pode ser ignorada
// ==================================================================

test("C1.3: foto ainda sem metadados adia a reconciliação (não grava marcador)", async () => {
    const estado = novoEstado();
    const nome = "c13-corrida-" + selo();
    const u1 = "uuid-c13a-" + selo();

    // Uma foto já vinculada ao 210 + uma recém-recebida, sem `.json`.
    criarAlbum(nome, [u1], { semMetadados: 1 });

    estado.produtos.push({ id: 210, title: nome });
    estado.imagens.push({ id: 1, product_id: 210, client_uuid: u1 });

    const router = await carregarRouter(estado);

    try {
        const rel = await router.recuperarAlbunsNoBoot();

        assert.equal(lerMarcador(nome), null, "marcador NÃO pode ser gravado");
        assert.ok(rel.aguardando.some(a => a.album === nome && /sem metadados/.test(a.motivo)),
            "registra que aguarda as fotos em trânsito");
        assert.equal(estado.marcados.length, 0, "SyncQueue não é marcada");
    } finally {
        limparAlbum(nome);
    }
});

test("C1.3: depois que a foto ganha metadados, a reconciliação conclui", async () => {
    const estado = novoEstado();
    const nome = "c13-corrida-ok-" + selo();
    const u1 = "uuid-c13b1-" + selo();
    const u2 = "uuid-c13b2-" + selo();

    criarAlbum(nome, [u1], { semMetadados: 1 });

    estado.produtos.push({ id: 210, title: nome });
    estado.imagens.push({ id: 1, product_id: 210, client_uuid: u1 });

    const router = await carregarRouter(estado);

    try {
        // 1º ciclo: adiado.
        await router.recuperarAlbunsNoBoot();
        assert.equal(lerMarcador(nome), null);

        // A foto em trânsito termina de sincronizar.
        const dir = path.join(ALBUMS, nome);
        fs.writeFileSync(path.join(dir, "recebendo_0.jpg.json"), JSON.stringify({ client_uuid: u2 }));
        estado.imagens.push({ id: 2, product_id: 210, client_uuid: u2 });

        // 2º ciclo: conclui.
        const rel2 = await router.recuperarAlbunsNoBoot();

        const marcador = lerMarcador(nome);
        assert.ok(marcador, "marcador gravado no 2º ciclo");
        assert.equal(marcador.product_id, 210);
        assert.equal(marcador.images, 2, "conta as duas fotos");
        assert.ok(rel2.jaVinculados.some(j => j.album === nome));
    } finally {
        limparAlbum(nome);
    }
});

test("C1.3: reconciliação é idempotente (dois ciclos não duplicam)", async () => {
    const estado = novoEstado();
    const nome = "c13-idem-" + selo();
    const u1 = "uuid-c13c-" + selo();

    criarAlbum(nome, [u1]);

    estado.produtos.push({ id: 212, title: nome });
    estado.imagens.push({ id: 1, product_id: 212, client_uuid: u1 });

    const router = await carregarRouter(estado);

    try {
        await router.recuperarAlbunsNoBoot();
        const primeiro = lerMarcador(nome);

        await router.recuperarAlbunsNoBoot();
        const segundo = lerMarcador(nome);

        assert.equal(primeiro.product_id, segundo.product_id);
        assert.equal(primeiro.imported_at, segundo.imported_at, "marcador não é reescrito");
        assert.equal(estado.produtos.length, 1, "um produto");
        assert.equal(estado.criacoes, 0, "create nunca chamado");
    } finally {
        limparAlbum(nome);
    }
});