const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const router = express.Router();
const root = path.join(__dirname, "../../storage/tratocap/albums");
fs.mkdirSync(root, { recursive: true });

function safeName(value) {
    return String(value || "sem-album")
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9_-]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 80) || "sem-album";
}

const storage = multer.diskStorage({
    destination(req, file, cb) {
        const dir = path.join(root, safeName(req.body.album));
        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename(req, file, cb) {
        const ext = path.extname(file.originalname || ".jpg").toLowerCase() || ".jpg";
        cb(null, `${Date.now()}_${crypto.randomUUID()}${ext}`);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 25 * 1024 * 1024 },
    fileFilter(req, file, cb) {
        if (!/^image\/(jpeg|png|webp)$/i.test(file.mimetype)) {
            return cb(new Error("Apenas imagens JPEG, PNG ou WEBP são aceitas."));
        }
        cb(null, true);
    }
});

router.get("/status", (req, res) => {
    res.json({ success: true, service: "TratoCap Sync", storage: "/storage/tratocap/albums" });
});

router.post("/upload", upload.single("image"), (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, error: "Imagem não enviada." });
    const album = safeName(req.body.album);
    const note = req.body.note || "";
    const relativeUrl = `/storage/tratocap/albums/${encodeURIComponent(album)}/${encodeURIComponent(req.file.filename)}`;
    const metadataFile = `${req.file.path}.json`;
    fs.writeFileSync(metadataFile, JSON.stringify({
        original_name: req.file.originalname,
        note,
        uploaded_at: new Date().toISOString(),
        album
    }, null, 2));
    res.status(201).json({
        success: true,
        album,
        file_name: req.file.filename,
        url: relativeUrl,
        note
    });
});

module.exports = router;
