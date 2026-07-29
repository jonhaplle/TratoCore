const express = require("express");
const multer = require("multer");
const sharp = require("sharp");
const path = require("path");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");const ProductImageService = require("../services/productImageService");

const router = express.Router();

// ======================================================
// PASTAS
// ======================================================

const storageRoot = path.join(__dirname, "../../storage");

const originalsDir = path.join(storageRoot, "originals");
const thumbsDir = path.join(storageRoot, "thumbs");
const tempDir = path.join(storageRoot, "temp");

[storageRoot, originalsDir, thumbsDir, tempDir].forEach(dir => {

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

        fileSize: 20 * 1024 * 1024

    },

    fileFilter(req, file, cb) {

        const permitidos = [

            "image/jpeg",
            "image/jpg",
            "image/png",
            "image/webp"

        ];

        if (!permitidos.includes(file.mimetype)) {

            return cb(new Error("Formato de imagem nÃ£o permitido."));

        }

        cb(null, true);

    }

});

// ======================================================
// UPLOAD
// ======================================================

router.post("/", upload.single("imagem"), async (req, res, next) => {

    try {

        if (!req.file) {

            return res.status(400).json({

                sucesso: false,
                mensagem: "Nenhuma imagem enviada."

            });

        }

        const extensao = path.extname(req.file.filename).toLowerCase();

        const baseName = path.basename(req.file.filename, extensao);

        const originalName = baseName + extensao;

        const thumbName = baseName + ".webp";

        const tempFile = req.file.path;

        const originalFile = path.join(originalsDir, originalName);

        const thumbFile = path.join(thumbsDir, thumbName);

        // ==================================================
        // ORIGINAL
        // ==================================================

        fs.copyFileSync(tempFile, originalFile);

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

        fs.unlinkSync(tempFile);
                // ==================================================
        // RETORNO
        // ==================================================

        return res.json({

            sucesso: true,

            arquivo: {

                nome: originalName,

                original: req.file.originalname,

                tamanho: req.file.size,

                tipo: req.file.mimetype,

                originalUrl: "/storage/originals/" + originalName,

                thumbUrl: "/storage/thumbs/" + thumbName

            }

        });

    }

    catch (err) {

        // Remove arquivos caso exista erro

        try {

            if (req.file?.path && fs.existsSync(req.file.path)) {
                fs.unlinkSync(req.file.path);
            }

            const extensao = req.file
                ? path.extname(req.file.filename).toLowerCase()
                : "";

            const baseName = req.file
                ? path.basename(req.file.filename, extensao)
                : "";

            const originalFile = path.join(
                originalsDir,
                baseName + extensao
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

        catch (e) {

            console.error("Erro limpando arquivos:", e);

        }

        next(err);

    }

});

// ======================================================

module.exports = router;
