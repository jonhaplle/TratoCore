const express = require("express");
const router = express.Router();

const controller = require("../controllers/mlController");
const apiService = require("../services/ml/api.service");

// ======================================================
// OAUTH
// ======================================================

router.get("/login", controller.login);
router.get("/callback", controller.callback);

// ======================================================
// CONTA AUTENTICADA
// ======================================================

router.get("/me", controller.me);

// ======================================================
// PUBLICAÇÃO
// ======================================================

router.post("/publish/:id", controller.publish);

// ======================================================
// TESTE — CATEGORY PREDICTOR
// ======================================================

router.get("/category", async (req, res) => {
    try {
        const title = req.query.title;

        if (!title || !String(title).trim()) {
            return res.status(400).json({
                success: false,
                error: "Informe o título do produto."
            });
        }

        const result = await apiService.predictCategory(title);

        return res.json({
            success: true,
            title: String(title).trim(),
            categories: result
        });
    } catch (error) {
        return res.status(error.response?.status || 500).json({
            success: false,
            http: error.response?.status,
            error: error.response?.data || error.message
        });
    }
});

// ======================================================
// DETALHES DA CATEGORIA
// ======================================================

router.get("/category/:categoryId", async (req, res) => {
    try {
        const result = await apiService.getCategory(req.params.categoryId);

        return res.json({
            success: true,
            category: result
        });
    } catch (error) {
        return res.status(error.response?.status || 500).json({
            success: false,
            http: error.response?.status,
            error: error.response?.data || error.message
        });
    }
});

// ======================================================
// ATRIBUTOS DA CATEGORIA
// ======================================================

router.get("/category/:categoryId/attributes", async (req, res) => {
    try {
        const result = await apiService.getCategoryAttributes(req.params.categoryId);

        return res.json({
            success: true,
            category_id: req.params.categoryId,
            attributes: result
        });
    } catch (error) {
        return res.status(error.response?.status || 500).json({
            success: false,
            http: error.response?.status,
            error: error.response?.data || error.message
        });
    }
});

// ======================================================
// HEALTH CHECK
// ======================================================

router.get("/health", (req, res) => {
    res.json({
        success: true,
        service: "Mercado Livre",
        status: "online",
        timestamp: new Date().toISOString()
    });
});

module.exports = router;
