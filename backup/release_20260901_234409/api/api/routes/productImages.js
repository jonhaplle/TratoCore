const express = require("express");

const ProductImageController = require("../controllers/productImageController");

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

module.exports = router;