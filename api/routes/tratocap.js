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
const listingPreparation = require("../services/listingPreparation.service");
const googleDriveOAuthService = require("../services/googleDriveOAuthService").createGoogleDriveOAuthService();

let syncWorkerRunning = false;
async function runSyncWorker() {
    if (syncWorkerRunning) return;
    syncWorkerRunning = true;
    try {
        for (let attempt = 0; attempt < 10; attempt++) {
            const result = await SyncQueue.processOne(googleDriveOAuthService);
            if (!result.processed) break;

            if (!result.synced) {
                // UM job com problema não pode bloquear os próximos.
                // - permanente: já foi para 'failed', segue para o próximo
                // - transitório: fica em 'pending' com backoff, segue para o próximo
                console.warn("[TratoCap Sync] Job não sincronizou:", result.error);
                continue;
            }
        }

        // Fecha a lacuna: a importação pode criar a linha em product_images
        // DEPOIS de o job ser sincronizado. Aqui o vínculo com o Drive é
        // restaurado sem reenviar nada (só imagens ainda sem drive_file_id).
        try {
            const reconciliacao = await SyncQueue.reconciliarImagensSemDrive();

            if (reconciliacao.reconciliadas > 0) {
                console.log("[TratoCap Sync] Imagens vinculadas ao Drive:", reconciliacao.reconciliadas);
            }
        } catch (error) {
            console.warn("[TratoCap Sync] Reconciliação falhou:", error.message);
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

// Travas de importação em andamento, por álbum.
//
// Existem várias entradas possíveis para `importAlbums`: o auto-import
// agendado (setTimeout), o `/finalize`, a entrevista (`importAlbums` sob
// demanda) e a recuperação no boot. Sem trava, duas delas podiam executar
// `importarAlbum` do MESMO álbum ao mesmo tempo e criar dois produtos.
//
// `importsEmAndamento` guarda a Promise em execução; quem chega depois
// aguarda a mesma Promise em vez de iniciar outra.
const importsEmAndamento = new Map();

/**
 * Executa `tarefa` com exclusão mútua por álbum.
 *
 * - Se já houver uma importação do álbum em andamento, devolve a Promise
 *   dela (não inicia outra e não interrompe a atual).
 * - Falhas liberam a trava: a próxima tentativa pode executar de novo.
 */
function comTravaDeAlbum(album, tarefa) {
    const chave = safeAlbumName(album);
    const atual = importsEmAndamento.get(chave);

    if (atual) return atual;

    const execucao = (async () => {
        try {
            return await tarefa();
        } finally {
            importsEmAndamento.delete(chave);
        }
    })();

    importsEmAndamento.set(chave, execucao);

    return execucao;
}

/** True quando há importação em andamento para o álbum. */
function albumImportando(album) {
    return importsEmAndamento.has(safeAlbumName(album));
}

/**
 * Cancela o auto-import agendado para UM álbum.
 *
 * Mantém a operação estreita de propósito: não limpa `importTimers` inteiro,
 * porque o timer de outro álbum pode estar prestes a rodar e não deve ser
 * afetado. Um timer já executando não está mais em `importTimers` (o próprio
 * callback o remove na primeira linha), então não há como "cancelar" uma
 * importação em andamento por engano — quem protege esse caso é a trava.
 */
function cancelarTimerDoAlbum(album) {
    const chave = safeAlbumName(album);
    const timer = importTimers.get(chave);

    if (!timer) return false;

    clearTimeout(timer);
    importTimers.delete(chave);

    return true;
}

// Raiz do armazenamento. Padrão: <repo>/storage (usado em produção).
//
// `TRATOCAP_STORAGE_ROOT` permite isolar o diretório em testes — sem ele,
// vários arquivos de teste que chamam `recuperarAlbunsNoBoot()` (que varre o
// diretório inteiro) enxergam os fixtures uns dos outros ao rodar em paralelo.
const storageRoot = process.env.TRATOCAP_STORAGE_ROOT
    ? path.resolve(process.env.TRATOCAP_STORAGE_ROOT)
    : path.join(__dirname, "../../storage");
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

// Limpeza administrativa: remove somente tarefas ainda pendentes; preserva produtos e imagens.
router.post("/admin/clear-pending", async (req, res) => {
    const configuredKey = process.env.GOOGLE_OAUTH_ADMIN_KEY;
    const supplied = req.get("Authorization")?.replace(/^Bearer\s*/i, "").trim();
    const expected = Buffer.from(String(configuredKey || ""));
    const received = Buffer.from(String(supplied || ""));
    if (!configuredKey) {
        return res.status(503).json({ success: false, erro: "Chave administrativa não configurada no servidor." });
    }
    if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) {
        return res.status(401).json({ success: false, erro: "Não autorizado." });
    }
    try {
        const result = await SyncQueue.clearPending();
        return res.json({
            success: true,
            deleted_pending: Number(result.deleted || 0),
            remaining_pending: Number(result.remaining_pending || 0),
            preserved: ["processing", "synced", "failed", "products", "product_images", "Mercado Livre listings"]
        });
    } catch (error) {
        console.error("[TratoCap] Falha ao limpar fila pendente:", error.message);
        return res.status(500).json({ success: false, erro: "Não foi possível limpar as tarefas pendentes." });
    }
});

router.get("/status", async (req, res) => {
    let sync_queue = { pending: 0, processing: 0, synced: 0, failed: 0 };
    try { sync_queue = await SyncQueue.getStatus(); } catch (error) {
        console.warn("[TratoCap] Status da fila indisponível:", error.message);
    }
    res.json({
        success: true,
        sistema: "TratoCore",
        modulo: "TratoCap Sync + Album Importer",
        status: "online",
        versao: "2.3",
        auto_import: true,
        auto_import_delay_ms: AUTO_IMPORT_DELAY_MS,
        albums_path: albumsRoot,
        gallery_path: galleryRoot,
        destinations: ["product", "gallery"],
        sync_queue
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
        const clientUuid = String(req.body.client_uuid || "").trim() || uuidv4();
        const stableName = path.basename(clientUuid).replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
        const fileName = path.extname(stableName) ? stableName : `${stableName}${ext}`;
        const target = path.join(albumDir, fileName);
        const bytes = fs.readFileSync(req.file.path);
        const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");

        const targetExists = fs.existsSync(target);
        if (targetExists) {
            let previous = {};
            try { previous = JSON.parse(fs.readFileSync(target + ".json", "utf8")); } catch (_) {}
            const previousHash = previous.sha256 || crypto.createHash("sha256").update(fs.readFileSync(target)).digest("hex");
            if (previousHash !== sha256) {
                fs.unlinkSync(req.file.path);
                return res.status(409).json({ success: false, code: "TRATOCAP_UUID_CONFLICT", erro: "Este client_uuid já foi utilizado para outra imagem." });
            }
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
            file_size: bytes.length,
            drive_sync_status: "pending"
        };

        // Primeiro persiste os bytes no PostgreSQL. Se o Render reiniciar
        // antes da gravação local, a rotina de recuperação reconstrói o álbum.
        await SyncQueue.ensureSchema();
        await SyncQueue.enqueue({
            client_uuid: clientUuid,
            sha256,
            album_name: album,
            file_name: fileName,
            mime_type: req.file.mimetype || "image/jpeg",
            destination,
            note: meta.note,
            original_name: meta.original_name,
            received_at: meta.received_at,
            payload: bytes
        });

        if (targetExists) fs.unlinkSync(req.file.path);
        else fs.renameSync(req.file.path, target);
        fs.writeFileSync(target + ".json", JSON.stringify(meta, null, 2), "utf8");

        // A fila é durável no PostgreSQL. Uma falha de rede/Drive não perde a foto.
        await runSyncWorker();
        const job = await SyncQueue.getByClientUuid(clientUuid);

        if (job?.status === "synced") {
            meta.drive_file_id = job.drive_file_id;
            meta.drive_folder_id = job.drive_folder_id;
            meta.drive_web_view_link = job.drive_web_view_link || null;
            meta.drive_synced_at = job.synced_at || new Date().toISOString();
            meta.drive_sync_status = "synced";
        } else {
            meta.drive_sync_status = job?.status || "pending";
            meta.drive_sync_error = job?.last_error || null;
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
            client_uuid: clientUuid,
            sha256,
            drive_synced: meta.drive_sync_status === "synced",
            drive_sync_status: meta.drive_sync_status,
            drive_sync_error: meta.drive_sync_error || null,
            drive: meta.drive_file_id ? {
                id: meta.drive_file_id,
                folder_id: meta.drive_folder_id,
                web_view_link: meta.drive_web_view_link || null
            } : null,
            auto_import: destination === "product" ? "agendado" : "desativado",
            auto_import_delay_ms: destination === "product" ? AUTO_IMPORT_DELAY_MS : null
        });
    } catch (err) {
        if (req.file?.path && fs.existsSync(req.file.path)) {
            try { fs.unlinkSync(req.file.path); } catch (_) {}
        }
        next(err);
    }
});


// Galeria permanente: lista somente a pasta FOTOS selecionada e seus álbuns.
router.get("/drive-gallery", async (req, res) => {
    const configuredKey = process.env.GOOGLE_OAUTH_ADMIN_KEY;
    const supplied = req.get("Authorization")?.replace(/^Bearer/i, "").trim();
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
            erro: "Não foi possível consultar a galeria permanente do Google Drive."
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
    await SyncQueue.ensureSchema();
    const names = requestedAlbum
        ? [safeAlbumName(requestedAlbum)]
        : fs.readdirSync(albumsRoot, { withFileTypes: true })
            .filter(e => e.isDirectory())
            .map(e => e.name);

    const imported = [], skipped = [];

    for (const album of names) {
        // Um álbum com problema NÃO pode interromper os demais.
        // Os arquivos e metadados ficam intactos para a próxima tentativa.
        try {
            // Exclusão mútua por álbum: se outra entrada (auto-import,
            // entrevista, boot) já está importando este álbum, aguarda a
            // MESMA execução em vez de iniciar uma paralela — sem
            // interromper a que já está em andamento.
            await comTravaDeAlbum(album, () =>
                importarAlbum(album, imported, skipped)
            );
        } catch (error) {
            console.error(`[TratoCap] Erro ao importar o álbum "${album}":`, error.message);

            skipped.push({
                album,
                reason: "erro na importação: " + String(error.message || "").slice(0, 200),
                retry: true
            });
        }
    }

    return { success: true, imported, skipped, total_imported: imported.length };
}

/**
 * Importa UM álbum. Lança em caso de erro para o chamador registrar e seguir.
 */
async function importarAlbum(album, imported, skipped) {
        const albumDir = path.join(albumsRoot, album);
        if (!fs.existsSync(albumDir) || !fs.statSync(albumDir).isDirectory()) return;
        const markerPath = path.join(albumDir, ".tratocore-import.json");
        let marker = null;
        let product = null;
        if (fs.existsSync(markerPath)) {
            marker = JSON.parse(fs.readFileSync(markerPath, "utf8"));
            if (marker.product_id) product = await ProductService.getById(marker.product_id);
        }

        const files = imageFiles(albumDir);
        if (!files.length) {
            skipped.push({ album, reason: "Nenhuma imagem" });
            return;
        }

        // C3 — Reconciliação por client_uuid quando NÃO há marcador.
        //
        // Antes: sem `.tratocore-import.json`, `product` ficava null mesmo
        // havendo imagens deste álbum já vinculadas a um produto (caso dos
        // IDs 210/211). Sem produto, o caminho "Nenhuma foto nova" caía no
        // skip silencioso e o marcador NUNCA era gravado — o álbum ficava
        // para sempre como `imported: false`.
        if (!product) {
            for (const file of files) {
                let meta = {};
                try { meta = JSON.parse(fs.readFileSync(file + ".json", "utf8")); } catch (_) {}

                if (!meta.client_uuid) continue;

                const imagemExistente = await ProductImageService.getByClientUuid(meta.client_uuid);

                if (imagemExistente?.product_id) {
                    product = await ProductService.getById(imagemExistente.product_id);

                    // `getById` pode devolver null se o produto foi removido.
                    // Nesse caso seguimos sem produto e o fluxo normal decide.
                    if (product) break;
                }
            }
        }

        const existingImages = product
            ? await ProductImageService.getByProductId(product.id)
            : [];
        const existingUuids = new Set(existingImages.map(image => image.client_uuid).filter(Boolean));
        const existingHashes = new Set(existingImages.map(image => String(image.sha256 || "").trim()).filter(Boolean));
        const newFiles = [];

        for (const file of files) {
            let fileMeta = {};
            try { fileMeta = JSON.parse(fs.readFileSync(file + ".json", "utf8")); } catch (_) {}
            const knownUuid = fileMeta.client_uuid && existingUuids.has(fileMeta.client_uuid);
            const knownHash = !fileMeta.client_uuid && fileMeta.sha256 && existingHashes.has(String(fileMeta.sha256).trim());

            // O índice único `uq_product_images_client_uuid` é GLOBAL, mas o
            // conjunto acima só cobre ESTE produto. Um client_uuid que já foi
            // importado para outro produto (ou outro álbum) dispararia
            // violação de unicidade. Conferimos a tabela inteira.
            let knownGlobally = false;

            if (fileMeta.client_uuid && !knownUuid) {
                const jaExiste = await ProductImageService.getByClientUuid(fileMeta.client_uuid);

                if (jaExiste?.id) {
                    knownGlobally = true;
                    skipped.push({
                        album,
                        file: path.basename(file),
                        reason: "client_uuid já importado (produto " + jaExiste.product_id + ")"
                    });
                }
            }

            if (!knownUuid && !knownGlobally && !knownHash) newFiles.push({ file, fileMeta });
        }

        if (!newFiles.length) {
            // C3 — Nenhuma foto nova, mas o produto já existe.
            //
            // Antes: só a fila era marcada e o `.tratocore-import.json` NUNCA
            // era gravado. Resultado: o álbum ficava para sempre como
            // `imported: false` em /api/tratocap/albums, e a próxima
            // recuperação tentava importá-lo de novo.
            //
            // Agora gravamos o marcador para refletir o estado real. O
            // comportamento continua idempotente: nenhum produto é criado,
            // nenhuma imagem é duplicada, e um marcador válido existente
            // NÃO é sobrescrito.
            if (product) {
                await SyncQueue.markAlbumImported(album, product.id);

                // Grava/consolida o marcador quando:
                //   - ele não existe (C3, álbum sem marcador), ou
                //   - ele existe mas está PENDENTE (C1.1, importação
                //     interrompida que agora se confirma completa).
                //
                // Um marcador já CONCLUÍDO nunca é reescrito.
                const marcadorPrecisaConsolidar =
                    !fs.existsSync(markerPath) || marker?.pendente === true;

                if (marcadorPrecisaConsolidar) {
                    const marcadorConsolidado = {
                        album,
                        product_id: product.id,
                        images: existingImages.length,
                        new_images: 0,
                        imported_at: new Date().toISOString(),
                        incremental: Boolean(marker)
                    };

                    fs.writeFileSync(markerPath, JSON.stringify(marcadorConsolidado, null, 2), "utf8");
                }

                // `product` pode ter vindo do marcador ou do client_uuid.
                // O álbum está vinculado: não é um "skip" silencioso.
                skipped.push({
                    album,
                    reason: "Nenhuma foto nova",
                    product_id: product.id,
                    vinculado: true,
                    data: marker
                });

                return;
            }

            // Sem produto associado: realmente nada a fazer.
            skipped.push({ album, reason: "Nenhuma foto nova", data: marker });
            return;
        }

        let note = "";
        try { note = newFiles[0].fileMeta.note || ""; } catch (_) {}

        if (!product) {
            product = await ProductService.create({
                title: album.replace(/[_-]+/g, " ").trim() || "Produto importado do TratoCap",
                description: note,
                quantity: 1,
                condition: "used",
                status: "NEW",
                product_type: "",
                ai_confidence: 0
            });

            // Marca o produto recém-criado como pertencente a este álbum
            // ANTES de processar as imagens. Se a conversão de uma foto
            // falhar logo abaixo (sharp, disco, memória), o produto já está
            // identificado: a próxima tentativa o reencontra pelo marcador em
            // vez de criar um segundo — que era a origem dos IDs 210/211.
            try {
                if (!fs.existsSync(markerPath)) {
                    fs.writeFileSync(markerPath, JSON.stringify({
                        album,
                        product_id: product.id,
                        images: 0,
                        new_images: 0,
                        imported_at: new Date().toISOString(),
                        incremental: false,
                        pendente: true
                    }, null, 2), "utf8");
                }
            } catch (_) {
                // Sem o marcador a importação segue; a reconciliação por
                // client_uuid continua como segunda barreira.
            }
        }

        const savedImages = [];
        for (let i = 0; i < newFiles.length; i++) {
            const source = newFiles[i].file;
            const imageMeta = newFiles[i].fileMeta || {};
            const ext = path.extname(source).toLowerCase() || ".jpg";
            const base = `${uuidv4()}`;
            const originalName = base + ext;
            const thumbName = base + ".webp";
            const originalPath = path.join(originalsRoot, originalName);
            const thumbPath = path.join(thumbsRoot, thumbName);
            const metadata = await sharp(source).metadata();

            if (imageMeta.client_uuid) {
                const syncJob = await SyncQueue.getByClientUuid(imageMeta.client_uuid);
                if (syncJob?.status === "synced") {
                    imageMeta.drive_file_id = syncJob.drive_file_id;
                    imageMeta.drive_folder_id = syncJob.drive_folder_id;
                    imageMeta.drive_web_view_link = syncJob.drive_web_view_link || null;
                    imageMeta.drive_synced_at = syncJob.synced_at || null;
                    imageMeta.drive_sync_error = null;
                    imageMeta.drive_sync_status = "synced";
                } else if (syncJob) {
                    imageMeta.drive_sync_status = syncJob.status;
                    imageMeta.drive_sync_error = syncJob.last_error || null;
                }
            }

            fs.copyFileSync(source, originalPath);
            await sharp(source).rotate().resize(250, 250, { fit: "inside", withoutEnlargement: true }).webp({ quality: 75 }).toFile(thumbPath);

            let image;

            try {
                image = await ProductImageService.create({
                    product_id: product.id,
                    file_name: originalName,
                    original_url: "/storage/originals/" + originalName,
                    thumb_url: "/storage/thumbs/" + thumbName,
                    mime_type: metadata.format ? `image/${metadata.format === "jpg" ? "jpeg" : metadata.format}` : null,
                    width: metadata.width || null,
                    height: metadata.height || null,
                    file_size: fs.statSync(source).size,
                    is_main: existingImages.length === 0 && i === 0,
                    sort_order: existingImages.length + i + 1,
                    drive_file_id: imageMeta.drive_file_id || null,
                    drive_folder_id: imageMeta.drive_folder_id || null,
                    drive_web_view_link: imageMeta.drive_web_view_link || null,
                    client_uuid: imageMeta.client_uuid || null,
                    sha256: imageMeta.sha256 || null,
                    drive_sync_status: imageMeta.drive_file_id ? "synced" : (imageMeta.drive_sync_status || "pending"),
                    drive_sync_error: imageMeta.drive_sync_error || null,
                    drive_synced_at: imageMeta.drive_synced_at || null
                });
            } catch (error) {
                // Concorrência: outro import gravou o mesmo client_uuid entre a
                // checagem e o INSERT. O índice único é a barreira atômica.
                if (String(error?.code) === "23505" && imageMeta.client_uuid) {
                    skipped.push({
                        album,
                        file: path.basename(source),
                        reason: "client_uuid já registrado durante o import (concorrência)"
                    });

                    // Remove apenas as cópias que ESTE import acabou de criar.
                    try { fs.rmSync(originalPath, { force: true }); } catch (_) {}
                    try { fs.rmSync(thumbPath, { force: true }); } catch (_) {}

                    return;
                }
                throw error;
            }

            savedImages.push(image);
        }

        let preparation = null;
        try {
            preparation = await listingPreparation.prepare(product.id, note);
        } catch (error) {
            console.error("[TratoCap] Preparação automática pendente:", error.message);
            preparation = { success: false, status: "needs_review", error: error.message };
        }

        const result = {
            album,
            product_id: product.id,
            images: existingImages.length + savedImages.length,
            new_images: savedImages.length,
            imported_at: new Date().toISOString(),
            incremental: Boolean(marker),
            preparation
        };
        fs.writeFileSync(markerPath, JSON.stringify(result, null, 2), "utf8");
        await SyncQueue.markAlbumImported(album, product.id);
        imported.push(result);
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


/**
 * Reconstrói no disco os arquivos dos álbuns que a SyncQueue do PostgreSQL
 * ainda considera pendentes.
 *
 * Necessário porque o disco do Render é efêmero: após um deploy/restart o
 * diretório de álbuns pode estar vazio mesmo havendo fotos na fila.
 *
 * @param {object} [opcoes]
 * @param {boolean} [opcoes.agendar=true] quando false, NÃO cria timers de
 *        auto-import — o chamador é quem fará a importação (caso do C2, que
 *        chama `recuperarAlbunsNoBoot` em seguida).
 */
async function recoverUnimportedAlbums({ agendar = true } = {}) {
    const resumo = { albums: [], agendados: [], marcados: 0, erro: null };

    try {
        const jobs = await SyncQueue.getUnimportedProductImages();
        const albums = new Set();
        const productImagesCache = new Map();
        for (const job of jobs) {
            const album = safeAlbumName(job.album_name);
            const albumDir = path.join(albumsRoot, album);
            fs.mkdirSync(albumDir, { recursive: true });
            const target = path.join(albumDir, path.basename(job.file_name));
            if (job.payload) {
                const needsRestore = !fs.existsSync(target) ||
                    crypto.createHash("sha256").update(fs.readFileSync(target)).digest("hex") !== String(job.sha256 || "").trim();
                if (needsRestore) fs.writeFileSync(target, job.payload);
            }
            let importedProductId = Number(job.imported_product_id) || null;
            if (!importedProductId && job.client_uuid) {
                const existingImage = await ProductImageService.getByClientUuid(job.client_uuid);
                if (existingImage?.product_id) {
                    importedProductId = Number(existingImage.product_id);
                    await SyncQueue.markAlbumImported(album, importedProductId);
                }
            }

            const meta = {
                album,
                destination: "product",
                note: job.note || "",
                client_uuid: job.client_uuid,
                sha256: String(job.sha256 || "").trim(),
                received_at: job.received_at || job.created_at,
                original_name: job.original_name || job.file_name,
                file_name: job.file_name,
                file_size: job.payload ? job.payload.length : 0,
                drive_file_id: job.drive_file_id || null,
                drive_folder_id: job.drive_folder_id || null,
                drive_web_view_link: job.drive_web_view_link || null,
                drive_synced_at: job.synced_at || null,
                drive_sync_status: job.status,
                drive_sync_error: job.last_error || null
            };
            fs.writeFileSync(target + ".json", JSON.stringify(meta, null, 2), "utf8");

            // Se o produto já foi importado, reconstrói também os caminhos
            // locais usados pela ficha do produto enquanto o Drive está pendente.
            if (importedProductId && job.payload) {
                const productId = importedProductId;
                if (!productImagesCache.has(productId)) {
                    productImagesCache.set(productId, await ProductImageService.getByProductId(productId));
                }
                const productImage = productImagesCache.get(productId)
                    .find(image => image.client_uuid === job.client_uuid);
                if (productImage?.file_name) {
                    const originalPath = path.join(originalsRoot, path.basename(productImage.file_name));
                    let restoreOriginal = !fs.existsSync(originalPath);
                    if (!restoreOriginal) {
                        const localHash = crypto.createHash("sha256").update(fs.readFileSync(originalPath)).digest("hex");
                        restoreOriginal = localHash !== String(job.sha256 || "").trim();
                    }
                    if (restoreOriginal) fs.writeFileSync(originalPath, job.payload);
                    const thumbName = path.basename(String(productImage.thumb_url || ""));
                    if (thumbName) {
                        const thumbPath = path.join(thumbsRoot, thumbName);
                        if (restoreOriginal || !fs.existsSync(thumbPath)) {
                            await sharp(originalPath).rotate().resize(250, 250, { fit: "inside", withoutEnlargement: true }).webp({ quality: 75 }).toFile(thumbPath);
                        }
                    }
                }
            }
            albums.add(album);
        }

        for (const album of albums) {
            resumo.albums.push(album);

            const markerPath = path.join(albumsRoot, album, ".tratocore-import.json");

            if (fs.existsSync(markerPath)) {
                const marker = JSON.parse(fs.readFileSync(markerPath, "utf8"));

                if (marker.product_id) {
                    await SyncQueue.markAlbumImported(album, marker.product_id);
                    resumo.marcados += 1;
                }
            } else if (agendar) {
                scheduleAutoImport(album);
                resumo.agendados.push(album);
            }
        }
        if (albums.size) {
            console.log(`[TratoCap] Recuperação de álbuns pendentes: ${albums.size} álbum(ns).`);
        }
    } catch (error) {
        resumo.erro = String(error.message || "").slice(0, 200);
        console.error("[TratoCap] Falha ao recuperar álbuns persistidos:", error.message);
    }

    return resumo;
}

// ------------------------------------------------------------------
// C1 — Recuperação de álbuns NO BOOT.
//
// Por que existe:
//   `recoverUnimportedAlbums` apenas AGENDA a importação (`scheduleAutoImport`),
//   que cria outro setTimeout de 5 s. Os dois timers usam `unref()`, então no
//   Render free — onde o processo dorme — a janela de ~10 s após o boot é
//   perdida com frequência e o álbum nunca é importado.
//
// Esta função importa DE FORMA SÍNCRONA (dentro do fluxo de boot), sem timer.
//
// Reconciliação (idempotência):
//   Antes de importar, procura nas `product_images` uma imagem cujo
//   `client_uuid` pertença a este álbum. Se encontrar, o produto JÁ existe
//   (importação anterior concluiu mas o marcador se perdeu) e o vínculo é
//   restaurado sem criar nada. Só importa os álbuns realmente pendentes.
//
// Não concorre com `scheduleAutoImport`: antes de importar cada álbum, os
// timers pendentes DELE são cancelados; se já houver uma importação em
// andamento, a recuperação aguarda a conclusão em vez de disparar outra.
// ------------------------------------------------------------------

/**
 * Valida a ESTRUTURA do marcador lido do disco.
 *
 * `typeof obj === "object"` aceita `null` e ARRAYS — ambos inválidos para um
 * marcador. Um arquivo contendo `[]` ou um número não deve ser tratado como
 * marcador concluído, sob pena de o álbum ser silenciosamente ignorado.
 */
function marcadorValido(valor) {
    return Boolean(valor)
        && typeof valor === "object"
        && !Array.isArray(valor);
}

async function recuperarAlbunsNoBoot({ importar = null } = {}) {
    const executarImportacao = importar || importAlbums;

    const relatorio = {
        encontrados: [],
        importados: [],
        jaVinculados: [],
        ignorados: [],
        aguardando: [],
        retomados: [],
        erros: []
    };

    let nomes = [];

    try {
        nomes = fs.readdirSync(albumsRoot, { withFileTypes: true })
            .filter(entrada => entrada.isDirectory())
            .map(entrada => entrada.name)
            .sort();
    } catch (error) {
        relatorio.erros.push({ etapa: "listar_albuns", motivo: String(error.message || "").slice(0, 200) });
        return relatorio;
    }

    relatorio.encontrados = nomes;

    for (const album of nomes) {
        const albumDir = path.join(albumsRoot, album);

        try {
            if (!imageFiles(albumDir).length) {
                relatorio.ignorados.push({ album, motivo: "sem imagens" });
                continue;
            }
        } catch (error) {
            relatorio.ignorados.push({ album, motivo: "pasta ilegível" });
            continue;
        }

        // Já importado pelo marcador habitual?
        const markerPath = path.join(albumDir, ".tratocore-import.json");

        // C1.1 — marcador PENDENTE significa importação interrompida.
        //
        // Antes, qualquer marcador existente classificava o álbum como
        // "já vinculado" e a retomada nunca acontecia: o produto ficava sem
        // as imagens até alguém forçar uma importação manual.
        let marcadorPendente = null;

        if (fs.existsSync(markerPath)) {
            let marcadorLido = null;
            let corrompido = false;

            try {
                marcadorLido = JSON.parse(fs.readFileSync(markerPath, "utf8"));
            } catch (_) {
                corrompido = true;
            }

            // O auto-import agendado para este álbum nunca é necessário aqui.
            cancelarTimerDoAlbum(album);

            if (corrompido || !marcadorValido(marcadorLido)) {
                // Marcador corrompido: NÃO criar produto por conta própria.
                // Fica registrado para inspeção/reconciliação manual.
                relatorio.erros.push({
                    album,
                    etapa: "marcador_corrompido",
                    motivo: "arquivo .tratocore-import.json ilegível ou em formato inesperado"
                });
                continue;
            }

            if (marcadorLido.pendente === true) {
                // Importação interrompida: precisa ser retomada.
                const idDoMarcador = Number(marcadorLido.product_id);

                if (!Number.isFinite(idDoMarcador) || idDoMarcador <= 0) {
                    relatorio.erros.push({
                        album,
                        etapa: "marcador_pendente_sem_produto",
                        motivo: "pendente=true sem product_id válido"
                    });
                    continue;
                }

                marcadorPendente = { product_id: idDoMarcador };
                relatorio.retomados.push({ album, produto_id: idDoMarcador, etapa: "identificado" });
                // Segue o fluxo: cai no bloco de importação abaixo.
            } else {
                // Marcador CONCLUÍDO: comportamento anterior preservado.
                relatorio.jaVinculados.push({ album, motivo: "marcador presente" });
                continue;
            }
        }

        // Há importação em andamento para este álbum? Não dispara outra:
        // aguarda a atual terminar e reavalia o marcador.
        if (albumImportando(album)) {
            try {
                await importsEmAndamento.get(safeAlbumName(album));

                if (fs.existsSync(markerPath)) {
                    relatorio.jaVinculados.push({ album, motivo: "importação em andamento concluída" });
                } else {
                    relatorio.aguardando.push({ album, motivo: "concluiu sem vincular" });
                }
            } catch (error) {
                relatorio.erros.push({ album, etapa: "aguardar_em_andamento", motivo: String(error.message || "").slice(0, 200) });
            }
            continue;
        }

        // Reconciliação por client_uuid: o produto pode existir sem marcador.
        //
        // C1.2 — consultamos TODAS as fotos do álbum, não apenas a primeira.
        // Um álbum pode ter fotos vinculadas a produtos DIFERENTES (caso do
        // "Produto 01", com as fotos nos produtos 210 e 211). Escolher a
        // primeira que aparecer seria arbitrário e o marcador poderia apontar
        // para o produto errado.
        const produtosEncontrados = new Set();

        try {
            for (const arquivo of imageFiles(albumDir)) {
                let meta = {};
                try { meta = JSON.parse(fs.readFileSync(arquivo + ".json", "utf8")); } catch (_) {}

                if (!meta.client_uuid) continue;

                const imagem = await ProductImageService.getByClientUuid(meta.client_uuid);

                if (imagem?.product_id) {
                    produtosEncontrados.add(Number(imagem.product_id));
                }
            }
        } catch (error) {
            relatorio.erros.push({ album, etapa: "reconciliar", motivo: String(error.message || "").slice(0, 200) });
        }

        const produtoExistente = produtosEncontrados.size === 1
            ? [...produtosEncontrados][0]
            : null;

        // C1.1 — a retomada reutiliza o produto do marcador pendente.
        // Antes da importação, confirmamos que o produto ainda existe:
        // sem isso, a importação criaria outro produto silenciosamente.
        if (marcadorPendente) {
            let produtoDoMarcador = null;

            try {
                produtoDoMarcador = await ProductService.getById(marcadorPendente.product_id);
            } catch (error) {
                relatorio.erros.push({
                    album,
                    etapa: "validar_produto_pendente",
                    motivo: String(error.message || "").slice(0, 200)
                });
                continue;
            }

            if (!produtoDoMarcador) {
                // Sem estratégia segura de reconciliação: não criamos outro.
                relatorio.erros.push({
                    album,
                    etapa: "produto_inexistente",
                    motivo: "marcador pendente aponta para produto inexistente (" +
                        marcadorPendente.product_id + ")"
                });
                continue;
            }

            if (produtoExistente && produtoExistente !== marcadorPendente.product_id) {
                // Divergência entre o marcador e o client_uuid das imagens.
                // Não escolher sozinho: registrar e seguir para inspeção.
                relatorio.erros.push({
                    album,
                    etapa: "divergencia_produto",
                    motivo: "marcador aponta para " + marcadorPendente.product_id +
                        " mas as imagens apontam para " + produtoExistente
                });
                continue;
            }
        }

        // C1.2 — mais de um produto para o mesmo álbum: NÃO escolher sozinho.
        // O marcador apontaria para um cadastro possivelmente incorreto e a
        // entrevista gravaria respostas no produto errado.
        if (produtosEncontrados.size > 1 && !marcadorPendente) {
            relatorio.erros.push({
                album,
                etapa: "produtos_duplicados",
                motivo: "as fotos do álbum estão em " + produtosEncontrados.size +
                    " produtos (" + [...produtosEncontrados].sort((a, b) => a - b).join(", ") +
                    ") — reconciliação manual necessária"
            });
            continue;
        }

        if (produtoExistente && !marcadorPendente) {
            try {
                await SyncQueue.markAlbumImported(album, produtoExistente);

                // C1.2 — grava o marcador que faltava.
                //
                // Antes, a reconciliação marcava a SyncQueue e saía sem gravar
                // `.tratocore-import.json`. Consequência: /api/tratocap/albums
                // mostrava `imported: false` e a entrevista não encontrava o
                // produto, mesmo com todas as imagens já vinculadas.
                const jaTemMarcador = fs.existsSync(markerPath);

                if (!jaTemMarcador) {
                    let totalImagens = 0;
                    try { totalImagens = imageFiles(albumDir).length; } catch (_) {}

                    const marcadorReconciliado = {
                        album,
                        product_id: produtoExistente,
                        images: totalImagens,
                        new_images: 0,
                        imported_at: new Date().toISOString(),
                        incremental: false,
                        reconciliado: true
                    };

                    fs.writeFileSync(markerPath, JSON.stringify(marcadorReconciliado, null, 2), "utf8");
                }

                relatorio.jaVinculados.push({
                    album,
                    produto_id: produtoExistente,
                    motivo: jaTemMarcador ? "reconciliado por client_uuid" : "reconciliado e marcador gravado"
                });
            } catch (error) {
                relatorio.erros.push({ album, etapa: "marcar_reconciliado", motivo: String(error.message || "").slice(0, 200) });
            }
            continue;
        }

        // Álbum realmente pendente: importa agora, sem timer.
        // Cancela o auto-import agendado DESTE álbum para não executar duas
        // vezes. Timers de OUTROS álbuns são preservados.
        cancelarTimerDoAlbum(album);

        try {
            // C1.1 — retomada.
            //
            // NÃO envolvemos `executarImportacao` em `comTravaDeAlbum` aqui:
            // o padrão é `importAlbums` (ou o stub de teste), e o próprio
            // `importAlbums` JÁ aplica a trava em L447. Envolver de novo
            // pegaria a mesma trava, ainda em andamento, e a segunda
            // chamada esperaria a primeira — deadlock.
            //
            // A garantia de uma execução por álbum vem de:
            //   - `albumImportando()` acima (pula se já houver importação);
            //   - `comTravaDeAlbum` dentro de `importAlbums`.
            const resultado = await executarImportacao(album);

            const ids = (resultado?.imported || [])
                .map(item => item?.product_id || item?.id)
                .filter(Boolean);

            if (ids.length) {
                if (marcadorPendente) {
                    if (ids[0] === marcadorPendente.product_id) {
                        relatorio.retomados[relatorio.retomados.length - 1].etapa = "retomado";
                        relatorio.importados.push({ album, produto_id: ids[0], retomado: true });
                    } else {
                        // Importou, mas um produto diferente do marcador.
                        relatorio.erros.push({
                            album,
                            etapa: "retomada_produto_divergente",
                            motivo: "esperado " + marcadorPendente.product_id + ", obtido " + ids[0]
                        });
                    }
                } else {
                    relatorio.importados.push({ album, produto_id: ids[0] });
                }
            } else {
                const motivo = (resultado?.skipped || [])
                    .map(item => item.reason)
                    .filter(Boolean)
                    .join("; ");

                // Marcador pendente é PRESERVADO: a próxima tentativa retoma.
                relatorio.ignorados.push({ album, motivo: motivo || "nada importado" });
            }
        } catch (error) {
            // Falha preserva o marcador pendente para nova tentativa.
            relatorio.erros.push({ album, etapa: "importar", motivo: String(error.message || "").slice(0, 200) });
        }
    }

    // Logs objetivos, sem dados sensíveis.
    console.log("[TratoCap][C1] Álbuns encontrados:", relatorio.encontrados.length, JSON.stringify(relatorio.encontrados));

    if (relatorio.importados.length) {
        console.log("[TratoCap][C1] Importados:", JSON.stringify(relatorio.importados));
    }

    if (relatorio.jaVinculados.length) {
        console.log("[TratoCap][C1] Já vinculados:", JSON.stringify(relatorio.jaVinculados));
    }

    if (relatorio.ignorados.length) {
        console.log("[TratoCap][C1] Ignorados:", JSON.stringify(relatorio.ignorados));
    }

    if (relatorio.retomados.length) {
        console.log("[TratoCap][C1] Retomados:", JSON.stringify(relatorio.retomados));
    }

    if (relatorio.erros.length) {
        console.error("[TratoCap][C1] Erros:", JSON.stringify(relatorio.erros));
    }

    return relatorio;
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

const recoveryTimer = setTimeout(recoverUnimportedAlbums, 5000);
if (typeof recoveryTimer.unref === "function") recoveryTimer.unref();

// Expõe o importador para fluxos internos do backend (ex.: entrevista).
// O endpoint público continua usando suas próprias regras de autenticação.
router.importAlbums = importAlbums;
router.safeAlbumName = safeAlbumName;

// C1 — recuperação determinística no boot (sem timer).
// `recuperarAlbunsNoBoot` recebe `importar` opcional para permitir teste.
router.recuperarAlbunsNoBoot = recuperarAlbunsNoBoot;

// C2 — recuperação a partir da SyncQueue, usada ANTES do C1 no boot.
// `agendar: false` evita timers concorrentes.
router.recoverUnimportedAlbums = recoverUnimportedAlbums;

// Controle de concorrência por álbum (usado pela recuperação e testável).
router.comTravaDeAlbum = comTravaDeAlbum;
router.albumImportando = albumImportando;
router.cancelarTimerDoAlbum = cancelarTimerDoAlbum;
router.importsEmAndamento = importsEmAndamento;
router.importTimers = importTimers;

module.exports = router;
