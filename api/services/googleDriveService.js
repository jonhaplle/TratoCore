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
        throw new Error(
            `Arquivo da conta Google não encontrado: ${CREDENTIALS_FILE}`
        );
    }

    const auth = new google.auth.GoogleAuth({
        keyFile: CREDENTIALS_FILE,
        scopes: ["https://www.googleapis.com/auth/drive"]
    });

    driveClient = google.drive({
        version: "v3",
        auth
    });

    return driveClient;
}

async function findOrCreateFolder(folderName, parentId = ROOT_FOLDER_ID) {
    const drive = getDriveClient();

    const safeName = String(folderName || "Sem_Album")
        .trim()
        .replace(/[\\/:*?"<>|]/g, "_")
        .replace(/\.+$/g, "")
        .slice(0, 120) || "Sem_Album";

    const escapedName = safeName.replace(/'/g, "\\'");

    const response = await drive.files.list({
        q: [
            `name = '${escapedName}'`,
            "mimeType = 'application/vnd.google-apps.folder'",
            `'${parentId}' in parents`,
            "trashed = false"
        ].join(" and "),
        fields: "files(id,name)",
        spaces: "drive"
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

    const result = await drive.files.create({
        requestBody: {
            name: fileName,
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
        web_content_link: result.data.webContentLink || null
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
