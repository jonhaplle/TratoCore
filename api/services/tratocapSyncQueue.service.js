const db = require("../db");

let schemaPromise;

async function ensureSchema() {
    if (!schemaPromise) {
        schemaPromise = (async () => {
            await db.query(`
                ALTER TABLE product_images
                    ADD COLUMN IF NOT EXISTS client_uuid TEXT,
                    ADD COLUMN IF NOT EXISTS sha256 CHAR(64),
                    ADD COLUMN IF NOT EXISTS drive_sync_status VARCHAR(20) NOT NULL DEFAULT 'pending',
                    ADD COLUMN IF NOT EXISTS drive_sync_error TEXT,
                    ADD COLUMN IF NOT EXISTS drive_synced_at TIMESTAMPTZ
            `);
            await db.query(`
                UPDATE product_images
                SET drive_sync_status = 'synced',
                    drive_synced_at = COALESCE(drive_synced_at, NOW()),
                    drive_sync_error = NULL
                WHERE drive_file_id IS NOT NULL
                  AND drive_sync_status = 'pending'
            `);
            await db.query(`
                CREATE UNIQUE INDEX IF NOT EXISTS uq_product_images_client_uuid
                    ON product_images(client_uuid)
                    WHERE client_uuid IS NOT NULL
            `);
            await db.query(`
                CREATE TABLE IF NOT EXISTS tratocap_sync_jobs (
                    id BIGSERIAL PRIMARY KEY,
                    client_uuid TEXT NOT NULL UNIQUE,
                    sha256 CHAR(64) NOT NULL,
                    album_name TEXT NOT NULL,
                    file_name TEXT NOT NULL,
                    mime_type TEXT NOT NULL,
                    payload BYTEA,
                    status VARCHAR(20) NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'processing', 'synced')),
                    attempts INTEGER NOT NULL DEFAULT 0,
                    last_error TEXT,
                    drive_file_id TEXT,
                    drive_folder_id TEXT,
                    drive_web_view_link TEXT,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    synced_at TIMESTAMPTZ
                )
            `);
            await db.query(`
                CREATE INDEX IF NOT EXISTS idx_tratocap_sync_jobs_pending
                    ON tratocap_sync_jobs(status, updated_at)
                    WHERE status IN ('pending', 'processing')
            `);
        })().catch(error => {
            schemaPromise = null;
            throw error;
        });
    }
    return schemaPromise;
}

async function enqueue(job) {
    await ensureSchema();
    const result = await db.query(`
        INSERT INTO tratocap_sync_jobs
            (client_uuid, sha256, album_name, file_name, mime_type, payload, status)
        VALUES ($1, $2, $3, $4, $5, $6, 'pending')
        ON CONFLICT (client_uuid) DO NOTHING
        RETURNING *
    `, [
        job.client_uuid,
        job.sha256,
        job.album_name,
        job.file_name,
        job.mime_type || "image/jpeg",
        job.payload
    ]);

    if (result.rows[0]) return result.rows[0];

    const existing = await db.query(
        "SELECT * FROM tratocap_sync_jobs WHERE client_uuid = $1",
        [job.client_uuid]
    );
    const row = existing.rows[0];
    if (!row) throw new Error("Não foi possível confirmar o registro de sincronização.");
    if (String(row.sha256).trim() !== String(job.sha256).trim()) {
        const error = new Error("client_uuid já utilizado por outra imagem.");
        error.status = 409;
        error.code = "TRATOCAP_UUID_CONFLICT";
        throw error;
    }
    return row;
}

async function claimNext() {
    await ensureSchema();
    const result = await db.query(`
        WITH candidate AS (
            SELECT id
            FROM tratocap_sync_jobs
            WHERE status = 'pending'
               OR (status = 'processing' AND updated_at < NOW() - INTERVAL '10 minutes')
            ORDER BY created_at ASC
            FOR UPDATE SKIP LOCKED
            LIMIT 1
        )
        UPDATE tratocap_sync_jobs AS job
        SET status = 'processing',
            attempts = attempts + 1,
            updated_at = NOW(),
            last_error = NULL
        FROM candidate
        WHERE job.id = candidate.id
        RETURNING job.*
    `);
    return result.rows[0] || null;
}

async function markSynced(job, driveFile) {
    await db.query(`
        UPDATE tratocap_sync_jobs
        SET status = 'synced',
            payload = NULL,
            drive_file_id = $2,
            drive_folder_id = $3,
            drive_web_view_link = $4,
            last_error = NULL,
            synced_at = NOW(),
            updated_at = NOW()
        WHERE id = $1
    `, [job.id, driveFile.id, driveFile.folder_id, driveFile.web_view_link || null]);

    await db.query(`
        UPDATE product_images
        SET drive_file_id = $2,
            drive_folder_id = $3,
            drive_web_view_link = $4,
            drive_sync_status = 'synced',
            drive_sync_error = NULL,
            drive_synced_at = NOW()
        WHERE client_uuid = $1
    `, [job.client_uuid, driveFile.id, driveFile.folder_id, driveFile.web_view_link || null]);
}

async function markPending(job, error) {
    const message = String(error?.message || error || "Falha desconhecida").slice(0, 2000);
    await db.query(`
        UPDATE tratocap_sync_jobs
        SET status = 'pending',
            last_error = $2,
            updated_at = NOW()
        WHERE id = $1
    `, [job.id, message]);

    await db.query(`
        UPDATE product_images
        SET drive_sync_status = 'pending',
            drive_sync_error = $2
        WHERE client_uuid = $1
    `, [job.client_uuid, message]);
}

async function processOne(driveService) {
    const job = await claimNext();
    if (!job) return { processed: false };

    try {
        if (!job.payload) throw new Error("Imagem pendente sem cópia durável no PostgreSQL.");
        const uploaded = await driveService.uploadBuffer(
            job.payload,
            job.file_name,
            job.mime_type,
            job.album_name,
            job.client_uuid
        );
        await markSynced(job, uploaded);
        return { processed: true, synced: true, client_uuid: job.client_uuid };
    } catch (error) {
        await markPending(job, error);
        return { processed: true, synced: false, client_uuid: job.client_uuid, error: error.message };
    }
}

async function getByClientUuid(clientUuid) {
    await ensureSchema();
    const result = await db.query(
        "SELECT * FROM tratocap_sync_jobs WHERE client_uuid = $1",
        [clientUuid]
    );
    return result.rows[0] || null;
}

async function getStatus() {
    await ensureSchema();
    const result = await db.query(`
        SELECT
            COUNT(*) FILTER (WHERE status = 'pending')::INTEGER AS pending,
            COUNT(*) FILTER (WHERE status = 'processing')::INTEGER AS processing,
            COUNT(*) FILTER (WHERE status = 'synced')::INTEGER AS synced
        FROM tratocap_sync_jobs
    `);
    return result.rows[0] || { pending: 0, processing: 0, synced: 0 };
}

module.exports = { ensureSchema, enqueue, processOne, getByClientUuid, getStatus };
