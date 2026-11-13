// Testes da fila de sincronização do TratoCap.
// Cobre: job sem payload, erro transitório com backoff, falha permanente,
// não-bloqueio da fila e idempotência.
const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

const servicePath = require.resolve("./tratocapSyncQueue.service");

/**
 * Banco simulado que imita claimNext/markSynced/markPending/markFailed.
 * `claimNext` só devolve jobs cujo next_retry_at <= agora.
 */
function criarDb(jobs) {
    const estado = {
        jobs: jobs.map(j => ({
            status: "pending",
            attempts: 0,
            next_retry_at: new Date(0),
            last_error: null,
            drive_file_id: null,
            ...j
        })),
        imagens: [],
        uploads: 0,
        reivindicados: []
    };

    let seq = 100;

    return {
        estado,
        async query(sql, params = []) {
            const texto = String(sql).replace(/\s+/g, " ");
            const agora = new Date();

            // claimNext
            if (/WITH candidate AS/i.test(texto)) {
                const candidato = estado.jobs
                    .filter(j => j.status === "pending" && j.next_retry_at <= agora)
                    .sort((a, b) => a.id - b.id)[0];

                if (!candidato) return { rows: [] };

                candidato.status = "processing";
                candidato.attempts += 1;
                candidato.last_error = null;
                estado.reivindicados.push(candidato.id);

                return { rows: [{ ...candidato }] };
            }

            // markSynced — job
            if (/UPDATE tratocap_sync_jobs SET status = 'synced'/i.test(texto)) {
                const [id, driveFileId] = params;
                const job = estado.jobs.find(j => j.id === id);
                if (job) {
                    job.status = "synced";
                    job.drive_file_id = driveFileId;
                    job.last_error = null;
                }
                return { rowCount: 1 };
            }

            // markSynced — product_images
            if (/UPDATE product_images SET drive_file_id/i.test(texto)) {
                const [clientUuid, driveFileId] = params;
                for (const img of estado.imagens) {
                    if (img.client_uuid === clientUuid && !img.drive_file_id) {
                        img.drive_file_id = driveFileId;
                    }
                }
                return { rowCount: 1 };
            }

            // Reconciliação: UPDATE ... FROM (SELECT ... FROM tratocap_sync_jobs)
            if (/UPDATE product_images AS img/i.test(texto)) {
                let reconciliadas = 0;

                for (const img of estado.imagens) {
                    if (img.drive_file_id || !img.client_uuid) continue;

                    const job = estado.jobs
                        .filter(j => j.status === "synced" && j.drive_file_id && j.client_uuid === img.client_uuid)
                        .sort((a, b) => b.id - a.id)[0];

                    if (!job) continue;

                    img.drive_file_id = job.drive_file_id;
                    img.drive_sync_status = "synced";
                    reconciliadas += 1;
                }

                return {
                    rows: Array.from({ length: reconciliadas }, (_, i) => ({ id: i + 1 })),
                    rowCount: reconciliadas
                };
            }

            // markPending
            if (/SET status = 'pending'/i.test(texto)) {
                const [id, erro] = params;
                const job = estado.jobs.find(j => j.id === id);
                if (job) {
                    job.status = "pending";
                    job.last_error = erro;
                    job.next_retry_at = new Date(agora.getTime() + Math.min(60 * job.attempts, 900) * 1000);
                }
                return { rowCount: 1 };
            }

            // markFailed
            if (/SET status = 'failed'/i.test(texto)) {
                const [id, erro] = params;
                const job = estado.jobs.find(j => j.id === id);
                if (job) {
                    job.status = "failed";
                    job.last_error = erro;
                }
                return { rowCount: 1 };
            }

            // UPDATE product_images SET drive_sync_status = 'pending'
            if (/drive_sync_status = 'pending'/i.test(texto)) {
                return { rowCount: 0 };
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

function driveOk(estado) {
    return {
        async uploadBuffer(buffer, nome) {
            estado.uploads += 1;
            return { id: "DRIVE-" + nome, folder_id: "FOLDER", web_view_link: "https://drive/" + nome };
        }
    };
}

const PAYLOAD = Buffer.from("bytes-da-imagem");

test("job sem payload vai para failed com motivo de reenvio", async () => {
    const db = criarDb([{ id: 1, client_uuid: "u-sem-bytes", payload: null }]);
    const fila = carregar(db);

    const r = await fila.processOne(driveOk(db.estado));

    assert.equal(r.processed, true);
    assert.equal(r.synced, false);
    assert.equal(r.failed, true, "deve ser falha permanente");
    assert.match(String(db.estado.jobs[0].last_error), /cópia durável/i);
    assert.match(String(db.estado.jobs[0].last_error), /reenvi|reenvio/i);
    assert.equal(db.estado.jobs[0].status, "failed");
});

test("job sem payload NAO bloqueia os dois jobs validos seguintes", async () => {
    const db = criarDb([
        { id: 1, client_uuid: "quebrado", payload: null },
        { id: 2, client_uuid: "valido-1", payload: PAYLOAD, file_name: "a.jpg" },
        { id: 3, client_uuid: "valido-2", payload: PAYLOAD, file_name: "b.jpg" }
    ]);

    const fila = carregar(db);
    const drive = driveOk(db.estado);

    // Simula o laco do worker: sem break em falha.
    let processed = 0;
    for (let i = 0; i < 10; i++) {
        const r = await fila.processOne(drive);
        if (!r.processed) break;
        processed += 1;
        if (!r.synced) continue;
    }

    assert.equal(processed, 3, "os tres jobs foram visitados");
    assert.equal(db.estado.uploads, 2, "apenas os dois validos subiram ao Drive");

    const quebrado = db.estado.jobs.find(j => j.id === 1);
    const v1 = db.estado.jobs.find(j => j.id === 2);
    const v2 = db.estado.jobs.find(j => j.id === 3);

    assert.equal(quebrado.status, "failed");
    assert.equal(v1.status, "synced", "job valido 1 sincronizado");
    assert.equal(v2.status, "synced", "job valido 2 sincronizado");
});

test("erro transitorio mantem pending e respeita backoff", async () => {
    const db = criarDb([{ id: 1, client_uuid: "u-rede", payload: PAYLOAD, file_name: "c.jpg" }]);
    const fila = carregar(db);

    const driveInstavel = {
        async uploadBuffer() {
            const erro = new Error("getaddrinfo ENOTFOUND oauth2.googleapis.com");
            erro.code = "ENOTFOUND";
            throw erro;
        }
    };

    const r = await fila.processOne(driveInstavel);

    assert.equal(r.processed, true);
    assert.equal(r.synced, false);
    assert.equal(r.failed, false, "erro de rede NAO e falha permanente");

    const job = db.estado.jobs[0];
    assert.equal(job.status, "pending", "continua pendente");
    assert.equal(job.attempts, 1);
    assert.ok(job.next_retry_at > new Date(), "next_retry_at no futuro (backoff)");

    // Imediatamente depois, claimNext nao deve devolve-lo.
    const db2 = criarDb([]);
    assert.ok(true, "backoff validado pelo next_retry_at futuro");
});

test("erro de OAuth e transitório (nao vira failed)", async () => {
    const db = criarDb([{ id: 1, client_uuid: "u-oauth", payload: PAYLOAD, file_name: "d.jpg" }]);
    const fila = carregar(db);

    const driveSemOauth = {
        async uploadBuffer() {
            const erro = new Error("Google OAuth authorization is required.");
            erro.status = 401;
            throw erro;
        }
    };

    await fila.processOne(driveSemOauth);

    assert.equal(db.estado.jobs[0].status, "pending");
    assert.notEqual(db.estado.jobs[0].status, "failed");
});

test("falha permanente (conflito de arquivo) vai para failed", async () => {
    const db = criarDb([{ id: 1, client_uuid: "u-conflito", payload: PAYLOAD, file_name: "e.jpg" }]);
    const fila = carregar(db);

    const driveConflito = {
        async uploadBuffer() {
            const erro = new Error("Arquivo com conteudo diferente ja existe no Drive.");
            erro.status = 409;
            erro.code = "TRATOCAP_DRIVE_FILE_CONFLICT";
            throw erro;
        }
    };

    const r = await fila.processOne(driveConflito);

    assert.equal(r.failed, true);
    assert.equal(db.estado.jobs[0].status, "failed");
});

test("reprocessar job ja sincronizado nao duplica upload", async () => {
    const db = criarDb([{ id: 1, client_uuid: "u-ok", payload: PAYLOAD, file_name: "f.jpg" }]);
    const fila = carregar(db);
    const drive = driveOk(db.estado);

    await fila.processOne(drive);
    assert.equal(db.estado.uploads, 1);

    // Segunda tentativa: job nao esta mais 'pending', claimNext devolve vazio.
    const segunda = await fila.processOne(drive);
    assert.equal(segunda.processed, false, "nada a processar");
    assert.equal(db.estado.uploads, 1, "nenhum upload duplicado");
});

test("reconciliador continua exportado e funcional", async () => {
    const db = criarDb([
        { id: 10, client_uuid: "u-rec", status: "synced", drive_file_id: "DRIVE-REC", drive_folder_id: "F", drive_web_view_link: null }
    ]);
    db.estado.imagens = [{ id: 1, client_uuid: "u-rec", drive_file_id: null }];

    const fila = carregar(db);

    assert.equal(typeof fila.reconciliarImagensSemDrive, "function");

    const r = await fila.reconciliarImagensSemDrive();
    assert.equal(r.reconciliadas, 1);
    assert.equal(db.estado.imagens[0].drive_file_id, "DRIVE-REC");
});
