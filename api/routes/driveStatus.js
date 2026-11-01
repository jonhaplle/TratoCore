const express = require("express");

function createDriveStatusRouter(googleDriveService, logger = console) {
    const router = express.Router();

    router.get("/", async (req, res) => {
        try {
            const folder = await googleDriveService.testConnection();
            const productsFolder = await googleDriveService.findExistingFolder(
                "Produtos",
                folder.id,
                folder.driveId || null
            );
            res.set("Cache-Control", "no-store");
            res.json({
                success: true,
                drive: "online",
                read: true,
                canAddChildren: folder.capabilities?.canAddChildren ?? null,
                driveId: folder.driveId || null,
                driveType: folder.driveId ? "shared_drive" : "my_drive",
                folder: {
                    id: folder.id,
                    name: folder.name,
                    mimeType: folder.mimeType
                },
                productsFolder: productsFolder ? {
                    exists: true,
                    id: productsFolder.id,
                    name: productsFolder.name,
                    mimeType: productsFolder.mimeType,
                    canAddChildren: productsFolder.capabilities?.canAddChildren ?? null
                } : { exists: false }
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
