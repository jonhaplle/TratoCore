const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

function loadQueueService(fakeDb) {
    const queuePath = require.resolve("./tratocapSyncQueue.service");
    const originalLoad = Module._load;
    delete require.cache[queuePath];
    Module._load = function (request, parent, isMain) {
        if (parent?.filename === queuePath && request === "../db") return fakeDb;
        return originalLoad.call(this, request, parent, isMain);
    };
    try {
        return originalLoad(queuePath, module, false);
    } finally {
        Module._load = originalLoad;
    }
}

function fakeDatabase(job) {
    const calls = [];
    return {
        calls,
        async query(sql, values) {
            calls.push({ sql, values });
            if (sql.includes("WITH candidate")) return { rows: [job] };
            return { rows: [] };
        }
    };
}

function pendingJob() {
    return {
        id: 42,
        client_uuid: "photo-uuid",
        sha256: "a".repeat(64),
        album_name: "Relogios",
        file_name: "photo-uuid.jpg",
        mime_type: "image/jpeg",
        payload: Buffer.from("original-photo"),
        status: "processing"
    };
}

test("fila persistente envia bytes originais e registra confirmação do Drive", async () => {
    const db = fakeDatabase(pendingJob());
    const queue = loadQueueService(db);
    const calls = [];
    const result = await queue.processOne({
        async uploadBuffer(...args) {
            calls.push(args);
            return {
                id: "drive-file-123",
                folder_id: "drive-folder-456",
                web_view_link: "https://drive.google.com/file/d/drive-file-123/view"
            };
        }
    });

    assert.deepEqual(result, { processed: true, synced: true, client_uuid: "photo-uuid" });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0][0], Buffer.from("original-photo"));
    assert.equal(calls[0][1], "photo-uuid.jpg");
    assert.equal(calls[0][3], "Relogios");
    assert.equal(calls[0][4], "photo-uuid");
    assert.ok(db.calls.some(call => call.sql.includes("payload = CASE") && call.sql.includes("imported_product_id IS NOT NULL")));
    assert.ok(db.calls.some(call => call.sql.includes("UPDATE product_images") && call.sql.includes("drive_sync_status = 'synced'")));
});

test("falha temporária preserva o payload e agenda nova tentativa com backoff", async () => {
    const db = fakeDatabase(pendingJob());
    const queue = loadQueueService(db);
    const result = await queue.processOne({
        async uploadBuffer() {
            throw new Error("Google Drive indisponível");
        }
    });

    assert.equal(result.processed, true);
    assert.equal(result.synced, false);
    assert.equal(result.error, "Google Drive indisponível");
    assert.ok(db.calls.some(call => call.sql.includes("next_retry_at = NOW() + make_interval")));
    assert.ok(db.calls.some(call => call.sql.includes("status = 'pending'") && call.sql.includes("last_error")));
});

test("conflito permanente de UUID/SHA fica em estado failed e não entra em retry automático", async () => {
    const db = fakeDatabase(pendingJob());
    const queue = loadQueueService(db);
    const conflict = new Error("Arquivo do Drive diverge do SHA-256 recebido.");
    conflict.status = 409;
    conflict.code = "TRATOCAP_DRIVE_FILE_CONFLICT";

    const result = await queue.processOne({
        async uploadBuffer() { throw conflict; }
    });

    assert.equal(result.failed, true);
    assert.ok(db.calls.some(call => call.sql.includes("status = 'failed'")));
});
