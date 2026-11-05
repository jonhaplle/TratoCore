-- Galeria definitiva: sincronização durável TratoCap -> Google Drive.
-- Pode ser executada mais de uma vez sem apagar dados existentes.

ALTER TABLE product_images
    ADD COLUMN IF NOT EXISTS client_uuid TEXT,
    ADD COLUMN IF NOT EXISTS sha256 CHAR(64),
    ADD COLUMN IF NOT EXISTS drive_sync_status VARCHAR(20) NOT NULL DEFAULT 'pending',
    ADD COLUMN IF NOT EXISTS drive_sync_error TEXT,
    ADD COLUMN IF NOT EXISTS drive_synced_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS uq_product_images_client_uuid
    ON product_images(client_uuid)
    WHERE client_uuid IS NOT NULL;

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
);

CREATE INDEX IF NOT EXISTS idx_tratocap_sync_jobs_pending
    ON tratocap_sync_jobs(status, updated_at)
    WHERE status IN ('pending', 'processing');
