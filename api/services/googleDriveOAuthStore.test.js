const test = require("node:test");
const assert = require("node:assert/strict");
const { createGoogleDriveOAuthStore, encrypt, decrypt } = require("./googleDriveOAuthStore");

const KEY = Buffer.alloc(32, 7).toString("base64");

test("AES-GCM encrypts and authenticates the refresh token", () => {
    const sealed = encrypt("refresh-token-value", KEY);
    assert.equal(sealed.ciphertext.includes(Buffer.from("refresh-token-value")), false);
    assert.equal(decrypt(sealed, KEY), "refresh-token-value");
    sealed.tag[0] ^= 1;
    assert.throws(() => decrypt(sealed, KEY));
});

test("PostgreSQL store persists only ciphertext and retains refresh token when Google omits it", async () => {
    let row = null;
    const statements = [];
    const pool = {
        async query(sql, values = []) {
            statements.push({ sql, values });
            if (sql.includes("SELECT *")) return { rows: row ? [row] : [] };
            if (sql.includes("INSERT INTO google_drive_oauth (id, refresh_token_ciphertext")) {
                row = { id: 1, refresh_token_ciphertext: values[1], refresh_token_iv: values[2], refresh_token_tag: values[3] };
            }
            return { rows: [] };
        }
    };
    const store = createGoogleDriveOAuthStore(pool, { getKey: () => KEY });
    await store.saveRefreshToken("refresh-token-value");
    await store.saveRefreshToken(null);
    assert.equal((await store.get()).refreshToken, "refresh-token-value");
    assert.equal(row.refresh_token_ciphertext.includes(Buffer.from("refresh-token-value")), false);
    assert.equal(statements.some(item => item.values?.some(value => value === "refresh-token-value")), false);
});

test("encryption rejects a missing or invalid-length key", () => {
    assert.throws(() => encrypt("token", "short"), /not configured/i);
});
