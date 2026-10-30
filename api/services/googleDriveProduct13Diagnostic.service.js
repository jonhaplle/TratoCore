const TARGET_UUIDS = [
    "4799f28e-6966-46a9-af94-5f3f1d4b098b",
    "a2e3cc52-3542-41e7-9106-565182a8d855",
    "a827ac72-f8e3-4632-9831-6632549faecb"
];

const SEARCH_TERMS = ["alianca", "anel", "prata", "joia"];
const DRIVE_FOLDER_MIME = "application/vnd.google-apps.folder";
const DRIVE_SHORTCUT_MIME = "application/vnd.google-apps.shortcut";

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

function getHttpStatus(error) {
    const status = error?.response?.status || Number(error?.code);
    return Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
}

function isTimeout(error) {
    return ["ETIMEDOUT", "ECONNABORTED", "AbortError"].includes(error?.code) ||
        error?.name === "AbortError";
}

function resourceKeyOptions(fileId, resourceKey, timeout) {
    const options = { timeout };
    if (fileId && resourceKey) {
        options.headers = {
            "X-Goog-Drive-Resource-Keys": `${fileId}/${resourceKey}`
        };
    }
    return options;
}

function imageMetadata(file, folderPath, { viaShortcut = false, shortcutName = null } = {}) {
    return {
        name: file.name,
        folder: folderPath,
        mimeType: file.mimeType,
        modifiedTime: file.modifiedTime || null,
        sizeBytes: file.size ? Number(file.size) : null,
        width: file.imageMediaMetadata?.width || null,
        height: file.imageMediaMetadata?.height || null,
        thumbnailUrl: file.thumbnailLink || null,
        previewUrl: file.webViewLink || (file.id
            ? `https://drive.google.com/file/d/${encodeURIComponent(file.id)}/view`
            : null),
        viaShortcut,
        shortcutName
    };
}

function classifyImage(file, folderPath) {
    const normalizedPath = normalize(`${folderPath}/${file.name || ""}`);
    const matchedUuids = TARGET_UUIDS.filter(uuid => normalize(file.name).includes(uuid));
    const matchedTerms = SEARCH_TERMS.filter(term => normalizedPath.includes(term));

    return {
        matchedUuids,
        matchedTerms,
        isCandidate: matchedUuids.length > 0 || matchedTerms.length > 0
    };
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
    maxImages = 1000,
    maxCandidates = 10
} = {}) {
    if (!driveService) throw new TypeError("driveService é obrigatório.");

    return async function searchProduct13Drive() {
        const deadline = now() + maxDurationMs;
        const rootId = getRootFolderId();
        if (!rootId) throw createError("DRIVE_ROOT_NOT_CONFIGURED");

        const drive = driveService.getDriveClient();
        const rootResponse = await drive.files.get(
            {
                fileId: rootId,
                fields: "id,name,mimeType,driveId,resourceKey,capabilities(canListChildren,canReadDrive)",
                supportsAllDrives: true
            },
            resourceKeyOptions(rootId, null, Math.min(requestTimeoutMs, maxDurationMs))
        );
        const root = rootResponse.data || {};
        if (normalize(root.name) !== "fotos" || root.mimeType !== DRIVE_FOLDER_MIME) {
            throw createError("DRIVE_ROOT_INVALID");
        }

        const queue = [{
            id: root.id,
            path: "FOTOS",
            driveId: root.driveId || null,
            resourceKey: root.resourceKey || null,
            canListChildren: root.capabilities?.canListChildren,
            viaShortcut: false
        }];
        const visited = new Set();
        const folderInventory = [];
        const permissionIssues = [];
        const shortcuts = [];
        const images = [];
        const seenImageIds = new Set();
        let itemsScanned = 0;
        let filesScanned = 0;
        let pagesScanned = 0;
        let truncatedReason = null;

        const enqueueFolder = folder => {
            if (folder?.id && !visited.has(folder.id) && !queue.some(item => item.id === folder.id)) {
                queue.push(folder);
            }
        };

        const addImage = (file, folderPath, options) => {
            if (!file?.id || seenImageIds.has(file.id) || !String(file.mimeType || "").startsWith("image/")) {
                return;
            }
            seenImageIds.add(file.id);
            const metadata = imageMetadata(file, folderPath, options);
            const classification = classifyImage(file, folderPath);
            images.push({
                ...metadata,
                matchedUuids: classification.matchedUuids,
                matchedTerms: classification.matchedTerms,
                matchType: classification.matchedUuids.length
                    ? "uuid"
                    : classification.matchedTerms.length ? "name_or_folder" : "unmatched",
                isNameCandidate: classification.isCandidate
            });
            if (images.length >= maxImages) truncatedReason = "image_limit";
        };

        const getFile = async (fileId, fields, resourceKey) => {
            const remainingMs = deadline - now();
            if (remainingMs <= 0) throw createError("DRIVE_SEARCH_TIME_LIMIT");
            const result = await drive.files.get(
                { fileId, fields, supportsAllDrives: true },
                resourceKeyOptions(fileId, resourceKey, Math.min(requestTimeoutMs, remainingMs))
            );
            return result.data || {};
        };

        while (queue.length) {
            if (truncatedReason) break;
            if (now() >= deadline) {
                truncatedReason = "time_limit";
                break;
            }
            if (visited.size >= maxFolders) {
                truncatedReason = "folder_limit";
                break;
            }

            const folder = queue.shift();
            if (visited.has(folder.id)) continue;
            visited.add(folder.id);

            const report = {
                path: folder.path,
                driveType: folder.driveId ? "shared_drive" : "my_drive",
                viaShortcut: Boolean(folder.viaShortcut),
                canListChildren: typeof folder.canListChildren === "boolean" ? folder.canListChildren : null,
                status: "scanning",
                filesCount: 0,
                imageCount: 0,
                subfolderCount: 0,
                shortcutCount: 0,
                pagesScanned: 0
            };
            folderInventory.push(report);

            if (folder.canListChildren === false) {
                report.status = "permission_denied";
                permissionIssues.push({ folder: folder.path, status: "canListChildren_false" });
                continue;
            }

            let pageToken;
            do {
                const remainingMs = deadline - now();
                if (remainingMs <= 0) {
                    truncatedReason = "time_limit";
                    report.status = "time_limit";
                    break;
                }
                if (itemsScanned >= maxFiles) {
                    truncatedReason = "file_limit";
                    report.status = "file_limit";
                    break;
                }

                const params = {
                    q: `'${escapeDriveQuery(folder.id)}' in parents and trashed = false`,
                    fields: "nextPageToken,files(id,name,mimeType,modifiedTime,size,webViewLink,thumbnailLink,driveId,resourceKey,capabilities(canListChildren,canDownload,canReadDrive),shortcutDetails(targetId,targetMimeType,targetResourceKey),imageMediaMetadata(width,height))",
                    pageSize: Math.min(pageSize, maxFiles - itemsScanned),
                    pageToken,
                    spaces: "drive",
                    corpora: folder.driveId ? "drive" : "user",
                    driveId: folder.driveId || undefined,
                    supportsAllDrives: true,
                    includeItemsFromAllDrives: true
                };

                let response;
                try {
                    response = await drive.files.list(
                        params,
                        resourceKeyOptions(folder.id, folder.resourceKey, Math.min(requestTimeoutMs, remainingMs))
                    );
                } catch (error) {
                    const status = getHttpStatus(error);
                    if (now() >= deadline || isTimeout(error)) {
                        truncatedReason = "request_timeout";
                        report.status = "request_timeout";
                        break;
                    }
                    if (status === 403 || status === 404) {
                        report.status = status === 403 ? "permission_denied" : "not_found_or_unavailable";
                        permissionIssues.push({ folder: folder.path, status });
                        break;
                    }
                    report.status = "listing_error";
                    permissionIssues.push({ folder: folder.path, status });
                    break;
                }

                pagesScanned++;
                report.pagesScanned++;
                const entries = response.data?.files || [];
                for (const file of entries) {
                    if (itemsScanned >= maxFiles) {
                        truncatedReason = "file_limit";
                        report.status = "file_limit";
                        break;
                    }
                    itemsScanned++;

                    if (file.mimeType === DRIVE_FOLDER_MIME) {
                        report.subfolderCount++;
                        enqueueFolder({
                            id: file.id,
                            path: `${folder.path}/${file.name || "(sem nome)"}`,
                            driveId: file.driveId || folder.driveId,
                            resourceKey: file.resourceKey || null,
                            canListChildren: file.capabilities?.canListChildren,
                            viaShortcut: folder.viaShortcut
                        });
                        continue;
                    }

                    report.filesCount++;
                    filesScanned++;
                    if (file.mimeType === DRIVE_SHORTCUT_MIME) {
                        report.shortcutCount++;
                        const details = file.shortcutDetails || {};
                        const shortcutPath = `${folder.path}/${file.name || "(atalho sem nome)"}`;
                        const shortcutReport = {
                            name: file.name || null,
                            folder: folder.path,
                            targetType: details.targetMimeType || null,
                            status: "target_unavailable"
                        };
                        shortcuts.push(shortcutReport);

                        if (!details.targetId) continue;
                        try {
                            const target = await getFile(
                                details.targetId,
                                "id,name,mimeType,driveId,resourceKey,webViewLink,thumbnailLink,modifiedTime,size,capabilities(canListChildren,canDownload,canReadDrive),imageMediaMetadata(width,height)",
                                details.targetResourceKey
                            );
                            if (target.mimeType === DRIVE_FOLDER_MIME) {
                                if (visited.has(target.id) || queue.some(item => item.id === target.id)) {
                                    shortcutReport.status = "already_scanned";
                                } else {
                                    enqueueFolder({
                                        id: target.id,
                                        path: shortcutPath,
                                        driveId: target.driveId || folder.driveId,
                                        resourceKey: details.targetResourceKey || target.resourceKey || null,
                                        canListChildren: target.capabilities?.canListChildren,
                                        viaShortcut: true
                                    });
                                    shortcutReport.status = "folder_queued";
                                }
                            } else if (String(target.mimeType || "").startsWith("image/")) {
                                shortcutReport.status = "image_available";
                                report.imageCount++;
                                addImage(target, shortcutPath, { viaShortcut: true, shortcutName: file.name || null });
                            } else {
                                shortcutReport.status = "target_not_image_or_folder";
                            }
                        } catch (error) {
                            const status = getHttpStatus(error);
                            if (error.code === "DRIVE_SEARCH_TIME_LIMIT" || now() >= deadline || isTimeout(error)) {
                                truncatedReason = isTimeout(error) ? "request_timeout" : "time_limit";
                            }
                            shortcutReport.status = status === 403 ? "permission_denied" : "target_unavailable";
                            permissionIssues.push({ folder: shortcutPath, status });
                        }
                        if (truncatedReason) break;
                        continue;
                    }

                    if (String(file.mimeType || "").startsWith("image/")) {
                        report.imageCount++;
                        addImage(file, folder.path);
                        if (truncatedReason) {
                            report.status = truncatedReason;
                            break;
                        }
                    }
                }

                if (truncatedReason) break;
                pageToken = response.data?.nextPageToken;
            } while (pageToken);

            if (!truncatedReason && report.status === "scanning") report.status = "complete";
        }

        const candidates = images.filter(image => image.isNameCandidate);
        return {
            success: true,
            rootFolder: "FOTOS",
            sharedDrive: Boolean(root.driveId),
            foldersScanned: visited.size,
            itemsScanned,
            filesScanned,
            pagesScanned,
            imageCount: images.length,
            imagesReturned: images.length,
            shortcutCount: shortcuts.length,
            permissionIssues,
            complete: !truncatedReason && permissionIssues.length === 0,
            truncated: Boolean(truncatedReason),
            truncatedReason,
            folderInventory,
            shortcuts,
            candidateCount: candidates.length,
            candidates: candidates.slice(0, maxCandidates),
            images
        };
    };
}

module.exports = { createGoogleDriveProduct13Diagnostic };
