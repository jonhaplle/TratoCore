// Testes da reconciliação entre jobs sincronizados e product_images.
// Comprova a correção da lacuna: importação depois da sincronização.
const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

const servicePath = require.resolve("./tratocapSyncQueue.service");

// Banco simulado com as duas tabelas relevantes.
function criarDb({ jobs = [], imagens = [] } = {}) {
    const estado = { jobs: [...jobs], imagens: [...imagens], chamadas: [] };

    return {
        estado,
        async query(sql, params = []) {
            const texto = String(sql).replace(/\s+/g, " ");

            estado.chamadas.push(texto.slice(0, 40));

            // Reconciliação: UPDATE ... FROM (SELECT ... FROM tratocap_sync_jobs)
            if (/UPDATE product_images AS img/i.test(texto) && /drive_file_id = job\.drive_file_id/i.test(texto)) {
                let reconciliadas = 0;

                for (const img of estado.imagens) {
                    if (img.drive_file_id) continue;
                    if (!img.client_uuid) continue;

                    const job = estado.jobs
                        .filter(j => j.status === "synced" && j.drive_file_id && j.client_uuid === img.client_uuid)
                        .sort((a, b) => b.id - a.id)[0];

                    if (!job) continue;

                    img.drive_file_id = job.drive_file_id;
                    img.drive_folder_id = job.drive_folder_id;
                    img.drive_web_view_link = job.drive_web_view_link;
                    img.drive_sync_status = "synced";
                    reconciliadas += 1;
                }

                const linhas = Array.from({ length: reconciliadas }, (_, i) => ({ id: i + 1 }));
                return { rows: linhas, rowCount: reconciliadas };
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

test("vincula imagem importada DEPOIS da sincronização do job", async () => {
    const db = criarDb({
        jobs: [{
            id: 10,
            client_uuid: "uuid-1",
            status: "synced",
            drive_file_id: "DRIVE-A",
            drive_folder_id: "FOLDER-1",
            drive_web_view_link: "https://drive/A",
            synced_at: new Date()
        }],
        imagens: [{ id: 1, client_uuid: "uuid-1", drive_file_id: null }]
    });

    const fila = carregar(db);
    const r = await fila.reconciliarImagensSemDrive();

    assert.equal(r.reconciliadas, 1);
    assert.equal(db.estado.imagens[0].drive_file_id, "DRIVE-A");
    assert.equal(db.estado.imagens[0].drive_sync_status, "synced");
});

test("é idempotente: não reescreve imagem que já tem drive_file_id", async () => {
    const db = criarDb({
        jobs: [{
            id: 11, client_uuid: "uuid-2", status: "synced",
            drive_file_id: "DRIVE-B", drive_folder_id: "F", drive_web_view_link: null, synced_at: new Date()
        }],
        imagens: [{ id: 2, client_uuid: "uuid-2", drive_file_id: "DRIVE-EXISTENTE" }]
    });

    const fila = carregar(db);
    const r = await fila.reconciliarImagensSemDrive();

    assert.equal(r.reconciliadas, 0);
    assert.equal(db.estado.imagens[0].drive_file_id, "DRIVE-EXISTENTE", "valor original preservado");
});

test("ignora job que ainda não sincronizou", async () => {
    const db = criarDb({
        jobs: [{ id: 12, client_uuid: "uuid-3", status: "pending", drive_file_id: null }],
        imagens: [{ id: 3, client_uuid: "uuid-3", drive_file_id: null }]
    });

    const fila = carregar(db);
    const r = await fila.reconciliarImagensSemDrive();

    assert.equal(r.reconciliadas, 0);
    assert.equal(db.estado.imagens[0].drive_file_id, null);
});

test("ignora imagem sem client_uuid (histórico antigo)", async () => {
    const db = criarDb({
        jobs: [{
            id: 13, client_uuid: "uuid-4", status: "synced",
            drive_file_id: "DRIVE-D", drive_folder_id: "F", drive_web_view_link: null, synced_at: new Date()
        }],
        imagens: [{ id: 4, client_uuid: null, drive_file_id: null }]
    });

    const fila = carregar(db);
    const r = await fila.reconciliarImagensSemDrive();

    assert.equal(r.reconciliadas, 0);
});

test("usa o job mais recente quando há duplicatas do mesmo client_uuid", async () => {
    const db = criarDb({
        jobs: [
            { id: 20, client_uuid: "uuid-5", status: "synced", drive_file_id: "ANTIGO", drive_folder_id: "F", synced_at: new Date(1000) },
            { id: 21, client_uuid: "uuid-5", status: "synced", drive_file_id: "RECENTE", drive_folder_id: "F", synced_at: new Date(2000) }
        ],
        imagens: [{ id: 5, client_uuid: "uuid-5", drive_file_id: null }]
    });

    const fila = carregar(db);
    await fila.reconciliarImagensSemDrive();

    assert.equal(db.estado.imagens[0].drive_file_id, "RECENTE");
});

test("reconciliação não apaga nem remove vínculos existentes", async () => {
    const db = criarDb({
        jobs: [
            { id: 30, client_uuid: "uuid-6", status: "synced", drive_file_id: "D6", drive_folder_id: "F", synced_at: new Date() }
        ],
        imagens: [
            { id: 6, client_uuid: "uuid-6", drive_file_id: null },
            { id: 7, client_uuid: "outro", drive_file_id: "INTOCADO" }
        ]
    });

    const fila = carregar(db);
    await fila.reconciliarImagensSemDrive();

    assert.equal(db.estado.imagens[0].drive_file_id, "D6");
    assert.equal(db.estado.imagens[1].drive_file_id, "INTOCADO");
});
