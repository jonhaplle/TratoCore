const express = require("express");
const pkg = require("../../package.json");

const router = express.Router();

// Marcador de versão/deploy. Não expõe tokens nem variáveis sensíveis.
router.get("/", (req, res) => {
    res.set("Cache-Control", "no-store");

    res.json({
        success: true,
        name: pkg.name,
        version: pkg.version,
        stage: "etapa-1",
        commit:
            process.env.RENDER_GIT_COMMIT ||
            process.env.GIT_COMMIT ||
            null,
        environment: process.env.NODE_ENV || "development"
    });
});

module.exports = router;
