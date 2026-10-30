const TARGET_UUIDS = [
    "4799f28e-6966-46a9-af94-5f3f1d4b098b",
    "a2e3cc52-3542-41e7-9106-565182a8d855",
    "a827ac72-f8e3-4632-9831-6632549faecb"
];

const SEARCH_TERMS = ["alianca", "anel", "prata", "joia"];
const DRIVE_FOLDER_MIME = "application/vnd.google-apps.folder";

function normalize(value) {
    return String(value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();
}

function createError(code) {
    const error = new Error(code);
    error.code = code;
    return error;
}

function escapeDriveQuery(value) {
    return String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function createGoogleDriveProduct13Diagnostic({
    driveService,
    getRootFolderId = () => process.env.GOOGLE_DRIVE_FOLDER_ID,
    now = () => Date.now(),
    maxDurationMs = 12000,
    requestTimeoutMs = 4000,
    maxFolders = 250,
    maxFiles = 10000,
    pageSize = 1000,
    maxResults = 10
} = {}) {
    if (!driveService) throw new TypeError("driveService é obrigatório.");

    return async function searchProduct13Drive() {
        const startedAt = now();
        const deadline = startedAt + maxDurationMs;
        const rootId = getRootFolderId();
        if (!rootId) throw createError("DRIVE_ROOT_NOT_CONFIGURED");

        const drive = driveService.getDriveClient();
        const rootResponse = await drive.files.get(
            { fileId: rootId, fields: "id,name,mimeType" },
            { timeout: Math.min(requestTimeoutMs, maxDurationMs) }
        );
        const root = rootResponse.data || {};
        if (normalize(root.name) !== "fotos" || root.mimeType !== DRIVE_FOLDER_MIME) {
            throw createError("DRIVE_ROOT_INVALID");
        }

        const folders = [{ id: root.id, path: "FOTOS" }];
        const visited = new Set();
        const matches = [];
        let filesScanned = 0;
        let truncatedReason = null;

        while (folders.length) {
            if (now() >= deadline) {
                truncatedReason = "time_limit";
                break;
            }
            if (visited.size >= maxFolders) {
                truncatedReason = "folder_limit";
                break;
            }

            const folder = folders.shift();
            if (visited.has(folder.id)) continue;
            visited.add(folder.id);

            let pageToken;
            do {
                const remainingMs = deadline - now();
                if (remainingMs <= 0) {
                    truncatedReason = "time_limit";
                    break;
                }
                if (filesScanned >= maxFiles) {
                    truncatedReason = "file_limit";
                    break;
                }

                const currentPageSize = Math.min(pageSize, maxFiles - filesScanned);
                let response;
                try {
                    response = await drive.files.list({
                        q: `'${escapeDriveQuery(folder.id)}' in parents and trashed = false`,
                        fields: "nextPageToken,files(id,name,mimeType,modifiedTime,size,webViewLink,imageMediaMetadata(width,height))",
                        pageSize: currentPageSize,
                        pageToken,
                        spaces: "drive",
                        supportsAllDrives: true,
                        includeItemsFromAllDrives: true
                    }, {
                        timeout: Math.min(requestTimeoutMs, remainingMs)
                    });
                } catch (error) {
                    if (now() >= deadline || ["ETIMEDOUT", "ECONNABORTED"].includes(error.code)) {
                        truncatedReason = "request_timeout";
                        break;
                    }
                    throw error;
                }

                const entries = response.data?.files || [];
                for (const file of entries) {
                    if (filesScanned >= maxFiles) {
                        truncatedReason = "file_limit";
                        break;
                    }
                    filesScanned++;

                    const filePath = `${folder.path}/${file.name || ""}`;
                    if (file.mimeType === DRIVE_FOLDER_MIME) {
                        if (file.id && !visited.has(file.id)) {
                            folders.push({ id: file.id, path: filePath });
                        }
                        continue;
                    }
                    if (!String(file.mimeType || "").startsWith("image/")) continue;

                    const normalizedPath = normalize(filePath);
                    const matchedUuids = TARGET_UUIDS.filter(uuid =>
                        normalize(file.name).includes(uuid)
                    );
                    const matchedTerms = SEARCH_TERMS.filter(term => normalizedPath.includes(term));
                    if (!matchedUuids.length && !matchedTerms.length) continue;

                    matches.push({
                        matchType: matchedUuids.length ? "uuid" : "name_or_folder",
                        matchedTerms,
                        name: file.name,
                        folder: folder.path,
                        mimeType: file.mimeType,
                        modifiedTime: file.modifiedTime || null,
                        sizeBytes: file.size ? Number(file.size) : null,
                        width: file.imageMediaMetadata?.width || null,
                        height: file.imageMediaMetadata?.height || null,
                        previewUrl: file.webViewLink || (file.id
                            ? `https://drive.google.com/file/d/${encodeURIComponent(file.id)}/view`
                            : null)
                    });
                }

                if (truncatedReason) break;
                pageToken = response.data?.nextPageToken;
            } while (pageToken);

            if (truncatedReason) break;
        }

        matches.sort((a, b) => {
            if (a.matchType !== b.matchType) return a.matchType === "uuid" ? -1 : 1;
            return String(a.name).localeCompare(String(b.name));
        });

        return {
            success: true,
            rootFolder: "FOTOS",
            foldersScanned: visited.size,
            filesScanned,
            candidateCount: matches.length,
            truncated: Boolean(truncatedReason),
            truncatedReason,
            candidates: matches.slice(0, maxResults)
        };
    };
}

module.exports = { createGoogleDriveProduct13Diagnostic };
