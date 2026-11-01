const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createGoogleDriveOAuthService, DRIVE_FILE_SCOPE, REDIRECT_URI } = require("./googleDriveOAuthService");

function fixture(tokenResponse = { access_token: "short-lived", refresh_token: "new-refresh" }) {
    const state = { refreshToken: null, selectedFolderId: null, selectedFolderName: null, writeVerifiedAt: null };
    const calls = [];
    const store = {
        async get() { return { ...state }; },
        async saveRefreshToken(token) { if (token) state.refreshToken = token; },
        async saveSelectedFolder(id, name) { state.selectedFolderId = id; state.selectedFolderName = name; state.writeVerifiedAt = null; },
        async markWriteVerified() { state.writeVerifiedAt = new Date(); }
    };
    class OAuth2 {
        constructor(id, secret, redirectUri) { calls.push({ client: [id, secret, redirectUri] }); }
        on() {}
        generateAuthUrl(options) { calls.push({ auth: options }); return "https://accounts.google.test/authorize"; }
        async getToken() { return { tokens: tokenResponse }; }
        setCredentials(credentials) { this.credentials = credentials; calls.push({ credentials }); }
        async getAccessToken() { return { token: "picker-access-token" }; }
    }
    const files = {
        async get(options) {
            calls.push({ get: options });
            if (options.alt === "media") return { data: Buffer.from(lastContent, "utf8") };
            return { data: { id: options.fileId, name: "Produtos", mimeType: "application/vnd.google-apps.folder" } };
        },
        async create(options) { calls.push({ create: options }); return { data: { id: "drive-file-1", name: options.requestBody.name, mimeType: options.media.mimeType } }; },
        async delete(options) { calls.push({ delete: options }); }
    };
    let lastContent = "";
    const driveApi = { files: {
        ...files,
        async create(options) {
            calls.push({ create: options });
            if (Buffer.isBuffer(options.media.body)) lastContent = options.media.body.toString("utf8");
            else if (options.media.body?.[Symbol.asyncIterator]) {
                for await (const chunk of options.media.body) lastContent += chunk.toString("utf8");
            }
            return { data: { id: "drive-file-1", name: options.requestBody.name, mimeType: options.media.mimeType } };
        }
    } };
    const google = { auth: { OAuth2 }, drive: () => driveApi };
    const env = {
        GOOGLE_OAUTH_CLIENT_ID: "configured-client-id",
        GOOGLE_OAUTH_CLIENT_SECRET: "configured-client-secret",
        GOOGLE_OAUTH_REDIRECT_URI: REDIRECT_URI,
        GOOGLE_OAUTH_ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"),
        GOOGLE_PICKER_API_KEY: "picker-key",
        GOOGLE_CLOUD_PROJECT_NUMBER: "123456"
    };
    return { service: createGoogleDriveOAuthService({ google, store, env }), state, calls };
}

test("authorization requests offline drive.file consent and stores refresh token", async () => {
    const { service, state, calls } = fixture();
    assert.equal(service.authorizationUrl("csrf-state"), "https://accounts.google.test/authorize");
    assert.deepEqual(calls.find(call => call.auth).auth, {
        access_type: "offline", prompt: "consent", include_granted_scopes: true,
        scope: [DRIVE_FILE_SCOPE], state: "csrf-state"
    });
    await service.completeAuthorization("authorization-code");
    assert.equal(state.refreshToken, "new-refresh");
});

test("reauthorization without refresh_token preserves the previously encrypted credential", async () => {
    const { service, state } = fixture({ access_token: "new-access-only" });
    state.refreshToken = "existing-refresh";
    await service.completeAuthorization("authorization-code");
    assert.equal(state.refreshToken, "existing-refresh");
});

test("Picker config returns scoped short-lived access token, API key and project number", async () => {
    const { service, state, calls } = fixture();
    state.refreshToken = "refresh";
    const config = await service.getPickerConfiguration();
    assert.deepEqual(config, {
        accessToken: "picker-access-token", developerKey: "picker-key", appId: "123456"
    });
    assert.ok(calls.some(call => call.credentials?.refresh_token === "refresh"), "refresh token is supplied to OAuth client for automatic access-token renewal");
});

test("only existing Produtos folder can be selected and selecting resets write verification", async () => {
    const { service, state } = fixture();
    state.refreshToken = "refresh";
    state.writeVerifiedAt = new Date();
    assert.deepEqual(await service.selectProductsFolder("existing-products-id"), { id: "existing-products-id", name: "Produtos" });
    assert.equal(state.writeVerifiedAt, null);
});

test("upload uses the selected folder, returns confirmed Drive ID, and rejects before verification", async () => {
    const { service, state, calls } = fixture();
    state.refreshToken = "refresh";
    state.selectedFolderId = "products-folder-id";
    state.selectedFolderName = "Produtos";
    const temp = path.join(os.tmpdir(), `tratocore-upload-${Date.now()}.txt`);
    fs.writeFileSync(temp, "non-product test payload");
    try {
        await assert.rejects(service.uploadFile(temp, "sample.txt", "text/plain"), /Verify Google Drive write access/);
        state.writeVerifiedAt = new Date();
        const uploaded = await service.uploadFile(temp, "sample.txt", "text/plain");
        assert.equal(uploaded.id, "drive-file-1");
        assert.equal(calls.find(call => call.create).create.requestBody.parents[0], "products-folder-id");
    } finally { fs.unlinkSync(temp); }
});

test("temporary verification reads matching content and deletes the file", async () => {
    const { service, state, calls } = fixture();
    state.refreshToken = "refresh";
    state.selectedFolderId = "products-folder-id";
    state.selectedFolderName = "Produtos";
    const result = await service.verifyWrite();
    assert.deepEqual(result, { success: true, verified: true });
    assert.equal(calls.filter(call => call.delete).length, 1);
    assert.ok(state.writeVerifiedAt);
});

test("failed read cleans up temporary file and does not mark verified", async () => {
    const { service, state } = fixture();
    state.refreshToken = "refresh";
    state.selectedFolderId = "products-folder-id";
    state.selectedFolderName = "Produtos";
    const { drive } = await service.getAuthorizedDrive();
    drive.files.get = async () => ({ data: Buffer.from("wrong") });
    await assert.rejects(service.verifyWrite(), /did not match/);
    assert.equal(state.writeVerifiedAt, null);
});
