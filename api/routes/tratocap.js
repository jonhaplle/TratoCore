const express = require("express");
const multer = require("multer");
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const crypto = require("crypto");
const SyncQueue = require("../services/tratocapSyncQueue.service");
const ProductService = require("../services/productService");
const ProductImageService = require("../services/productImageService");
const googleDriveOAuthService = require("../services/googleDriveOAuthService").createGoogleDriveOAuthService();

let syncWorkerRunning = false;
async function runSyncWorker() {
    if (syncWorkerRunning) return;
    syncWorkerRunning = true;
    try {
        const result = await SyncQueue.processOne(googleDriveOAuthService);
        if (result.processed && !result.synced) {
            console.warn("[TratoCap Sync] Imagem permanece na fila:", result.error);
        }
    } catch (error) {
        console.error("[TratoCap Sync] Falha no worker:", error.message);
    } finally {
        syncWorkerRunning = false;
    }
}
const syncWorkerTimer = setInterval(runSyncWorker, 15000);
if (typeof syncWorkerTimer.unref === "function") syncWorkerTimer.unref();

const router = express.Router();

// Importação automática: aguarda o álbum ficar alguns segundos sem novas fotos.
// Assim o TratoCap pode enviar várias imagens sem criar um produto parcial.
const AUTO_IMPORT_DELAY_MS = Number(process.env.TRATOCAP_AUTO_IMPORT_DELAY_MS || 5000);
const importTimers = new Map();
const storageRoot = path.join(__dirname, "../../storage");
const albumsRoot = path.join(storageRoot, "tratocap", "albums");
const tempRoot = path.join(storageRoot, "tratocap", "temp");
const originalsRoot = path.join(storageRoot, "originals");
const thumbsRoot = path.join(storageRoot, "thumbs");
const galleryRoot = path.join(storageRoot, "gallery", "albums");

[albumsRoot, tempRoot, originalsRoot, thumbsRoot, galleryRoot].forEach(dir => fs.mkdirSync(dir, { recursive: true }));

function safeAlbumName(value) {
    const cleaned = String(value || "Sem_Album")
        .trim()
        .replace(/[\\/:*?"<>|]/g, "_")
        .replace(/\.+$/g, "")
        .slice(0, 120);
    return cleaned || "Sem_Album";
}

function imageFiles(albumDir) {
    return fs.readdirSync(albumDir)
        .filter(name => /\.(jpe?g|png|webp)$/i.test(name))
        .map(name => path.join(albumDir, name))
        .filter(file => fs.statSync(file).isFile())
        .sort((a, b) => fs.statSync(a).mtimeMs - fs.statSync(b).mtimeMs || a.localeCompare(b));
}

const disk = multer.diskStorage({
    destination: (req, file, cb) => cb(null, tempRoot),
    filename: (req, file, cb) => cb(null, uuidv4() + path.extname(file.originalname || ".jpg").toLowerCase())
});
const upload = multer({
    storage: disk,
    limits: { fileSize: 25 * 1024 * 1024, files: 1 },
    fileFilter: (req, file, cb) => /^image\/(jpeg|jpg|png|webp)$/i.test(file.mimetype || "")
        ? cb(null, true)
        : cb(new Error("Formato de imagem não permitido."))
});

router.get("/status", (req, res) => {
    res.json({
        success: true,
        sistema: "TratoCore",
        modulo: "TratoCap Sync + Album Importer",
        status: "online",
        versao: "2.2",
        auto_import: true,
        auto_import_delay_ms: AUTO_IMPORT_DELAY_MS,
        albums_path: albumsRoot,
        gallery_path: galleryRoot,
        destinations: ["product", "gallery"]
    });
});

router.post("/upload", upload.single("image"), async (req, res, next) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, erro: "Nenhuma imagem enviada no campo image." });
        const album = safeAlbumName(req.body.album);
        const destination = String(req.body.destination || "product").trim().toLowerCase() === "gallery" ? "gallery" : "product";
        const root = destination === "gallery" ? galleryRoot : albumsRoot;
        const albumDir = path.join(root, album);
        fs.mkdirSync(albumDir, { recursive: true });
        const ext = path.extname(req.file.originalname || req.file.filename).toLowerCase() || ".jpg";
        const clientUuid = String(req.body.client_uuid || uuidv4()).trim();
        const stableName = path.basename(clientUuid).replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
        const fileName = path.extname(stableName) ? stableName : `${stableName}${ext}`;
        const target = path.join(albumDir, fileName);
        const bytes = fs.readFileSync(req.file.path);
        const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");

        if (fs.existsSync(target)) {
            let previous = {};
            try { previous = JSON.parse(fs.readFileSync(target + ".json", "utf8")); } catch (_) {}
            if (previous.sha256 && previous.sha256 !== sha256) {
                fs.unlinkSync(req.file.path);
                return res.status(409).json({ success: false, code: "TRATOCAP_UUID_CONFLICT", erro: "Este client_uuid já foi utilizado para outra imagem." });
            }
            fs.unlinkSync(req.file.path);
        } else {
            fs.renameSync(req.file.path, target);
        }

        const meta = {
            album,
            destination,
            note: req.body.note || "",
            client_uuid: clientUuid,
            sha256,
            received_at: new Date().toISOString(),
            original_name: req.file.originalname || "",
            file_name: fileName,
            file_size: fs.statSync(target).size,
            drive_sync_status: "pending"
        };

        let job = null;
        if (destination === "product") {
            await SyncQueue.ensureSchema();
            job = await SyncQueue.enqueue({
                client_uuid: clientUuid,
                sha256,
                album_name: album,
                file_name: fileName,
                mime_type: req.file.mimetype || "image/jpeg",
                payload: bytes
            });
            // Tenta sincronizar imediatamente; se o Drive estiver indisponível,
            // a cópia binária permanece no PostgreSQL para novas tentativas.
            await runSyncWorker();
            job = await SyncQueue.getByClientUuid(clientUuid);
        } else {
            try {
                const driveResult = await googleDriveOAuthService.uploadBuffer(
                    bytes, fileName, req.file.mimetype || "image/jpeg", album, clientUuid
                );
                meta.drive_file_id = driveResult.id;
                meta.drive_folder_id = driveResult.folder_id;
                meta.drive_web_view_link = driveResult.web_view_link || null;
                meta.drive_synced_at = new Date().toISOString();
                meta.drive_sync_status = "synced";
            } catch (driveError) {
                meta.drive_sync_error = driveError.message;
                console.warn("[TratoCap] Galeria local salva; Drive aguardando configuração:", driveError.message);
            }
        }

        if (job?.status === "synced") {
            meta.drive_file_id = job.drive_file_id;
            meta.drive_folder_id = job.drive_folder_id;
            meta.drive_web_view_link = job.drive_web_view_link || null;
            meta.drive_synced_at = job.synced_at || new Date().toISOString();
            meta.drive_sync_status = "synced";
        } else if (job?.last_error) {
            meta.drive_sync_error = job.last_error;
        }
        fs.writeFileSync(target + ".json", JSON.stringify(meta, null, 2), "utf8");

        // A importação não depende do Google Drive.
        if (destination === "product") scheduleAutoImport(album);

        res.status(201).json({
            success: true,
            local_saved: true,
            message: "Imagem recebida e salva no TratoCore.",
            album,
            destination,
            file_name: fileName,
            drive_synced: Boolean(driveResult),
            drive: driveResult ? {
                id: driveResult.id,
                name: driveResult.name,
                folder_id: driveResult.folder_id,
                web_view_link: driveResult.web_view_link || null,
                reused_existing: Boolean(driveResult.reused_existing)
            } : null,
            auto_import: destination === "product" ? "agendado" : "desativado",
            auto_import_delay_ms: destination === "product" ? AUTO_IMPORT_DELAY_MS : null
        });
    } catch (err) { next(err); }
});


// Galeria permanente: lista somente a pasta FOTOS selecionada e seus álbuns.
router.get("/drive-gallery", async (req, res) => {
    const configuredKey = process.env.GOOGLE_OAUTH_ADMIN_KEY;
    const supplied = req.get("Authorization")?.replace(/^Bearer\\s+/i, "");
    const a = Buffer.from(String(configuredKey || ""));
    const b = Buffer.from(String(supplied || ""));
    if (!configuredKey || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        return res.status(401).json({ success: false, erro: "Informe a chave administrativa do Google Drive." });
    }
    try {
        const folders = await googleDriveOAuthService.listAlbumFolders();
        const gallery = [];
        for (const folder of folders) {
            const files = await googleDriveOAuthService.listAlbumImages(folder.id);
            gallery.push({
                album: folder.name,
                folder_id: folder.id,
                images: files.length,
                photos: files.map(file => ({
                    id: file.id,
                    name: file.name,
                    mime_type: file.mimeType,
                    size: Number(file.size || 0),
                    received_at: file.createdTime || null,
                    url: "/api/product-images/drive/" + encodeURIComponent(file.id)
                }))
            });
        }
        return res.json({ success: true, root: "FOTOS", gallery });
    } catch (error) {
        return res.status(503).json({
            success: false,
            erro: "Não foi possível consultar a galeria permanente do Google Drive.",
            detail: error.message
        });
    }
});

router.get("/gallery", (req, res, next) => {
    try {
        const albums = fs.readdirSync(galleryRoot, { withFileTypes: true })
            .filter(e => e.isDirectory())
            .map(e => {
                const dir = path.join(galleryRoot, e.name);
                const files = imageFiles(dir);
                let note = "";
                if (files.length) {
                    try { note = JSON.parse(fs.readFileSync(files[0] + ".json", "utf8")).note || ""; } catch (_) {}
                }
                return {
                    album: e.name,
                    images: files.length,
                    note,
                    destination: "gallery",
                    photos: files.map(file => {
                        let photoMeta = {};
                        try { photoMeta = JSON.parse(fs.readFileSync(file + ".json", "utf8")); } catch (_) {}
                        return {
                            name: path.basename(file),
                            note: photoMeta.note || "",
                            received_at: photoMeta.received_at || null,
                            url: "/storage/gallery/albums/" + encodeURIComponent(e.name) + "/" + encodeURIComponent(path.basename(file))
                        };
                    })
                };
            });
        res.json({ success: true, gallery: albums });
    } catch (err) { next(err); }
});

router.post("/gallery/:album/import", async (req, res, next) => {
    try {
        const album = safeAlbumName(req.params.album);
        const sourceDir = path.join(galleryRoot, album);
        if (!fs.existsSync(sourceDir)) return res.status(404).json({ success: false, erro: "Álbum não encontrado na Galeria." });
        const targetDir = path.join(albumsRoot, album);
        fs.mkdirSync(targetDir, { recursive: true });
        for (const file of fs.readdirSync(sourceDir)) {
            if (file === ".tratocore-import.json") continue;
            fs.copyFileSync(path.join(sourceDir, file), path.join(targetDir, file));
        }
        const result = await importAlbums(album);
        res.json({ ...result, source: "gallery", imported_from_gallery: album });
    } catch (err) { next(err); }
});

router.get("/albums", (req, res, next) => {
    try {
        const albums = fs.readdirSync(albumsRoot, { withFileTypes: true })
            .filter(e => e.isDirectory())
            .map(e => {
                const dir = path.join(albumsRoot, e.name);
                const marker = path.join(dir, ".tratocore-import.json");
                const files = imageFiles(dir);
                return {
                    album: e.name,
                    images: files.length,
                    imported: fs.existsSync(marker),
                    product_id: fs.existsSync(marker) ? JSON.parse(fs.readFileSync(marker, "utf8")).product_id || null : null,
                    photos: files.map(file => {
                        let photoMeta = {};
                        try { photoMeta = JSON.parse(fs.readFileSync(file + ".json", "utf8")); } catch (_) {}
                        return {
                            name: path.basename(file),
                            note: photoMeta.note || "",
                            received_at: photoMeta.received_at || null,
                            url: "/storage/tratocap/albums/" + encodeURIComponent(e.name) + "/" + encodeURIComponent(path.basename(file))
                        };
                    })
                };
            });
        res.json({ success: true, albums });
    } catch (err) { next(err); }
});

async function importAlbums(requestedAlbum = null) {
    const names = requestedAlbum
        ? [safeAlbumName(requestedAlbum)]
        : fs.readdirSync(albumsRoot, { withFileTypes: true })
            .filter(e => e.isDirectory())
            .map(e => e.name);

    const imported = [], skipped = [];

    for (const album of names) {
        const albumDir = path.join(albumsRoot, album);
        if (!fs.existsSync(albumDir) || !fs.statSync(albumDir).isDirectory()) continue;
        const markerPath = path.join(albumDir, ".tratocore-import.json");
        if (fs.existsSync(markerPath)) {
            skipped.push({ album, reason: "Já importado", data: JSON.parse(fs.readFileSync(markerPath, "utf8")) });
            continue;
        }

        const files = imageFiles(albumDir);
        if (!files.length) { skipped.push({ album, reason: "Nenhuma imagem" }); continue; }

        let note = "";
        try {
            const firstMeta = JSON.parse(fs.readFileSync(files[0] + ".json", "utf8"));
            note = firstMeta.note || "";
        } catch (_) {}

        const product = await ProductService.create({
            title: album.replace(/[_-]+/g, " ").trim() || "Produto importado do TratoCap",
            description: note,
            quantity: 1,
            condition: "used",
            status: "NEW",
            product_type: "",
            ai_confidence: 0
        });

        const savedImages = [];
        for (let i = 0; i < files.length; i++) {
            const source = files[i];
            const ext = path.extname(source).toLowerCase() || ".jpg";
            const base = `${uuidv4()}`;
            const originalName = base + ext;
            const thumbName = base + ".webp";
            const originalPath = path.join(originalsRoot, originalName);
            const thumbPath = path.join(thumbsRoot, thumbName);
            const metadata = await sharp(source).metadata();
            let imageMeta = {};
            try {
                imageMeta = JSON.parse(fs.readFileSync(source + ".json", "utf8"));
            } catch (_) {}
            fs.copyFileSync(source, originalPath);
            await sharp(source).rotate().resize(250, 250, { fit: "inside", withoutEnlargement: true }).webp({ quality: 75 }).toFile(thumbPath);
            const image = await ProductImageService.create({
                product_id: product.id,
                file_name: originalName,
                original_url: "/storage/originals/" + originalName,
                thumb_url: "/storage/thumbs/" + thumbName,
                mime_type: metadata.format ? `image/${metadata.format === "jpg" ? "jpeg" : metadata.format}` : null,
                width: metadata.width || null,
                height: metadata.height || null,
                file_size: fs.statSync(source).size,
                is_main: i === 0,
                sort_order: i + 1,
                drive_file_id: imageMeta.drive_file_id || null,
                drive_folder_id: imageMeta.drive_folder_id || null,
                drive_web_view_link: imageMeta.drive_web_view_link || null
            });
            savedImages.push(image);
        }

        const result = { album, product_id: product.id, images: savedImages.length, imported_at: new Date().toISOString() };
        fs.writeFileSync(markerPath, JSON.stringify(result, null, 2), "utf8");
        imported.push(result);
    }
    return { success: true, imported, skipped, total_imported: imported.length };
}

function scheduleAutoImport(album) {
    if (importTimers.has(album)) clearTimeout(importTimers.get(album));
    const timer = setTimeout(async () => {
        importTimers.delete(album);
        try {
            const result = await importAlbums(album);
            console.log(`[TratoCap] Auto-import concluído para "${album}":`, JSON.stringify(result.imported));
        } catch (err) {
            console.error(`[TratoCap] Erro no auto-import de "${album}":`, err);
        }
    }, AUTO_IMPORT_DELAY_MS);
    importTimers.set(album, timer);
}

router.post("/finalize", async (req, res, next) => {
    try {
        const album = safeAlbumName(req.body && req.body.album);
        if (importTimers.has(album)) {
            clearTimeout(importTimers.get(album));
            importTimers.delete(album);
        }
        const result = await importAlbums(album);
        res.json({ ...result, finalized: album });
    } catch (err) { next(err); }
});

router.post("/import", async (req, res, next) => {
    try {
        const requestedAlbum = req.body && req.body.album ? req.body.album : null;
        const result = await importAlbums(requestedAlbum);
        res.json(result);
    } catch (err) { next(err); }
});

module.exports = router;
