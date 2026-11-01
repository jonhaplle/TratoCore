const crypto = require("crypto");

const TABLE = "google_drive_oauth";
const SINGLETON_ID = 1;

function encryptionKey(value = process.env.GOOGLE_OAUTH_ENCRYPTION_KEY) {
    if (!value) throw new Error("Google OAuth storage is not configured.");
    const key = /^[a-f0-9]{64}$/i.test(value)
        ? Buffer.from(value, "hex")
        : Buffer.from(value, "base64");
    if (key.length !== 32) throw new Error("Google OAuth storage is not configured.");
    return key;
}

function encrypt(value, keyValue) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(keyValue), iv);
    const ciphertext = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
    return { ciphertext, iv, tag: cipher.getAuthTag() };
}

function decrypt(record, keyValue) {
    const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(keyValue), record.iv);
    decipher.setAuthTag(record.tag);
    return Buffer.concat([decipher.update(record.ciphertext), decipher.final()]).toString("utf8");
}

function createGoogleDriveOAuthStore(pool, options = {}) {
    const getKey = options.getKey || (() => process.env.GOOGLE_OAUTH_ENCRYPTION_KEY);
    let schemaPromise;
    async function ensureSchema() {
        if (!schemaPromise) {
            schemaPromise = pool.query(`
                CREATE TABLE IF NOT EXISTS ${TABLE} (
                    id SMALLINT PRIMARY KEY CHECK (id = ${SINGLETON_ID}),
                    refresh_token_ciphertext BYTEA,
                    refresh_token_iv BYTEA,
                    refresh_token_tag BYTEA,
                    selected_folder_id TEXT,
                    selected_folder_name TEXT,
                    write_verified_at TIMESTAMPTZ,
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
            `).catch(error => { schemaPromise = null; throw error; });
        }
        await schemaPromise;
    }

    async function get() {
        await ensureSchema();
        const result = await pool.query(`SELECT * FROM ${TABLE} WHERE id = $1`, [SINGLETON_ID]);
        const row = result.rows[0];
        if (!row) return null;
        const refreshToken = row.refresh_token_ciphertext
            ? decrypt({
                ciphertext: row.refresh_token_ciphertext,
                iv: row.refresh_token_iv,
                tag: row.refresh_token_tag
            }, getKey())
            : null;
        return {
            refreshToken,
            selectedFolderId: row.selected_folder_id,
            selectedFolderName: row.selected_folder_name,
            writeVerifiedAt: row.write_verified_at
        };
    }

    async function saveRefreshToken(refreshToken) {
        await ensureSchema();
        const existing = await get();
        const chosenToken = refreshToken || existing?.refreshToken;
        if (!chosenToken) throw new Error("Google OAuth authorization is incomplete.");
        const sealed = encrypt(chosenToken, getKey());
        await pool.query(`
            INSERT INTO ${TABLE} (id, refresh_token_ciphertext, refresh_token_iv, refresh_token_tag)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (id) DO UPDATE SET
                refresh_token_ciphertext = EXCLUDED.refresh_token_ciphertext,
                refresh_token_iv = EXCLUDED.refresh_token_iv,
                refresh_token_tag = EXCLUDED.refresh_token_tag,
                updated_at = NOW()
        `, [SINGLETON_ID, sealed.ciphertext, sealed.iv, sealed.tag]);
    }

    async function saveSelectedFolder(id, name) {
        await ensureSchema();
        await pool.query(`
            INSERT INTO ${TABLE} (id, selected_folder_id, selected_folder_name, write_verified_at)
            VALUES ($1, $2, $3, NULL)
            ON CONFLICT (id) DO UPDATE SET
                selected_folder_id = EXCLUDED.selected_folder_id,
                selected_folder_name = EXCLUDED.selected_folder_name,
                write_verified_at = NULL,
                updated_at = NOW()
        `, [SINGLETON_ID, id, name]);
    }

    async function markWriteVerified() {
        await ensureSchema();
        await pool.query(`UPDATE ${TABLE} SET write_verified_at = NOW(), updated_at = NOW() WHERE id = $1`, [SINGLETON_ID]);
    }

    return { ensureSchema, get, saveRefreshToken, saveSelectedFolder, markWriteVerified };
}

module.exports = { createGoogleDriveOAuthStore, encrypt, decrypt };
