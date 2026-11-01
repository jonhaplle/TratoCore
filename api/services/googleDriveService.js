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

async function findOrCreateFolder() { throw new Error("Service Account folder creation is disabled; use user OAuth for My Drive writes."); }

async function uploadFile() { throw new Error("Service Account uploads are disabled; use user OAuth for My Drive writes."); }
// Retorna um stream de leitura para a rota /drive/:fileId.
async function getFileStream(fileId) {
    const drive = getDriveClient();
    const response = await drive.files.get(
        {
            fileId: String(fileId),
            alt: "media"
        },
        {
            responseType: "stream"
        }
    );

    return response.data;
}

async function testConnection(drive = getDriveClient(), folderId = ROOT_FOLDER_ID) {
    const result = await drive.files.get({
        fileId: folderId,
        fields: "id,name,mimeType,driveId,capabilities(canAddChildren)",
        supportsAllDrives: true
    });
    return result.data;
}

async function findExistingFolder(folderName, parentId = ROOT_FOLDER_ID, driveId = null, drive = getDriveClient()) {
    const safeName = safeDriveName(folderName);
    const escapedName = escapeQueryValue(safeName);
    const response = await drive.files.list({
        q: [
            `name = '${escapedName}'`,
            "mimeType = 'application/vnd.google-apps.folder'",
            `'${parentId}' in parents`,
            "trashed = false"
        ].join(" and "),
        fields: "files(id,name,mimeType,driveId,capabilities(canAddChildren))",
        spaces: "drive",
        pageSize: 100,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
        corpora: driveId ? "drive" : "user",
        ...(driveId ? { driveId } : {})
    });

    return (response.data.files || []).find(folder => folder.name === safeName) || null;
}

module.exports = {
    getDriveClient,
    findOrCreateFolder,
    uploadFile,
    getFileStream,
    testConnection,
    findExistingFolder
};
