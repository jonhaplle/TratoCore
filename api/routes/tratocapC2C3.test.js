// Testes de C2 (ordem de boot) e C3 (marcador em retorno antecipado).
//
// Carrega o módulo REAL api/routes/tratocap.js com dependências externas
// substituídas. Sem banco, sem Google Drive, sem dados reais.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

const RAIZ = path.join(__dirname, "..", "..");
const ALBUMS = path.join(RAIZ, "storage", "tratocap", "albums");

const JPEG = Buffer.from([
    0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x00, 0x00
]);

// ------------------------------------------------------------------
// Estado + stubs
// ------------------------------------------------------------------

function novoEstado() {
    return {
        produtos: [],
        imagens: [],
        fila: [],
        marcados: [],
        criacoes: 0,
        atraso: 20
    };
}

function carregarRouter(estado) {
    const mapa = {};
    const original = Module._load;

    Module._load = function (r) { return mapa[r] ?? original.apply(this, arguments); };

    mapa["sharp"] = () => ({
        metadata: async () => ({ format: "jpeg", width: 10, height: 10 }),
        rotate() { return this; },
        resize() { return this; },
        webp() { return this; },
        toFile: async (d) => { fs.writeFileSync(d, "thumb"); return {}; }
    });

    mapa["../services/productService"] = {
        create: async (d) => {
            estado.criacoes += 1;
            await new Promise(r => setTimeout(r, estado.atraso));
            const p = { id: 5000 + estado.produtos.length, ...d };
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
        getUnimportedProductImages: async () => estado.fila.slice(),
        getByClientUuid: async () => null,
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

    let router;

    try {
        const alvo = require.resolve(path.join(RAIZ, "api", "routes", "tratocap.js"));
        delete require.cache[alvo];
        router = require(alvo);
    } finally {
        Module._load = original;
    }

    return router;
}

// ------------------------------------------------------------------
// Fixtures
// ------------------------------------------------------------------

function limparAlbum(nome) {
    fs.rmSync(path.join(ALBUMS, nome), { recursive: true, force: true });
}

function criarAlbum(nome, uuids, { marcador = null } = {}) {
    const dir = path.join(ALBUMS, nome);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });

    for (const u of uuids) {
        fs.writeFileSync(path.join(dir, `${u}.jpg`), JPEG);
        fs.writeFileSync(
            path.join(dir, `${u}.jpg.json`),
            JSON.stringify({ client_uuid: u, sha256: "sha-" + u, note: "" })
        );
    }

    if (marcador) {
        fs.writeFileSync(path.join(dir, ".tratocore-import.json"), JSON.stringify(marcador));
    }

    return dir;
}

function lerMarcador(nome) {
    const p = path.join(ALBUMS, nome, ".tratocore-import.json");
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, "utf8"));
}

/** Job da fila como getUnimportedProductImages devolveria. */
function job(album, uuid) {
    return {
        album_name: album,
        file_name: `${uuid}.jpg`,
        client_uuid: uuid,
        sha256: "sha-" + uuid,
        payload: JPEG,
        note: "",
        status: "synced"
    };
}

const selo = () => Date.now() + "-" + Math.random().toString(36).slice(2, 7);

// ==================================================================
// 1 — Fila com dois pendentes + diretório vazio → C2 popula, C1 importa
// ==================================================================

test("1+2: C2 reconstrói da fila e C1 encontra os álbuns recuperados", async () => {
    const estado = novoEstado();
    const a = "c2-a-" + selo();
    const b = "c2-b-" + selo();
    const ua = "uuid-a-" + selo();
    const ub = "uuid-b-" + selo();

    // Diretório inicialmente vazio (disco efêmero).
    limparAlbum(a);
    limparAlbum(b);

    estado.fila = [job(a, ua), job(b, ub)];

    const router = carregarRouter(estado);

    try {
        // (1) ANTES do C2: o C1 veria zero.
        const antes = await router.recuperarAlbunsNoBoot({
            importar: async () => { throw new Error("não deveria importar antes do C2"); }
        });

        assert.ok(!antes.encontrados.includes(a), "C1 não vê o álbum que só está na fila");

        // (2) C2: reconstrói do banco. agendar:false evita timers.
        const rec = await router.recoverUnimportedAlbums({ agendar: false });

        assert.ok(rec.albums.includes(a), "C2 recuperou álbum A");
        assert.ok(rec.albums.includes(b), "C2 recuperou álbum B");
        assert.deepEqual(rec.agendados, [], "nenhum timer agendado quando agendar=false");

        // Arquivos reconstruídos no disco.
        assert.ok(fs.existsSync(path.join(ALBUMS, a, `${ua}.jpg`)), "arquivo A no disco");
        assert.ok(fs.existsSync(path.join(ALBUMS, b, `${ub}.jpg`)), "arquivo B no disco");

        // (3) C1 agora ENCONTRA e importa.
        //
        // `recuperarAlbunsNoBoot` percorre TODO o diretório. Para o teste ser
        // hermético e não depender de fixtures de outras execuções, filtramos
        // o resultado pelos dois álbuns deste caso.
        const dep = await router.recuperarAlbunsNoBoot();

        assert.ok(dep.encontrados.includes(a), "C1 vê o álbum A após C2");
        assert.ok(dep.encontrados.includes(b), "C1 vê o álbum B após C2");

        const importadosDoTeste = dep.importados.filter(
            i => i.album === a || i.album === b
        );

        assert.equal(importadosDoTeste.length, 2, "C1 importou os dois deste teste");

        // (4) Markers gravados e produtos criados.
        assert.ok(lerMarcador(a), "marcador A gravado");
        assert.ok(lerMarcador(b), "marcador B gravado");
        assert.equal(estado.produtos.length, 2, "dois produtos, um por álbum");
    } finally {
        limparAlbum(a);
        limparAlbum(b);
    }
});

// ==================================================================
// 3 — Duas chamadas concorrentes
// ==================================================================

test("3: importações concorrentes continuam criando um único produto", async () => {
    const estado = novoEstado();
    const nome = "c2-conc-" + selo();

    criarAlbum(nome, ["uuid-conc-" + selo()]);
    const router = carregarRouter(estado);

    try {
        await Promise.all([
            router.importAlbums(nome),
            router.importAlbums(nome)
        ]);

        assert.equal(estado.produtos.length, 1, "trava impede duplicação");
        assert.equal(router.albumImportando(nome), false, "trava liberada");
    } finally {
        limparAlbum(nome);
    }
});

// ==================================================================
// 4+5 — C3: imagens já no banco, sem marcador
// ==================================================================

test("4: imagens já no banco sem marcador → C3 grava o marcador", async () => {
    const estado = novoEstado();
    const nome = "c3-sem-marcador-" + selo();
    const u1 = "uuid-c3a-" + selo();
    const u2 = "uuid-c3b-" + selo();

    criarAlbum(nome, [u1, u2]);

    // Produto e imagens já existem (como 210).
    estado.produtos.push({ id: 210, title: nome });
    estado.imagens.push({ id: 1, product_id: 210, client_uuid: u1 });
    estado.imagens.push({ id: 2, product_id: 210, client_uuid: u2 });

    const router = carregarRouter(estado);

    try {
        const r = await router.importAlbums(nome);

        assert.equal(r.imported.length, 0, "nada novo a importar");
        assert.equal(estado.criacoes, 0, "nenhum produto criado");
        assert.equal(estado.produtos.length, 1, "produto não duplicado");
        assert.equal(estado.imagens.length, 2, "imagens não duplicadas");

        // C3: marcador AGORA é gravado.
        const marcador = lerMarcador(nome);
        assert.ok(marcador, "marcador deve existir após o caminho sem fotos novas");
        assert.equal(marcador.product_id, 210);
        assert.equal(marcador.new_images, 0);
        assert.equal(marcador.images, 2);
        // Este álbum NÃO tinha marcador antes: incremental=false (C1.1 passou
        // a usar Boolean(marker) em vez de constante true).
        assert.equal(marcador.incremental, false);
        assert.ok(marcador.imported_at, "imported_at presente");
        assert.ok(!marcador.pendente, "sem pendente: importação completa");

        // Fila deixa de indicar pendência.
        assert.ok(estado.marcados.some(m => m.album === nome && m.id === 210),
            "SyncQueue.markAlbumImported chamado");
    } finally {
        limparAlbum(nome);
    }
});

test("5: marcador já existente NÃO é sobrescrito", async () => {
    const estado = novoEstado();
    const nome = "c3-marcador-existe-" + selo();
    const u1 = "uuid-c3c-" + selo();

    const original = { product_id: 212, album: nome, imported_at: "2026-11-24T00:00:00.000Z" };
    criarAlbum(nome, [u1], { marcador: original });

    estado.produtos.push({ id: 212, title: nome });
    estado.imagens.push({ id: 1, product_id: 212, client_uuid: u1 });

    const router = carregarRouter(estado);

    try {
        await router.importAlbums(nome);

        const marcador = lerMarcador(nome);

        assert.equal(marcador.product_id, 212);
        assert.equal(marcador.imported_at, original.imported_at,
            "marcador válido preservado, sem sobrescrita");
    } finally {
        limparAlbum(nome);
    }
});

// ==================================================================
// 6 — Retry após falha
// ==================================================================

test("6: falha libera a trava e o retry consegue importar", async () => {
    const estado = novoEstado();
    const nome = "c2-retry-" + selo();
    const uuid = "uuid-retry-" + selo();

    criarAlbum(nome, [uuid]);

    // Stub de sharp que FALHA na primeira chamada e funciona na segunda.
    const mapa = {};
    const original = Module._load;
    let sharpChamadas = 0;

    Module._load = function (r) { return mapa[r] ?? original.apply(this, arguments); };

    mapa["sharp"] = () => ({
        metadata: async () => {
            sharpChamadas += 1;

            if (sharpChamadas === 1) throw new Error("falha simulada no sharp");

            return { format: "jpeg", width: 10, height: 10 };
        },
        rotate() { return this; },
        resize() { return this; },
        webp() { return this; },
        toFile: async (d) => { fs.writeFileSync(d, "thumb"); return {}; }
    });

    mapa["../services/productService"] = {
        create: async (d) => {
            estado.criacoes += 1;
            const p = { id: 6000 + estado.produtos.length, ...d };
            estado.produtos.push(p);
            return p;
        },
        getById: async (id) => estado.produtos.find(p => String(p.id) === String(id)) || null,
        update: async (id, d) => ({ id, ...d })
    };

    mapa["../services/productImageService"] = {
        create: async (d) => {
            const img = { id: estado.imagens.length + 1, ...d };
            estado.imagens.push(img);
            return img;
        },
        getByProductId: async (id) => estado.imagens.filter(i => String(i.product_id) === String(id)),
        getByClientUuid: async (u) => estado.imagens.find(i => i.client_uuid === u) || null
    };

    mapa["../services/tratocapSyncQueue.service"] = {
        ensureSchema: async () => {},
        getUnimportedProductImages: async () => [],
        getByClientUuid: async () => null,
        markAlbumImported: async () => {}
    };

    mapa["../services/listingPreparation.service"] = { prepare: async () => null, prepareListing: async () => null };
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
        router = require(alvo);
    } finally {
        Module._load = original;
    }

    try {
        // Primeira tentativa FALHA.
        //
        // Ordem real do código: ProductService.create() (L~595) roda ANTES
        // de sharp().metadata() (L~616). Portanto a falha deixa o produto
        // criado, mas SEM marcador — o álbum continua "não importado" e uma
        // nova tentativa o reconhece pelo client_uuid, sem duplicar.
        const primeira = await router.importAlbums(nome);

        assert.equal(primeira.imported.length, 0, "nada importado na 1ª");
        assert.ok(primeira.skipped.length > 0, "falha registrada em skipped");
        assert.equal(router.albumImportando(nome), false, "trava liberada após falha");
        assert.equal(estado.produtos.length, 1, "produto criado antes da falha no sharp");

        // O marcador é gravado DEFENSIVAMENTE logo após a criação do produto,
        // antes de processar as imagens. É o que impede a duplicação no retry.
        const marcadorAposFalha = lerMarcador(nome);
        assert.ok(marcadorAposFalha, "marcador defensivo gravado antes das imagens");
        assert.equal(marcadorAposFalha.product_id, estado.produtos[0].id);

        // Segunda tentativa: sharp agora funciona.
        const segunda = await router.importAlbums(nome);

        assert.equal(segunda.imported.length, 1, "retry importa com sucesso");
        assert.equal(estado.produtos.length, 1, "retry NÃO duplica o produto");
        assert.ok(lerMarcador(nome), "marcador consolidado no retry");
        assert.equal(router.albumImportando(nome), false, "trava liberada ao final");
    } finally {
        limparAlbum(nome);
    }
});

// ==================================================================
// 7 — Inicialização repetida não cria produtos novos
// ==================================================================

test("7: boot repetido (C2 + C1 duas vezes) não cria produtos duplicados", async () => {
    const estado = novoEstado();
    const nome = "c2-boot-repetido-" + selo();
    const uuid = "uuid-boot-" + selo();

    estado.fila = [job(nome, uuid)];

    const router = carregarRouter(estado);

    try {
        // ---- 1º boot ----
        await router.recoverUnimportedAlbums({ agendar: false });
        const b1 = await router.recuperarAlbunsNoBoot();

        assert.equal(b1.importados.length, 1, "1º boot importa");
        assert.equal(estado.produtos.length, 1, "um produto");

        // ---- 2º boot (mesma fila, mesmo disco) ----
        await router.recoverUnimportedAlbums({ agendar: false });
        const b2 = await router.recuperarAlbunsNoBoot();

        assert.equal(b2.importados.length, 0, "2º boot não importa de novo");
        assert.ok(b2.jaVinculados.some(j => j.album === nome),
            "reconhecido como já vinculado");

        assert.equal(estado.produtos.length, 1, "nenhum produto novo");
        assert.equal(estado.criacoes, 1, "ProductService.create chamado uma única vez");
    } finally {
        limparAlbum(nome);
    }
});

// ==================================================================
// Estrutura: ordem no server.js
// ==================================================================

test("server.js chama C2 ANTES de C1", () => {
    const server = fs.readFileSync(path.join(RAIZ, "api", "server.js"), "latin1");

    const posC2 = server.indexOf("recoverUnimportedAlbums");
    const posC1 = server.indexOf("recuperarAlbunsNoBoot");

    assert.ok(posC2 > 0, "C2 deve estar presente");
    assert.ok(posC1 > posC2, "C1 deve vir DEPOIS do C2");
});

test("C2 é chamado com agendar:false (sem timers concorrentes)", () => {
    const server = fs.readFileSync(path.join(RAIZ, "api", "server.js"), "latin1");

    assert.match(server, /recoverUnimportedAlbums\s*\(\s*\{\s*agendar:\s*false\s*\}/);
});

test("falha no boot não derruba o servidor", () => {
    const server = fs.readFileSync(path.join(RAIZ, "api", "server.js"), "latin1");
    const pos = server.indexOf("recoverUnimportedAlbums");
    const bloco = server.slice(Math.max(0, pos - 200), pos + 900);

    assert.match(bloco, /catch/);
    assert.ok(!/process\.exit/.test(bloco));
});
