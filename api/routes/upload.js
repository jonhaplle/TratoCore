const express = require("express");
const multer = require("multer");
const sharp = require("sharp");
const path = require("path");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");

const router = express.Router();

// ======================================================
// PASTAS
// ======================================================

const storageRoot = path.join(__dirname, "../../storage");

const originalsDir = path.join(storageRoot, "originals");
const thumbsDir = path.join(storageRoot, "thumbs");
const tempDir = path.join(storageRoot, "temp");

[storageRoot, originalsDir, thumbsDir, tempDir].forEach((dir) => {

    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

});

// ======================================================
// MULTER
// ======================================================

const storage = multer.diskStorage({

    destination(req, file, cb) {

        cb(null, tempDir);

    },

    filename(req, file, cb) {

        const ext = path.extname(file.originalname).toLowerCase();

        cb(null, uuidv4() + ext);

    }

});

const upload = multer({

    storage,

    limits: {

        fileSize: 20 * 1024 * 1024,
        files: 10

    },

    fileFilter(req, file, cb) {

        const permitidos = [

            "image/jpeg",
            "image/jpg",
            "image/png",
            "image/webp"

        ];

        if (!permitidos.includes(file.mimetype)) {

            return cb(
                new Error("Formato de imagem não permitido.")
            );

        }

        cb(null, true);

    }

});

// ======================================================
// UPLOAD MULTIFOTO
// ======================================================

router.post("/", upload.array("imagem", 10), async (req, res, next) => {

    const arquivosProcessados = [];

    try {

        if (!req.files || req.files.length === 0) {

            return res.status(400).json({

                sucesso: false,
                mensagem: "Nenhuma imagem enviada."

            });

        }

        // ==================================================
        // PROCESSAR TODAS AS IMAGENS
        // ==================================================

        for (const file of req.files) {

            const extensao = path.extname(file.filename).toLowerCase();

            const baseName = path.basename(
                file.filename,
                extensao
            );

            const originalName = baseName + extensao;

            const thumbName = baseName + ".webp";

            const tempFile = file.path;

            const originalFile = path.join(
                originalsDir,
                originalName
            );

            const thumbFile = path.join(
                thumbsDir,
                thumbName
            );

            // ==================================================
            // DIMENSÕES
            // ==================================================

            const metadata = await sharp(tempFile).metadata();

            // ==================================================
            // ORIGINAL
            // ==================================================

            fs.copyFileSync(
                tempFile,
                originalFile
            );

            // ==================================================
            // MINIATURA
            // ==================================================

            await sharp(tempFile)

                .rotate()

                .resize(250, 250, {

                    fit: "inside",
                    withoutEnlargement: true

                })

                .webp({

                    quality: 75

                })

                .toFile(thumbFile);

            // ==================================================
            // REMOVE TEMP
            // ==================================================

            if (fs.existsSync(tempFile)) {

                fs.unlinkSync(tempFile);

            }

            // ==================================================
            // RESULTADO
            // ==================================================

            arquivosProcessados.push({

                fileName: originalName,

                original: file.originalname,

                fileSize: file.size,

                mimeType: file.mimetype,

                width: metadata.width || null,

                height: metadata.height || null,

                originalUrl:
                    "/storage/originals/" + originalName,

                thumbUrl:
                    "/storage/thumbs/" + thumbName

            });

        }

        // ==================================================
        // RETORNO
        // ==================================================

        return res.json({

            sucesso: true,

            quantidade: arquivosProcessados.length,

            // Compatibilidade com o upload antigo
            arquivo: arquivosProcessados[0],

            // Novo formato multifoto
            arquivos: arquivosProcessados

        });

    }

    catch (err) {

        console.error("Erro no upload:", err);

        // ==================================================
        // LIMPEZA DOS TEMPORÁRIOS
        // ==================================================

        try {

            if (req.files) {

                for (const file of req.files) {

                    if (
                        file.path &&
                        fs.existsSync(file.path)
                    ) {

                        fs.unlinkSync(file.path);

                    }

                }

            }

            // ==================================================
            // LIMPEZA DOS ARQUIVOS PROCESSADOS
            // ==================================================

            for (const arquivo of arquivosProcessados) {

                const originalFile = path.join(
                    originalsDir,
                    arquivo.fileName
                );

                const baseName = path.basename(
                    arquivo.fileName,
                    path.extname(arquivo.fileName)
                );

                const thumbFile = path.join(
                    thumbsDir,
                    baseName + ".webp"
                );

                if (fs.existsSync(originalFile)) {

                    fs.unlinkSync(originalFile);

                }

                if (fs.existsSync(thumbFile)) {

                    fs.unlinkSync(thumbFile);

                }

            }

        }

        catch (cleanupError) {

            console.error(
                "Erro limpando arquivos:",
                cleanupError
            );

        }

        next(err);

    }

});

// ======================================================

module.exports = router;