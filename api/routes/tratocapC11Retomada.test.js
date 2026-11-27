// Testes de C1.1 — retomada automática de álbuns com marcador pendente.
//
// Carrega o módulo REAL api/routes/tratocap.js com dependências externas
// substituídas. Sem banco, sem Drive, sem dados reais.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const { comIsolamento, criarStorageIsolado } = require("./__testIsolation");

const RAIZ = path.join(__dirname, "..", "..");
// Storage exclusivo deste arquivo: isola os fixtures do diretório global,
// que outros testes varrem em paralelo.
const STORAGE = criarStorageIsolado("c11");
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
            const p = { id: 8000 + estado.produtos.length, ...d };
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
    return {
        produtos: [], imagens: [], marcados: [], fila: [],
        criacoes: 0, falharSharpAte: 0
    };
}

// ------------------------------------------------------------------
// Fixtures
// ------------------------------------------------------------------

function criarAlbum(nome, uuids, { marcador = null, marcadorCru = null } = {}) {
    const dir = path.join(ALBUMS, nome);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });

    for (const u of uuids) {
        fs.writeFileSync(path.join(dir, `${u}.jpg`), JPEG);
        fs.writeFileSync(path.join(dir, `${u}.jpg.json`),
            JSON.stringify({ client_uuid: u, sha256: "sha-" + u, note: "" }));
    }

    const markerPath = path.join(dir, ".tratocore-import.json");

    if (marcadorCru !== null) {
        fs.writeFileSync(markerPath, marcadorCru, "utf8");
    } else if (marcador) {
        fs.writeFileSync(markerPath, JSON.stringify(marcador), "utf8");
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

/** Marcador pendente como o C3 grava. */
function marcadorPendente(album, productId) {
    return {
        album,
        product_id: productId,
        images: 0,
        new_images: 0,
        imported_at: new Date().toISOString(),
        incremental: false,
        pendente: true
    };
}

// ==================================================================
// 1 — Marcador concluído: não reimporta
// ==================================================================

test("1: marcador concluído NÃO é reimportado", async () => {
    const estado = novoEstado();
    const nome = "c11-concluido-" + selo();

    criarAlbum(nome, ["uuid-c11-1-" + selo()], {
        marcador: { album: nome, product_id: 300, images: 1, new_images: 1,
                    imported_at: new Date().toISOString(), incremental: false }
    });

    estado.produtos.push({ id: 300, title: nome });

    const router = await carregarRouter(estado);

    try {
        let importou = 0;
        const rel = await router.recuperarAlbunsNoBoot({
            importar: async () => { importou += 1; return { imported: [] }; }
        });

        assert.equal(importou, 0, "não deve importar");
        assert.ok(rel.jaVinculados.some(j => j.album === nome && j.motivo === "marcador presente"));
        assert.equal(rel.retomados.length, 0, "nenhuma retomada");
    } finally {
        limparAlbum(nome);
    }
});

// ==================================================================
// 2 — Marcador pendente + produto existente: retoma
// ==================================================================

test("2: marcador pendente com produto existente é RETOMADO", async () => {
    const estado = novoEstado();
    const nome = "c11-retoma-" + selo();
    const uuid = "uuid-c11-2-" + selo();

    criarAlbum(nome, [uuid], { marcador: marcadorPendente(nome, 210) });

    // Produto JÁ existe (como 210), sem nenhuma imagem vinculada.
    estado.produtos.push({ id: 210, title: nome });

    const router = await carregarRouter(estado);

    try {
        const rel = await router.recuperarAlbunsNoBoot();

        assert.ok(rel.retomados.some(r => r.album === nome && r.produto_id === 210),
            "álbum registrado como retomável");
        assert.ok(rel.retomados.some(r => r.album === nome && r.etapa === "retomado"),
            "retomada concluída");

        assert.equal(estado.produtos.length, 1, "NÃO cria produto novo");
        assert.equal(estado.imagens.length, 1, "imagem vinculada");
        assert.equal(estado.imagens[0].product_id, 210, "vinculada ao produto do marcador");

        const marcador = lerMarcador(nome);
        assert.ok(!marcador.pendente, "marcador concluído (sem pendente)");
        assert.equal(marcador.product_id, 210);
        assert.equal(marcador.new_images, 1);
    } finally {
        limparAlbum(nome);
    }
});

// ==================================================================
// 3 — Marcador pendente com imagens já vinculadas: não duplica
// ==================================================================

test("3: marcador pendente com imagens já vinculadas não duplica nada", async () => {
    const estado = novoEstado();
    const nome = "c11-ja-vinculado-" + selo();
    const uuid = "uuid-c11-3-" + selo();

    criarAlbum(nome, [uuid], { marcador: marcadorPendente(nome, 211) });

    estado.produtos.push({ id: 211, title: nome });
    estado.imagens.push({ id: 1, product_id: 211, client_uuid: uuid });

    const router = await carregarRouter(estado);

    try {
        const rel = await router.recuperarAlbunsNoBoot();

        assert.equal(estado.produtos.length, 1, "um produto");
        assert.equal(estado.imagens.length, 1, "uma imagem");

        const marcador = lerMarcador(nome);
        assert.ok(!marcador.pendente, "marcador concluído");
        assert.equal(marcador.new_images, 0, "nenhuma foto nova");
        assert.equal(marcador.images, 1);
    } finally {
        limparAlbum(nome);
    }
});

// ==================================================================
// 4 — Falha de sharp mantém marcador pendente
// ==================================================================

test("4: falha de sharp mantém o marcador pendente", async () => {
    const estado = novoEstado();
    const nome = "c11-falha-" + selo();

    criarAlbum(nome, ["uuid-c11-4-" + selo()], { marcador: marcadorPendente(nome, 212) });
    estado.produtos.push({ id: 212, title: nome });
    estado.falharSharpAte = 1;

    const router = await carregarRouter(estado);

    try {
        const rel = await router.recuperarAlbunsNoBoot();

        // `importAlbums` NÃO relança: registra a falha em `skipped` e
        // devolve `imported: []`. O C1 vê isso como "nada importado" e
        // mantém o marcador pendente — que é o comportamento correto.
        assert.ok(rel.ignorados.some(i => i.album === nome),
            "falha registrada como ignorado (nada importado)");
        assert.equal(rel.importados.length, 0, "nada importado");

        const marcador = lerMarcador(nome);
        assert.equal(marcador.pendente, true, "marcador PRESERVADO como pendente");
        assert.equal(marcador.product_id, 212);

        assert.equal(estado.produtos.length, 1, "sem produto novo");
        assert.equal(estado.imagens.length, 0, "sem imagem vinculada");
    } finally {
        limparAlbum(nome);
    }
});

// ==================================================================
// 5 — Novo boot após falha tenta novamente
// ==================================================================

test("5: novo boot após falha retoma com sucesso", async () => {
    const estado = novoEstado();
    const nome = "c11-reboot-" + selo();

    criarAlbum(nome, ["uuid-c11-5-" + selo()], { marcador: marcadorPendente(nome, 213) });
    estado.produtos.push({ id: 213, title: nome });
    estado.falharSharpAte = 1;

    const router = await carregarRouter(estado);

    try {
        // 1º boot: falha.
        await router.recuperarAlbunsNoBoot();
        assert.equal(lerMarcador(nome).pendente, true);

        // 2º boot: funciona.
        estado.falharSharpAte = 0;
        const rel2 = await router.recuperarAlbunsNoBoot();

        assert.ok(rel2.retomados.some(r => r.album === nome && r.etapa === "retomado"),
            "retomado no 2º boot");

        const marcador = lerMarcador(nome);
        assert.ok(!marcador.pendente, "concluído");
        assert.equal(estado.produtos.length, 1, "mesmo produto");
        assert.equal(estado.imagens.length, 1, "imagem vinculada");
    } finally {
        limparAlbum(nome);
    }
});

// ==================================================================
// 6 — Sucesso atualiza marcador e remove pendente
// ==================================================================

test("6: sucesso grava marcador final sem pendente", async () => {
    const estado = novoEstado();
    const nome = "c11-marcador-" + selo();

    criarAlbum(nome, ["uuid-c11-6-" + selo()], { marcador: marcadorPendente(nome, 214) });
    estado.produtos.push({ id: 214, title: nome });

    const router = await carregarRouter(estado);

    try {
        await router.recuperarAlbunsNoBoot();

        const marcador = lerMarcador(nome);

        assert.ok(!Object.hasOwn(marcador, "pendente") || marcador.pendente === undefined,
            "campo pendente ausente");
        assert.equal(marcador.product_id, 214);
        assert.equal(marcador.new_images, 1);
        assert.equal(marcador.incremental, true, "havia marcador");
        assert.ok(marcador.imported_at);
        assert.ok(estado.marcados.some(m => m.album === nome && m.id === 214),
            "SyncQueue marcada após confirmação");
    } finally {
        limparAlbum(nome);
    }
});

// ==================================================================
// 7 — Concorrência: uma execução por álbum
// ==================================================================

test("7: duas recuperações concorrentes geram uma única importação", async () => {
    const estado = novoEstado();
    const nome = "c11-conc-" + selo();

    criarAlbum(nome, ["uuid-c11-7-" + selo()], { marcador: marcadorPendente(nome, 215) });
    estado.produtos.push({ id: 215, title: nome });

    const router = await carregarRouter(estado);

    try {
        await Promise.all([
            router.recuperarAlbunsNoBoot(),
            router.recuperarAlbunsNoBoot()
        ]);

        assert.equal(estado.produtos.length, 1, "um produto");
        assert.equal(estado.imagens.length, 1, "uma imagem, sem duplicata");
        assert.equal(router.albumImportando(nome), false, "trava liberada");
    } finally {
        limparAlbum(nome);
    }
});

// ==================================================================
// 8 — Produto inexistente: erro controlado
// ==================================================================

test("8: marcador pendente com produto inexistente não cria outro", async () => {
    const estado = novoEstado();
    const nome = "c11-sem-produto-" + selo();

    criarAlbum(nome, ["uuid-c11-8-" + selo()], { marcador: marcadorPendente(nome, 999) });

    // Nenhum produto com id 999.
    const router = await carregarRouter(estado);

    try {
        const rel = await router.recuperarAlbunsNoBoot();

        assert.ok(rel.erros.some(e => e.album === nome && e.etapa === "produto_inexistente"),
            "erro controlado registrado");

        assert.equal(estado.produtos.length, 0, "NENHUM produto criado");
        assert.equal(estado.imagens.length, 0);

        const marcador = lerMarcador(nome);
        assert.equal(marcador.pendente, true, "marcador preservado para inspeção");
    } finally {
        limparAlbum(nome);
    }
});

// ==================================================================
// 9 — Marcador corrompido: erro controlado
// ==================================================================

test("9: marcador corrompido gera erro sem duplicar", async () => {
    const estado = novoEstado();
    const nome = "c11-corrompido-" + selo();

    criarAlbum(nome, ["uuid-c11-9-" + selo()], { marcadorCru: "{ isso nao e json valido" });

    const router = await carregarRouter(estado);

    try {
        const rel = await router.recuperarAlbunsNoBoot();

        assert.ok(rel.erros.some(e => e.album === nome && e.etapa === "marcador_corrompido"),
            "erro controlado registrado");

        assert.equal(estado.produtos.length, 0, "NENHUM produto criado");
        assert.equal(estado.imagens.length, 0);
        assert.equal(lerMarcador(nome), "CORROMPIDO", "marcador preservado intacto");
    } finally {
        limparAlbum(nome);
    }
});

// ==================================================================
// Extra — marcador pendente sem product_id válido
// ==================================================================

test("extra: pendente=true sem product_id válido é erro controlado", async () => {
    const estado = novoEstado();
    const nome = "c11-sem-id-" + selo();

    criarAlbum(nome, ["uuid-c11-x-" + selo()], {
        marcador: { album: nome, pendente: true }
    });

    const router = await carregarRouter(estado);

    try {
        const rel = await router.recuperarAlbunsNoBoot();

        assert.ok(rel.erros.some(e => e.etapa === "marcador_pendente_sem_produto"));
        assert.equal(estado.produtos.length, 0);
    } finally {
        limparAlbum(nome);
    }
});

// ==================================================================
// Extra — marcador com estruturas JSON inválidas
// ==================================================================

test("extra: marcador `[]` (array vazio) é rejeitado como corrompido", async () => {
    const estado = novoEstado();
    const nome = "c11-array-" + selo();

    // JSON válido, mas NÃO é um objeto — `typeof [] === "object"`
    // deixaria passar na validação antiga.
    criarAlbum(nome, ["uuid-c11-arr-" + selo()], { marcadorCru: "[]" });

    const router = await carregarRouter(estado);

    try {
        const rel = await router.recuperarAlbunsNoBoot();

        assert.ok(rel.erros.some(e => e.album === nome && e.etapa === "marcador_corrompido"),
            "array deve ser rejeitado como marcador corrompido");

        assert.equal(estado.produtos.length, 0, "NENHUM produto criado");
        assert.equal(estado.imagens.length, 0, "NENHUMA imagem vinculada");

        // O arquivo permanece exatamente como estava (array vazio),
        // para inspeção/reconciliação manual.
        const bruto = fs.readFileSync(
            path.join(ALBUMS, nome, ".tratocore-import.json"), "utf8"
        );
        assert.equal(bruto, "[]", "arquivo preservado intacto");
    } finally {
        limparAlbum(nome);
    }
});

test("extra: marcador com array de objetos também é rejeitado", async () => {
    const estado = novoEstado();
    const nome = "c11-array2-" + selo();

    criarAlbum(nome, ["uuid-c11-arr2-" + selo()], {
        marcadorCru: JSON.stringify([{ product_id: 1, pendente: false }])
    });

    const router = await carregarRouter(estado);

    try {
        const rel = await router.recuperarAlbunsNoBoot();

        assert.ok(rel.erros.some(e => e.album === nome && e.etapa === "marcador_corrompido"));
        assert.equal(estado.produtos.length, 0);
    } finally {
        limparAlbum(nome);
    }
});

test("extra: marcador `null` é rejeitado como corrompido", async () => {
    const estado = novoEstado();
    const nome = "c11-null-" + selo();

    criarAlbum(nome, ["uuid-c11-null-" + selo()], { marcadorCru: "null" });

    const router = await carregarRouter(estado);

    try {
        const rel = await router.recuperarAlbunsNoBoot();

        assert.ok(rel.erros.some(e => e.album === nome && e.etapa === "marcador_corrompido"));
        assert.equal(estado.produtos.length, 0);
    } finally {
        limparAlbum(nome);
    }
});

test("extra: marcador com número/string é rejeitado como corrompido", async () => {
    const estado = novoEstado();
    const nome = "c11-scalar-" + selo();

    criarAlbum(nome, ["uuid-c11-scalar-" + selo()], { marcadorCru: "42" });

    const router = await carregarRouter(estado);

    try {
        const rel = await router.recuperarAlbunsNoBoot();

        assert.ok(rel.erros.some(e => e.album === nome && e.etapa === "marcador_corrompido"));
        assert.equal(estado.produtos.length, 0);
    } finally {
        limparAlbum(nome);
    }
});

// ==================================================================
// Extra — não deixa timers nem travas remanescentes
// ==================================================================

test("extra: retomada libera a trava e não agenda timers", async () => {
    const estado = novoEstado();
    const nome = "c11-limpa-" + selo();

    criarAlbum(nome, ["uuid-c11-y-" + selo()], { marcador: marcadorPendente(nome, 216) });
    estado.produtos.push({ id: 216, title: nome });

    const router = await carregarRouter(estado);

    try {
        await router.recuperarAlbunsNoBoot();

        assert.equal(router.albumImportando(nome), false, "trava liberada");
        assert.equal(router.importsEmAndamento.size, 0, "nenhuma trava remanescente");
    } finally {
        limparAlbum(nome);
    }
});
