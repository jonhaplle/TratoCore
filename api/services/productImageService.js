const ProductImage = require("../models/productImageModel");

// ======================================================
// SALVAR IMAGEM
// ======================================================

async function create(data) {

    if (!data.product_id) {
        throw new Error("ID do produto não informado.");
    }

    if (!data.original_url) {
        throw new Error("URL da imagem não informada.");
    }

    return await ProductImage.create({

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

    });

}

// ======================================================

async function getByProductId(productId) {

    return await ProductImage.getByProductId(productId);

}

async function getMainImage(productId) {

    return await ProductImage.getMainImage(productId);

}

async function setMainImage(productId, imageId) {

    return await ProductImage.setMainImage(productId, imageId);

}

async function remove(id) {

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