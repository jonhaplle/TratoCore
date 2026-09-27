// ======================================================
// MERCADO LIVRE
// ======================================================

const express = require("express");
const router = express.Router();

const controller = require("../controllers/mlController");
const apiService = require("../services/ml/api.service");

// OAuth
router.get("/login", controller.login);
router.get("/callback", controller.callback);

// Conta autenticada
router.get("/me", controller.me);

// Publicação
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

        console.error("ERRO CATEGORY PREDICTOR:");

        if (error.response) {

            console.error("HTTP:", error.response.status);
            console.error(error.response.data);

            return res.status(error.response.status).json({
                success: false,
                http: error.response.status,
                error: error.response.data
            });

        }

        console.error(error.message);

        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ======================================================
// DETALHES DA CATEGORIA
// ======================================================

router.get("/category/:categoryId", async (req, res) => {

    try {

        const categoryId = String(req.params.categoryId).trim();

        if (!categoryId) {

            return res.status(400).json({
                success: false,
                error: "category_id não informado."
            });

        }

        const result = await apiService.getCategory(categoryId);

        return res.json({
            success: true,
            category: result
        });

    } catch (error) {

        console.error("ERRO CATEGORY DETAIL:");

        if (error.response) {

            console.error("HTTP:", error.response.status);
            console.error(error.response.data);

            return res.status(error.response.status).json({
                success: false,
                http: error.response.status,
                error: error.response.data
            });

        }

        console.error(error.message);

        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ======================================================
// ATRIBUTOS DA CATEGORIA
// ======================================================

router.get("/category/:categoryId/attributes", async (req, res) => {

    try {

        const categoryId = String(req.params.categoryId).trim();

        if (!categoryId) {

            return res.status(400).json({
                success: false,
                error: "category_id não informado."
            });

        }

        const result = await apiService.getCategoryAttributes(categoryId);

        return res.json({
            success: true,
            category_id: categoryId,
            attributes: result
        });

    } catch (error) {

        console.error("ERRO CATEGORY ATTRIBUTES:");

        if (error.response) {

            console.error("HTTP:", error.response.status);
            console.error(error.response.data);

            return res.status(error.response.status).json({
                success: false,
                http: error.response.status,
                error: error.response.data
            });

        }

        console.error(error.message);

        return res.status(500).json({
            success: false,
            error: error.message
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