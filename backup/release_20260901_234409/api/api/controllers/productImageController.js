const ProductImageService = require("../services/productImageService");

// ======================================================
// CADASTRAR IMAGEM
// ======================================================

async function create(req, res) {

    try {

        const image = await ProductImageService.create(req.body);

        return res.status(201).json({

            success: true,
            message: "Imagem cadastrada com sucesso.",
            data: image

        });

    }

    catch (err) {

        console.error(err);

        return res.status(500).json({

            success: false,
            message: err.message

        });

    }

}

// ======================================================
// LISTAR IMAGENS DO PRODUTO
// ======================================================

async function getByProductId(req, res) {

    try {

        const images = await ProductImageService.getByProductId(
            req.params.productId
        );

        return res.status(200).json(images);

    }

    catch (err) {

        console.error(err);

        return res.status(500).json({

            success: false,
            message: err.message

        });

    }

}

// ======================================================
// IMAGEM PRINCIPAL
// ======================================================

async function getMainImage(req, res) {

    try {

        const image = await ProductImageService.getMainImage(
            req.params.productId
        );

        return res.status(200).json(image);

    }

    catch (err) {

        console.error(err);

        return res.status(500).json({

            success: false,
            message: err.message

        });

    }

}

// ======================================================
// DEFINIR IMAGEM PRINCIPAL
// ======================================================

async function setMainImage(req, res) {

    try {

        await ProductImageService.setMainImage(

            req.params.productId,
            req.params.imageId

        );

        return res.status(200).json({

            success: true,
            message: "Imagem principal atualizada."

        });

    }

    catch (err) {

        console.error(err);

        return res.status(500).json({

            success: false,
            message: err.message

        });

    }

}

// ======================================================
// REMOVER
// ======================================================

async function remove(req, res) {

    try {

        await ProductImageService.remove(req.params.id);

        return res.status(200).json({

            success: true,
            message: "Imagem removida."

        });

    }

    catch (err) {

        console.error(err);

        return res.status(500).json({

            success: false,
            message: err.message

        });

    }

}

// ======================================================

module.exports = {

    create,
    getByProductId,
    getMainImage,
    setMainImage,
    remove

};