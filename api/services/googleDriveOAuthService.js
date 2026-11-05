const crypto = require("crypto");
const { Readable } = require("stream");
const fs = require("fs");
const { google } = require("googleapis");
const { createGoogleDriveOAuthStore } = require("./googleDriveOAuthStore");

const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const REDIRECT_URI = "https://tratocore.onrender.com/api/google-drive/oauth/callback";
const FOTOS_FOLDER_NAME = "FOTOS";
const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";

function escapeDriveQuery(value) {
    return String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

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

    async function selectRootFolder(fileId) {
        const { drive } = await getAuthorizedDrive();
        const response = await drive.files.get({
            fileId,
            fields: "id,name,mimeType,parents,driveId",
            supportsAllDrives: false
        });
        const folder = response.data;
        if (folder.mimeType !== FOLDER_MIME_TYPE || folder.name !== FOTOS_FOLDER_NAME) {
            throw new Error("Selecione a pasta existente FOTOS no Google Picker.");
        }
        await store.saveSelectedFolder(folder.id, folder.name);
        return { id: folder.id, name: folder.name };
    }

    // Alias de compatibilidade para integrações antigas. A pasta selecionada
    // agora é sempre a raiz FOTOS; os álbuns são subpastas criadas pelo TratoCore.
    const selectProductsFolder = selectRootFolder;

    async function getSelectedRoot(drive, saved) {
        if (!saved?.selectedFolderId || saved.selectedFolderName !== FOTOS_FOLDER_NAME) {
            throw new Error("Selecione a pasta FOTOS no Google Picker antes de sincronizar.");
        }
        const response = await drive.files.get({
            fileId: saved.selectedFolderId,
            fields: "id,name,mimeType"
        });
        if (response.data?.mimeType !== FOLDER_MIME_TYPE || response.data?.name !== FOTOS_FOLDER_NAME) {
            throw new Error("A pasta raiz configurada não é mais a pasta FOTOS.");
        }
        return response.data;
    }

    async function findOrCreateAlbumFolder(drive, rootId, albumName) {
        const name = String(albumName || "Sem_Album").trim().slice(0, 120) || "Sem_Album";
        const q = [
            "'" + rootId + "' in parents",
            "mimeType = '" + FOLDER_MIME_TYPE + "'",
            "name = '" + escapeDriveQuery(name) + "'",
            "trashed = false"
        ].join(" and ");
        const found = await drive.files.list({
            q,
            pageSize: 20,
            fields: "files(id,name,mimeType)"
        });
        const existing = found.data?.files?.[0];
        if (existing) return existing;

        const created = await drive.files.create({
            requestBody: { name, mimeType: FOLDER_MIME_TYPE, parents: [rootId] },
            fields: "id,name,mimeType"
        });
        if (!created.data?.id) throw new Error("Google Drive não confirmou a criação do álbum.");
        return created.data;
    }

    async function uploadBuffer(buffer, fileName, mimeType, albumName, clientUuid) {
        const { drive, saved } = await getAuthorizedDrive();
        if (!saved.writeVerifiedAt) throw new Error("Valide a gravação no Google Drive antes de sincronizar.");
        const root = await getSelectedRoot(drive, saved);
        const folder = await findOrCreateAlbumFolder(drive, root.id, albumName);
        const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
        const contentHash = crypto.createHash("sha256").update(bytes).digest("hex");
        const safeName = String(fileName || (clientUuid || crypto.randomUUID()) + ".jpg").replace(/[\\/]/g, "_");
        const q = [
            "'" + folder.id + "' in parents",
            "name = '" + escapeDriveQuery(safeName) + "'",
            "trashed = false"
        ].join(" and ");
        const existing = await drive.files.list({
            q,
            pageSize: 10,
            fields: "files(id,name,mimeType,webViewLink,webContentLink,appProperties)"
        });
        const reused = existing.data?.files?.[0];
        if (reused?.id) {
            const savedUuid = reused.appProperties?.tratocore_client_uuid;
            const savedHash = reused.appProperties?.tratocore_sha256;
            if (String(savedUuid || "") !== String(clientUuid || "") || String(savedHash || "") !== contentHash) {
                const conflict = new Error("Já existe um arquivo com este nome no álbum, mas o conteúdo não corresponde ao client_uuid/SHA-256 recebido.");
                conflict.status = 409;
                conflict.code = "TRATOCAP_DRIVE_FILE_CONFLICT";
                throw conflict;
            }
            return {
                id: reused.id,
                name: reused.name,
                folder_id: folder.id,
                web_view_link: reused.webViewLink || null,
                web_content_link: reused.webContentLink || null,
                reused_existing: true
            };
        }

        const result = await drive.files.create({
            requestBody: {
                name: safeName,
                parents: [folder.id],
                appProperties: clientUuid ? {
                    tratocore_client_uuid: String(clientUuid),
                    tratocore_sha256: contentHash
                } : undefined
            },
            media: {
                mimeType: mimeType || "application/octet-stream",
                body: Readable.from([bytes])
            },
            fields: "id,name,mimeType,webViewLink,webContentLink"
        });
        if (!result.data?.id) throw new Error("Google Drive não confirmou o upload da imagem.");
        return {
            id: result.data.id,
            name: result.data.name,
            folder_id: folder.id,
            web_view_link: result.data.webViewLink || null,
            web_content_link: result.data.webContentLink || null,
            reused_existing: false
        };
    }

    async function uploadFile(filePath, fileName, mimeType) {
        // Compatibilidade com chamadas antigas: grava diretamente na raiz FOTOS.
        const { drive, saved } = await getAuthorizedDrive();
        const root = await getSelectedRoot(drive, saved);
        if (!saved.writeVerifiedAt) throw new Error("Verify Google Drive write access before uploading images.");
        const result = await drive.files.create({
            requestBody: { name: fileName, parents: [root.id] },
            media: { mimeType: mimeType || "application/octet-stream", body: fs.createReadStream(filePath) },
            fields: "id,name,mimeType,webViewLink,webContentLink"
        });
        if (!result.data?.id) throw new Error("Google Drive did not confirm the upload.");
        return {
            id: result.data.id,
            name: result.data.name,
            folder_id: root.id,
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

    async function listAlbumFolders() {
        const { drive, saved } = await getAuthorizedDrive();
        const root = await getSelectedRoot(drive, saved);
        const folders = [];
        let pageToken;
        do {
            const response = await drive.files.list({
                q: "'" + root.id + "' in parents and mimeType = '" + FOLDER_MIME_TYPE + "' and trashed = false",
                pageSize: 1000,
                pageToken,
                orderBy: "name",
                fields: "nextPageToken,files(id,name,mimeType,createdTime,modifiedTime)"
            });
            folders.push(...(response.data?.files || []));
            pageToken = response.data?.nextPageToken;
        } while (pageToken);
        return folders;
    }

    async function listAlbumImages(folderId) {
        const { drive } = await getAuthorizedDrive();
        const images = [];
        let pageToken;
        do {
            const response = await drive.files.list({
                q: "'" + folderId + "' in parents and mimeType contains 'image/' and trashed = false",
                pageSize: 1000,
                pageToken,
                orderBy: "name",
                fields: "nextPageToken,files(id,name,mimeType,size,createdTime,modifiedTime,webViewLink)"
            });
            images.push(...(response.data?.files || []));
            pageToken = response.data?.nextPageToken;
        } while (pageToken);
        return images;
    }

    async function verifyWrite() {
        const { drive, saved } = await getAuthorizedDrive();
        const root = await getSelectedRoot(drive, saved);
        const content = `TratoCore Drive verification ${crypto.randomUUID()}`;
        let fileId;
        try {
            const created = await drive.files.create({
                requestBody: { name: `.tratocore-drive-check-${crypto.randomUUID()}.txt`, parents: [root.id] },
                media: { mimeType: "text/plain", body: Readable.from([content]) },
                fields: "id,name"
            });
            fileId = created.data?.id;
            if (!fileId) throw new Error("Google Drive não confirmou o arquivo de teste.");
            const downloaded = await drive.files.get({ fileId, alt: "media" }, { responseType: "arraybuffer" });
            let bytes;
            if (Buffer.isBuffer(downloaded.data)) bytes = downloaded.data;
            else if (downloaded.data instanceof ArrayBuffer) bytes = Buffer.from(downloaded.data);
            else if (downloaded.data?.[Symbol.asyncIterator]) {
                const chunks = [];
                for await (const chunk of downloaded.data) chunks.push(Buffer.from(chunk));
                bytes = Buffer.concat(chunks);
            } else bytes = Buffer.from(downloaded.data || "");
            if (bytes.toString("utf8") !== content) throw new Error("O arquivo de teste do Drive não corresponde ao original.");
            await drive.files.delete({ fileId });
            fileId = null;
            await store.markWriteVerified();
            return { success: true, verified: true };
        } finally {
            if (fileId) {
                try { await drive.files.delete({ fileId }); } catch (_) {}
            }
        }
    }

    async function getStatus() {
        const saved = await store.get();
        return {
            authorized: Boolean(saved?.refreshToken),
            folderSelected: Boolean(saved?.selectedFolderId),
            folderName: saved?.selectedFolderName || null,
            rootFolderName: saved?.selectedFolderName || null,
            writeVerified: Boolean(saved?.writeVerifiedAt)
        };
    }

    return {
        configured, authorizationUrl, completeAuthorization, getAuthorizedDrive,
        getPickerConfiguration, selectRootFolder, selectProductsFolder,
        uploadFile, uploadBuffer, deleteFile, getFileMetadata, getFileStream,
        listAlbumFolders, listAlbumImages, verifyWrite, getStatus, store
    };
}

module.exports = {
    createGoogleDriveOAuthService,
    DRIVE_FILE_SCOPE,
    REDIRECT_URI,
    FOTOS_FOLDER_NAME
};
