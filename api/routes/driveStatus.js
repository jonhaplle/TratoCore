const express = require("express");

function createDriveStatusRouter(googleDriveService, logger = console) {
    const router = express.Router();

    router.get("/", async (req, res) => {
        try {
            const folder = await googleDriveService.testConnection();
            res.json({
                success: true,
                drive: "online",
                read: true,
                canAddChildren: folder.capabilities?.canAddChildren ?? null,
                folder: {
                    id: folder.id,
                    name: folder.name,
                    mimeType: folder.mimeType
                }
            });
        } catch (err) {
            logger.error("[Google Drive] Falha na consulta de status.");
            res.status(500).json({
                success: false,
                drive: "offline",
                erro: "Falha ao consultar a pasta do Google Drive."
            });
        }
    });

    return router;
}

module.exports = createDriveStatusRouter;
