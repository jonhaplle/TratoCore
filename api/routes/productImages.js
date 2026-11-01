const express = require("express");

function createProductImagesRouter(options = {}) {
const ProductImageController = options.controller || require("../controllers/productImageController");
const legacyDrive = options.legacyDrive || require('../services/googleDriveService');
const googleDriveOAuthService = options.oauthService || require('../services/googleDriveOAuthService').createGoogleDriveOAuthService();
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

        let metadata;
        try {
            metadata = await googleDriveOAuthService.getFileMetadata(fileId);
        } catch (_) {
            const drive = legacyDrive.getDriveClient();
            const legacyMetadata = await drive.files.get({ fileId, fields: "mimeType" });
            metadata = legacyMetadata.data;
        }

        const mimeType = metadata.mimeType || "image/jpeg";
        if (!mimeType.startsWith("image/")) {
            return res.status(415).json({ success: false, error: "O arquivo do Drive nÃ£o Ã© uma imagem." });
        }

        res.setHeader("Content-Type", mimeType);
        res.setHeader("Cache-Control", "private, max-age=3600");
        let stream;
        try {
            stream = await googleDriveOAuthService.getFileStream(fileId);
        } catch (_) {
            stream = await legacyDrive.getFileStream(fileId);
        }
        stream.on("error", () => res.destroy());
        stream.pipe(res);
    } catch (err) {
        return res.status(502).json({ success: false, error: "Não foi possível abrir a imagem do Drive." });
    }
});

return router;
}

const router = createProductImagesRouter();
router.createProductImagesRouter = createProductImagesRouter;
module.exports = router;
