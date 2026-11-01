const crypto = require("crypto");
const { google } = require("googleapis");
const { createGoogleDriveOAuthStore } = require("./googleDriveOAuthStore");

const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const REDIRECT_URI = "https://tratocore.onrender.com/api/google-drive/oauth/callback";

function createGoogleDriveOAuthService(options = {}) {
    const googleApi = options.google || google;
    const store = options.store || createGoogleDriveOAuthStore(options.pool || require("../db"), options.storeOptions);
    const env = options.env || process.env;
    const redirectUri = env.GOOGLE_OAUTH_REDIRECT_URI || REDIRECT_URI;

    function configured() {
        return Boolean(env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET && env.GOOGLE_OAUTH_ENCRYPTION_KEY);
    }

    function createClient() {
        if (!configured()) throw new Error("Google OAuth is not configured.");
        const client = new googleApi.auth.OAuth2(
            env.GOOGLE_OAUTH_CLIENT_ID,
            env.GOOGLE_OAUTH_CLIENT_SECRET,
            redirectUri
        );
        client.on("tokens", tokens => {
            if (tokens.refresh_token) store.saveRefreshToken(tokens.refresh_token).catch(() => {});
        });
        return client;
    }

    function authorizationUrl(state) {
        const client = createClient();
        return client.generateAuthUrl({
            access_type: "offline",
            prompt: "consent",
            include_granted_scopes: true,
            scope: [DRIVE_FILE_SCOPE],
            state
        });
    }

    async function completeAuthorization(code) {
        if (!configured()) throw new Error("Google OAuth is not configured.");
        const client = createClient();
        const result = await client.getToken(code);
        const tokens = result.tokens || result;
        await store.saveRefreshToken(tokens.refresh_token || null);
        client.setCredentials(tokens);
    }

    async function getAuthorizedDrive() {
        const saved = await store.get();
        if (!saved?.refreshToken) throw new Error("Google OAuth authorization is required.");
        const client = createClient();
        client.setCredentials({ refresh_token: saved.refreshToken });
        return { drive: googleApi.drive({ version: "v3", auth: client }), client, saved };
    }

    async function getPickerConfiguration() {
        const { client } = await getAuthorizedDrive();
        const token = await client.getAccessToken();
        const accessToken = typeof token === "string" ? token : token?.token;
        if (!accessToken) throw new Error("Google OAuth authorization is required.");
        if (!env.GOOGLE_PICKER_API_KEY || !env.GOOGLE_CLOUD_PROJECT_NUMBER) {
            throw new Error("Google Picker is not configured.");
        }
        return {
            accessToken,
            developerKey: env.GOOGLE_PICKER_API_KEY,
            appId: env.GOOGLE_CLOUD_PROJECT_NUMBER
        };
    }

    async function selectProductsFolder(fileId) {
        const { drive } = await getAuthorizedDrive();
        const response = await drive.files.get({
            fileId,
            fields: "id,name,mimeType,parents,driveId",
            supportsAllDrives: false
        });
        const folder = response.data;
        if (folder.mimeType !== "application/vnd.google-apps.folder" || folder.name !== "Produtos") {
            throw new Error("Select the existing Produtos folder from Google Picker.");
        }
        await store.saveSelectedFolder(folder.id, folder.name);
        return { id: folder.id, name: folder.name };
    }

    async function uploadFile(filePath, fileName, mimeType) {
        const { drive, saved } = await getAuthorizedDrive();
        if (!saved.selectedFolderId || saved.selectedFolderName !== "Produtos") {
            throw new Error("Select the existing Produtos folder with Google Picker first.");
        }
        if (!saved.writeVerifiedAt) throw new Error("Verify Google Drive write access before uploading images.");
        const result = await drive.files.create({
            requestBody: { name: fileName, parents: [saved.selectedFolderId] },
            media: { mimeType: mimeType || "application/octet-stream", body: require("fs").createReadStream(filePath) },
            fields: "id,name,mimeType,webViewLink,webContentLink"
        });
        if (!result.data?.id) throw new Error("Google Drive did not confirm the upload.");
        return {
            id: result.data.id,
            name: result.data.name,
            folder_id: saved.selectedFolderId,
            web_view_link: result.data.webViewLink || null,
            web_content_link: result.data.webContentLink || null,
            reused_existing: false
        };
    }

    async function deleteFile(fileId) {
        const { drive } = await getAuthorizedDrive();
        await drive.files.delete({ fileId });
    }

    async function getFileMetadata(fileId) {
        const { drive } = await getAuthorizedDrive();
        const response = await drive.files.get({ fileId, fields: "id,name,mimeType" });
        return response.data;
    }

    async function getFileStream(fileId) {
        const { drive } = await getAuthorizedDrive();
        const response = await drive.files.get({ fileId, alt: "media" }, { responseType: "stream" });
        return response.data;
    }

    async function verifyWrite() {
        const { drive, saved } = await getAuthorizedDrive();
        if (!saved.selectedFolderId || saved.selectedFolderName !== "Produtos") {
            throw new Error("Select the existing Produtos folder with Google Picker first.");
        }
        const content = `TratoCore Drive verification ${crypto.randomUUID()}`;
        let fileId;
        try {
            const created = await drive.files.create({
                requestBody: { name: `.tratocore-drive-check-${crypto.randomUUID()}.txt`, parents: [saved.selectedFolderId] },
                media: { mimeType: "text/plain", body: Buffer.from(content, "utf8") },
                fields: "id,name"
            });
            fileId = created.data?.id;
            if (!fileId) throw new Error("Google Drive did not confirm the test file.");
            const downloaded = await drive.files.get({ fileId, alt: "media" }, { responseType: "arraybuffer" });
            const bytes = Buffer.isBuffer(downloaded.data) ? downloaded.data : Buffer.from(downloaded.data);
            if (bytes.toString("utf8") !== content) throw new Error("Google Drive test file did not match.");
            await drive.files.delete({ fileId });
            fileId = null;
            await store.markWriteVerified();
            return { success: true, verified: true };
        } finally {
            if (fileId) {
                try { await drive.files.delete({ fileId }); } catch (_) { /* best-effort cleanup */ }
            }
        }
    }

    async function getStatus() {
        const saved = await store.get();
        return {
            authorized: Boolean(saved?.refreshToken),
            folderSelected: Boolean(saved?.selectedFolderId),
            folderName: saved?.selectedFolderName || null,
            writeVerified: Boolean(saved?.writeVerifiedAt)
        };
    }

    return { configured, authorizationUrl, completeAuthorization, getAuthorizedDrive, getPickerConfiguration, selectProductsFolder, uploadFile, deleteFile, getFileMetadata, getFileStream, verifyWrite, getStatus, store };
}

module.exports = { createGoogleDriveOAuthService, DRIVE_FILE_SCOPE, REDIRECT_URI };
