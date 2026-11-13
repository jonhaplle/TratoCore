const db = require("../db");

let schemaPromise;

async function ensureSchema() {
    if (!schemaPromise) {
        schemaPromise = (async () => {
            await db.query(`
                ALTER TABLE product_images
                    ADD COLUMN IF NOT EXISTS drive_file_id TEXT,
                    ADD COLUMN IF NOT EXISTS drive_folder_id TEXT,
                    ADD COLUMN IF NOT EXISTS drive_web_view_link TEXT,
                    ADD COLUMN IF NOT EXISTS client_uuid TEXT,
                    ADD COLUMN IF NOT EXISTS sha256 CHAR(64),
                    ADD COLUMN IF NOT EXISTS drive_sync_status VARCHAR(20) NOT NULL DEFAULT 'pending',
                    ADD COLUMN IF NOT EXISTS selected_for_ml BOOLEAN NOT NULL DEFAULT TRUE,
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
                    destination TEXT NOT NULL DEFAULT 'product',
                    note TEXT,
                    original_name TEXT,
                    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    imported_product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
                    payload BYTEA,
                    status VARCHAR(20) NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'processing', 'synced', 'failed')),
                    next_retry_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
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
                ALTER TABLE tratocap_sync_jobs
                    ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    ADD COLUMN IF NOT EXISTS destination TEXT NOT NULL DEFAULT 'product',
                    ADD COLUMN IF NOT EXISTS note TEXT,
                    ADD COLUMN IF NOT EXISTS original_name TEXT,
                    ADD COLUMN IF NOT EXISTS received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    ADD COLUMN IF NOT EXISTS imported_product_id INTEGER REFERENCES products(id) ON DELETE SET NULL
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
            (client_uuid, sha256, album_name, file_name, mime_type, destination, note, original_name, received_at, payload, status)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending')
        ON CONFLICT (client_uuid) DO NOTHING
        RETURNING *
    `, [
        job.client_uuid,
        job.sha256,
        job.album_name,
        job.file_name,
        job.mime_type || "image/jpeg",
        job.destination || "product",
        job.note || "",
        job.original_name || "",
        job.received_at || new Date(),
        job.payload
    ]);

    if (result.rows[0]) return result.rows[0];

    const existing = await db.query(
        "SELECT * FROM tratocap_sync_jobs WHERE client_uuid = $1",
        [job.client_uuid]
    );
    const row = existing.rows[0];
    if (!row) throw new Error("Não foi possível confirmar o registro de sincronização.");
    if (
        String(row.sha256).trim() !== String(job.sha256).trim() ||
        String(row.album_name) !== String(job.album_name) ||
        String(row.file_name) !== String(job.file_name) ||
        String(row.destination || "product") !== String(job.destination || "product")
    ) {
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
            WHERE (status = 'pending' AND next_retry_at <= NOW())
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
            payload = CASE
                WHEN destination = 'gallery' OR imported_product_id IS NOT NULL THEN NULL
                ELSE payload
            END,
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

/**
 * Reconcilia `product_images.drive_file_id` com os jobs JÁ sincronizados.
 *
 * Necessário porque a importação pode criar a linha em `product_images`
 * DEPOIS de o job ser sincronizado — nesse caso o UPDATE do `markSynced`
 * não encontra a linha e o vínculo com o Drive se perde.
 *
 * Idempotente: só toca imagens ainda sem `drive_file_id`.
 */
async function reconciliarImagensSemDrive({ limite = 50 } = {}) {
    await ensureSchema();

    const { rows } = await db.query(`
        UPDATE product_images AS img
        SET drive_file_id = job.drive_file_id,
            drive_folder_id = job.drive_folder_id,
            drive_web_view_link = job.drive_web_view_link,
            drive_sync_status = 'synced',
            drive_sync_error = NULL,
            drive_synced_at = COALESCE(job.synced_at, NOW())
        FROM (
            SELECT DISTINCT ON (client_uuid)
                   client_uuid, drive_file_id, drive_folder_id, drive_web_view_link, synced_at
            FROM tratocap_sync_jobs
            WHERE status = 'synced'
              AND drive_file_id IS NOT NULL
              AND client_uuid IS NOT NULL
            ORDER BY client_uuid, id DESC
        ) AS job
        WHERE img.client_uuid = job.client_uuid
          AND img.drive_file_id IS NULL
        RETURNING img.id
    `);

    return { reconciliadas: rows.length };
}

async function markFailed(job, error) {
    const message = String(error?.message || error || "Falha permanente").slice(0, 2000);
    await db.query(`
        UPDATE tratocap_sync_jobs
        SET status = 'failed',
            last_error = $2,
            next_retry_at = NOW() + make_interval(secs => LEAST(60 * attempts, 900)),
            updated_at = NOW()
        WHERE id = $1
    `, [job.id, message]);
    await db.query(`
        UPDATE product_images
        SET drive_sync_status = 'failed',
            drive_sync_error = $2
        WHERE client_uuid = $1
    `, [job.client_uuid, message]);
}

async function markPending(job, error) {
    const message = String(error?.message || error || "Falha desconhecida").slice(0, 2000);
    await db.query(`
        UPDATE tratocap_sync_jobs
        SET status = 'pending',
            last_error = $2,
            next_retry_at = NOW() + make_interval(secs => LEAST(60 * attempts, 900)),
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

/**
 * Decide se um erro é PERMANENTE (não adianta tentar de novo com o mesmo
 * estado) ou TRANSITÓRIO (rede, Drive, OAuth — pode funcionar depois).
 */
function ehFalhaPermanente(error) {
    if (!error) return false;

    if (error.status === 409 || error.code === "TRATOCAP_DRIVE_FILE_CONFLICT") {
        return true;
    }
    if (error.code === "TRATOCAP_SEM_COPIA_DURAVEL" || error.code === "TRATOCAP_PAYLOAD_INVALIDO") {
        return true;
    }

    return false;
}

async function processOne(driveService) {
    const job = await claimNext();
    if (!job) return { processed: false };

    try {
        // Job sem bytes no PostgreSQL nunca vai sincronizar por retry:
        // sem a cópia durável, reenviar o arquivo é a única saída.
        // Marcá-lo como failed evita que ele bloqueie a fila para sempre.
        if (!job.payload) {
            const erro = new Error(
                "Imagem sem cópia durável no PostgreSQL. " +
                "O arquivo precisa ser reenviado pelo TratoCap."
            );
            erro.code = "TRATOCAP_SEM_COPIA_DURAVEL";

            await markFailed(job, erro);

            return {
                processed: true,
                synced: false,
                failed: true,
                permanente: true,
                client_uuid: job.client_uuid,
                error: erro.message
            };
        }

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
        const permanente = ehFalhaPermanente(error);

        if (permanente) {
            await markFailed(job, error);
        } else {
            await markPending(job, error);
        }

        return {
            processed: true,
            synced: false,
            failed: permanente,
            permanente,
            client_uuid: job.client_uuid,
            error: error.message
        };
    }
}


async function markAlbumImported(albumName, productId) {
    await ensureSchema();
    await db.query(`
        UPDATE tratocap_sync_jobs
        SET imported_product_id = $2,
            payload = CASE WHEN status = 'synced' THEN NULL ELSE payload END,
            updated_at = NOW()
        WHERE album_name = $1
          AND destination = 'product'
          AND imported_product_id IS NULL
    `, [albumName, productId]);
}

async function getUnimportedProductImages() {
    await ensureSchema();
    const result = await db.query(`
        SELECT *
        FROM tratocap_sync_jobs
        WHERE destination = 'product'
          AND payload IS NOT NULL
        ORDER BY created_at ASC
    `);
    return result.rows;
}

async function getByClientUuid(clientUuid) {
    await ensureSchema();
    const result = await db.query(
        "SELECT * FROM tratocap_sync_jobs WHERE client_uuid = $1",
        [clientUuid]
    );
    return result.rows[0] || null;
}

async function clearPending() {
    await ensureSchema();
    const result = await db.query(`
        WITH deleted AS (
            DELETE FROM tratocap_sync_jobs
            WHERE status = 'pending'
            RETURNING 1
        )
        SELECT
            (SELECT COUNT(*)::INTEGER FROM deleted) AS deleted,
            (SELECT COUNT(*)::INTEGER FROM tratocap_sync_jobs WHERE status = 'pending') AS remaining_pending
    `);
    return result.rows[0] || { deleted: 0, remaining_pending: 0 };
}

async function getStatus() {
    await ensureSchema();
    const result = await db.query(`
        SELECT
            COUNT(*) FILTER (WHERE status = 'pending')::INTEGER AS pending,
            COUNT(*) FILTER (WHERE status = 'processing')::INTEGER AS processing,
            COUNT(*) FILTER (WHERE status = 'synced')::INTEGER AS synced,
            COUNT(*) FILTER (WHERE status = 'failed')::INTEGER AS failed
        FROM tratocap_sync_jobs
    `);
    return result.rows[0] || { pending: 0, processing: 0, synced: 0 };
}

module.exports = { ensureSchema, enqueue, processOne, markAlbumImported, getUnimportedProductImages, getByClientUuid, getStatus, clearPending, reconciliarImagensSemDrive };
