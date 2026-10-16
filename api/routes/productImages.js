const express = require("express");

const ProductImageController = require("../controllers/productImageController");
const { getFileStream, getDriveClient } = require('../services/googleDriveService');

const router = express.Router();

// ======================================================
// IMAGENS
// ======================================================

// Cadastrar imagem
router.post("/", ProductImageController.create);

// Listar imagens de um produto
router.get(
    "/product/:productId",
    ProductImageController.getByProductId
);

// Buscar imagem principal
router.get(
    "/product/:productId/main",
    ProductImageController.getMainImage
);

// Definir imagem principal
router.put(
    "/product/:productId/main/:imageId",
    ProductImageController.setMainImage
);

// Remover imagem
router.delete(
    "/:id",
    ProductImageController.remove
);

// ======================================================


// Transmitir uma imagem privada do Google Drive pelo servidor.
router.get("/drive/:fileId", async (req, res, next) => {
    try {
        const fileId = String(req.params.fileId || "").trim();
        if (!/^[a-zA-Z0-9_-]+$/.test(fileId)) {
            return res.status(400).json({ success: false, error: "ID de imagem invÃ¡lido." });
        }

        const drive = getDriveClient();
        const metadata = await drive.files.get({
            fileId,
            fields: "mimeType"
        });

        const mimeType = metadata.data.mimeType || "image/jpeg";
        if (!mimeType.startsWith("image/")) {
            return res.status(415).json({ success: false, error: "O arquivo do Drive nÃ£o Ã© uma imagem." });
        }

        res.setHeader("Content-Type", mimeType);
        res.setHeader("Cache-Control", "private, max-age=3600");
        const stream = await getFileStream(fileId);
        stream.on("error", next);
        stream.pipe(res);
    } catch (err) {
        next(err);
    }
});

module.exports = router;