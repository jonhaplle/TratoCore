const ProductImage = require("../models/productImageModel");

// ======================================================
// SALVAR IMAGEM
// ======================================================

async function create(data) {

    if (!data.product_id) {
        throw new Error("ID do produto não informado.");
    }

    if (!data.original_url) {
        throw new Error("URL original da imagem não informada.");
    }

    const image = {

        product_id: data.product_id,

        file_name: data.file_name || "",

        original_url: data.original_url,

        thumb_url: data.thumb_url || null,

        mime_type: data.mime_type || null,

        width: data.width || null,

        height: data.height || null,

        file_size: data.file_size || null,

        is_main: data.is_main ?? true,

        sort_order: data.sort_order ?? 1

    };

    return await ProductImage.create(image);

}

// ======================================================
// LISTAR IMAGENS DO PRODUTO
// ======================================================

async function getByProductId(productId) {

    if (!productId) {
        throw new Error("ID do produto não informado.");
    }

    return await ProductImage.getByProductId(productId);

}

// ======================================================
// IMAGEM PRINCIPAL
// ======================================================

async function getMainImage(productId) {

    if (!productId) {
        throw new Error("ID do produto não informado.");
    }

    return await ProductImage.getMainImage(productId);

}

// ======================================================
// DEFINIR IMAGEM PRINCIPAL
// ======================================================

async function setMainImage(productId, imageId) {

    if (!productId) {
        throw new Error("ID do produto não informado.");
    }

    if (!imageId) {
        throw new Error("ID da imagem não informado.");
    }

    return await ProductImage.setMainImage(
        productId,
        imageId
    );

}

// ======================================================
// REMOVER
// ======================================================

async function remove(id) {

    if (!id) {
        throw new Error("ID da imagem não informado.");
    }

    return await ProductImage.remove(id);

}

// ======================================================

module.exports = {

    create,
    getByProductId,
    getMainImage,
    setMainImage,
    remove

};