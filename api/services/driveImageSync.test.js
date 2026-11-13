// Testes do servico de sincronizacao de imagens com o Google Drive.
// Usa um Drive SIMULADO: nenhuma chamada real ao Google.
const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const fs = require("node:fs");
const path = require("node:path");

const servicePath = require.resolve("./driveImageSync.service");

function criarDb(imagens) {
    const estado = { imagens: imagens.map(i => ({ ...i })), updates: [] };

    return {
        estado,
        async query(sql, params = []) {
            const texto = String(sql).toLowerCase();

            if (texto.includes("update product_images") && texto.includes("drive_file_id = $2")) {
                const [id, driveFileId, folderId, webView] = params;
                const alvo = estado.imagens.find(i => i.id === id);

                if (!alvo || alvo.drive_file_id) return { rowCount: 0 };

                alvo.drive_file_id = driveFileId;
                alvo.drive_folder_id = folderId;
                alvo.drive_web_view_link = webView;
                alvo.drive_sync_status = "synced";
                estado.updates.push({ id, driveFileId });
                return { rowCount: 1 };
            }

            if (texto.includes("set drive_sync_status = 'failed'")) {
                const [id, erro] = params;
                const alvo = estado.imagens.find(i => i.id === id);
                if (alvo && !alvo.drive_file_id) alvo.drive_sync_error = erro;
                return { rowCount: alvo ? 1 : 0 };
            }

            if (texto.includes("count(*)::int as total")) {
                const com = estado.imagens.filter(i => i.drive_file_id).length;
                return {
                    rows: [{
                        total: estado.imagens.length,
                        com_drive: com,
                        sem_drive: estado.imagens.length - com
                    }]
                };
            }

            if (texto.includes("from product_images i")) {
                const limite = Number(params[params.length - 1]) || 50;
                const pendentes = estado.imagens
                    .filter(i => !i.drive_file_id)
                    .slice(0, limite)
                    .map(i => ({ ...i }));
                return { rows: pendentes };
            }

            return { rows: [], rowCount: 0 };
        }
    };
}

function carregar(dbSimulado) {
    const originalLoad = Module._load;
    delete require.cache[servicePath];

    Module._load = function (request, parent, isMain) {
        if (parent?.filename === servicePath && request === "../db") return dbSimulado;
        return originalLoad.call(this, request, parent, isMain);
    };

    try {
        return require(servicePath);
    } finally {
        Module._load = originalLoad;
    }
}

const RAIZ = path.resolve(__dirname, "..", "..");
const TEMP_DIR = path.join(RAIZ, "storage", "originals", "tc-test-sync");
const TEMP_FILE = path.join(TEMP_DIR, "amostra.png");

fs.mkdirSync(TEMP_DIR, { recursive: true });
fs.writeFileSync(TEMP_FILE, Buffer.from("conteudo-de-teste"));

process.on("exit", () => {
    try { fs.rmSync(TEMP_DIR, { recursive: true, force: true }); } catch (_) {}
});

const RELATIVO = path.relative(RAIZ, TEMP_FILE).replace(/\\/g, "/");

function driveFake({ falhar = false } = {}) {
    const chamadas = [];

    return {
        chamadas,
        async uploadBuffer(buffer, nome, mime, album, chave) {
            chamadas.push({ nome, mime, album, chave, bytes: buffer.length });

            if (falhar) throw new Error("Drive indisponivel");

            return { id: "DRIVE-" + chamadas.length, folder_id: "PASTA", web_view_link: "https://drive/x" };
        }
    };
}

test("nao envia imagem que ja tem drive_file_id (idempotente)", async () => {
    const db = criarDb([{ id: 1, product_id: 1, original_url: "/" + RELATIVO, drive_file_id: "JA-EXISTE" }]);
    const sync = carregar(db);
    const drive = driveFake();

    const r = await sync.sincronizarImagem({ id: 1, drive_file_id: "JA-EXISTE" }, drive);

    assert.equal(r.enviada, false);
    assert.equal(r.motivo, "ja_sincronizada");
    assert.equal(drive.chamadas.length, 0, "nao deve reenviar (evita duplicacao)");
});

test("envia imagem pendente e grava o identificador do Drive", async () => {
    const db = criarDb([{ id: 2, product_id: 5, original_url: "/" + RELATIVO, file_name: "foto.png", mime_type: "image/png" }]);
    const sync = carregar(db);
    const drive = driveFake();

    const r = await sync.sincronizarImagem(db.estado.imagens[0], drive);

    assert.equal(r.enviada, true);
    assert.equal(r.drive_file_id, "DRIVE-1");
    assert.equal(db.estado.imagens[0].drive_file_id, "DRIVE-1");
    assert.equal(db.estado.imagens[0].drive_sync_status, "synced");
    assert.equal(drive.chamadas[0].nome, "foto.png");
});

test("arquivo ausente nao envia e marca a falha", async () => {
    const db = criarDb([{ id: 3, product_id: 6, original_url: "/storage/originals/inexistente.jpg" }]);
    const sync = carregar(db);
    const drive = driveFake();

    const r = await sync.sincronizarImagem(db.estado.imagens[0], drive);

    assert.equal(r.enviada, false);
    assert.equal(r.motivo, "arquivo_ausente");
    assert.equal(drive.chamadas.length, 0);
    assert.ok(String(db.estado.imagens[0].drive_sync_error).length > 0);
});

test("falha do Drive nao grava identificador", async () => {
    const db = criarDb([{ id: 4, product_id: 7, original_url: "/" + RELATIVO, file_name: "a.png" }]);
    const sync = carregar(db);

    await assert.rejects(
        () => sync.sincronizarImagem(db.estado.imagens[0], driveFake({ falhar: true })),
        /Drive indisponivel/
    );

    assert.equal(db.estado.imagens[0].drive_file_id, undefined, "nada gravado quando o Drive falha");
});

test("dry-run nao envia e nao altera o banco", async () => {
    const db = criarDb([
        { id: 5, product_id: 8, original_url: "/" + RELATIVO, file_name: "b.png" },
        { id: 6, product_id: 9, original_url: "/" + RELATIVO, file_name: "c.png" }
    ]);
    const sync = carregar(db);
    const drive = driveFake();

    const r = await sync.sincronizarLote({ driveService: drive, limite: 10, dryRun: true });

    assert.equal(r.dryRun, true);
    assert.equal(r.enviadas, 0);
    assert.equal(drive.chamadas.length, 0, "nenhum envio em dry-run");
    assert.equal(db.estado.updates.length, 0, "nenhuma alteracao no banco");
});

test("processar o mesmo lote duas vezes nao duplica", async () => {
    const db = criarDb([{ id: 7, product_id: 10, original_url: "/" + RELATIVO, file_name: "d.png" }]);
    const sync = carregar(db);
    const drive = driveFake();

    const primeira = await sync.sincronizarLote({ driveService: drive, limite: 10, dryRun: false });
    assert.equal(primeira.enviadas, 1);

    const segunda = await sync.sincronizarLote({ driveService: drive, limite: 10, dryRun: false });
    assert.equal(segunda.enviadas, 0, "nada reenviado na segunda passada");
    assert.equal(segunda.candidatos, 0);
    assert.equal(drive.chamadas.length, 1, "Drive recebeu apenas um envio");
});

test("nao aceita caminho fora da pasta storage", async () => {
    const db = criarDb([{ id: 8, product_id: 11, original_url: "/../../etc/passwd" }]);
    const sync = carregar(db);

    assert.equal(sync.resolverArquivoLocal(db.estado.imagens[0]), null);
});

test("resumo conta imagens com e sem Drive", async () => {
    const db = criarDb([
        { id: 9, product_id: 12, original_url: "/" + RELATIVO, drive_file_id: "X" },
        { id: 10, product_id: 13, original_url: "/" + RELATIVO }
    ]);
    const sync = carregar(db);

    const r = await sync.resumo();

    assert.equal(r.total, 2);
    assert.equal(r.com_drive, 1);
    assert.equal(r.sem_drive, 1);
});
