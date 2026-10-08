const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");

const CREDENTIALS_FILE =
    process.env.GOOGLE_SERVICE_ACCOUNT_FILE ||
    "/etc/secrets/google-service-account.json";

const ROOT_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID;

let driveClient = null;

function getDriveClient() {
    if (driveClient) return driveClient;

    if (!ROOT_FOLDER_ID) {
        throw new Error("GOOGLE_DRIVE_FOLDER_ID não configurado.");
    }

    if (!fs.existsSync(CREDENTIALS_FILE)) {
        throw new Error(`Arquivo da conta Google não encontrado: ${CREDENTIALS_FILE}`);
    }

    const auth = new google.auth.GoogleAuth({
        keyFile: CREDENTIALS_FILE,
        scopes: ["https://www.googleapis.com/auth/drive"]
    });

    driveClient = google.drive({ version: "v3", auth });
    return driveClient;
}

function safeDriveName(value, fallback = "Sem_Album") {
    return String(value || fallback)
        .trim()
        .replace(/[\\/:*?"<>|]/g, "_")
        .replace(/\.+$/g, "")
        .slice(0, 120) || fallback;
}

function escapeQueryValue(value) {
    return String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function findOrCreateFolder(folderName, parentId = ROOT_FOLDER_ID) {
    const drive = getDriveClient();
    const safeName = safeDriveName(folderName);
    const escapedName = escapeQueryValue(safeName);

    const response = await drive.files.list({
        q: [
            `name = '${escapedName}'`,
            "mimeType = 'application/vnd.google-apps.folder'",
            `'${parentId}' in parents`,
            "trashed = false"
        ].join(" and "),
        fields: "files(id,name)",
        spaces: "drive",
        pageSize: 100
    });

    if (response.data.files && response.data.files.length) {
        return response.data.files[0];
    }

    const created = await drive.files.create({
        requestBody: {
            name: safeName,
            mimeType: "application/vnd.google-apps.folder",
            parents: [parentId]
        },
        fields: "id,name"
    });

    return created.data;
}

async function uploadFile(filePath, fileName, mimeType, albumName) {
    const drive = getDriveClient();

    if (!fs.existsSync(filePath)) {
        throw new Error(`Arquivo não encontrado: ${filePath}`);
    }

    const folder = await findOrCreateFolder(albumName);
    const safeFileName = path.basename(String(fileName || path.basename(filePath)))
        .replace(/[\\/:*?"<>|]/g, "_")
        .slice(0, 180);

    // Idempotência: se o mesmo nome já existir no álbum, não cria uma segunda cópia.
    const escapedName = escapeQueryValue(safeFileName);
    const existing = await drive.files.list({
        q: [
            `name = '${escapedName}'`,
            `'${folder.id}' in parents`,
            "trashed = false"
        ].join(" and "),
        fields: "files(id,name,webViewLink,webContentLink)",
        spaces: "drive",
        pageSize: 100
    });

    if (existing.data.files && existing.data.files.length) {
        const file = existing.data.files[0];
        return {
            id: file.id,
            name: file.name,
            folder_id: folder.id,
            web_view_link: file.webViewLink || null,
            web_content_link: file.webContentLink || null,
            reused_existing: true
        };
    }

    const result = await drive.files.create({
        requestBody: {
            name: safeFileName,
            parents: [folder.id]
        },
        media: {
            mimeType: mimeType || "image/jpeg",
            body: fs.createReadStream(filePath)
        },
        fields: "id,name,webViewLink,webContentLink"
    });

    return {
        id: result.data.id,
        name: result.data.name,
        folder_id: folder.id,
        web_view_link: result.data.webViewLink || null,
        web_content_link: result.data.webContentLink || null,
        reused_existing: false
    };
}

async function testConnection() {
    const drive = getDriveClient();
    const result = await drive.files.get({
        fileId: ROOT_FOLDER_ID,
        fields: "id,name,mimeType"
    });
    return result.data;
}

module.exports = {
    getDriveClient,
    findOrCreateFolder,
    uploadFile,
    testConnection
};
