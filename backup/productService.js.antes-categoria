const Product = require("../models/productModel");

// ======================================================
// LISTAR TODOS
// ======================================================

async function getAll() {

    return await Product.getAll();

}

// ======================================================
// BUSCAR POR ID
// ======================================================

async function getById(id) {

    if (!id) {
        throw new Error("ID do produto não informado.");
    }

    const product = await Product.getById(id);

    if (!product) {
        return null;
    }

    // Valores padrão para publicação ML
    product.sale_price = Number(product.sale_price || 0);
    product.quantity = Math.max(1, Number(product.quantity || 1));

    product.condition =
        String(product.condition || "used").toLowerCase() === "new"
            ? "new"
            : "used";

    product.ml_listing_type =
        product.ml_listing_type || "gold_special";

    product.brand = product.brand || "";
    product.model = product.model || "";
    product.gtin = product.gtin || "";

    product.title = (product.title || "").trim();
    product.description = product.description || "";

    return product;

}

// ======================================================
// CADASTRAR
// ======================================================

async function create(data) {

    if (!data.title || data.title.trim() === "") {
        throw new Error("Título obrigatório.");
    }

    const product = {

        sku: data.sku || "",

        barcode: data.barcode || "",

        title: data.title.trim(),

        description: data.description || "",

        sale_price: Number(data.sale_price || 0),

        quantity: Math.max(
            1,
            Number(data.quantity || 1)
        ),

        status: data.status || "NEW"

    };

    return await Product.create(product);

}

// ======================================================
// ATUALIZAR
// ======================================================

async function update(id, data) {

    if (!id) {
        throw new Error("ID inválido.");
    }

    const atual = await Product.getById(id);

    if (!atual) {
        throw new Error("Produto não encontrado.");
    }

    const product = {

        sku: data.sku ?? atual.sku,

        barcode: data.barcode ?? atual.barcode,

        title: (data.title ?? atual.title).trim(),

        description: data.description ?? atual.description,

        sale_price: Number(
            data.sale_price ?? atual.sale_price
        ),

        quantity: Math.max(
            1,
            Number(data.quantity ?? atual.quantity)
        ),

        status: data.status ?? atual.status

    };

    return await Product.update(id, product);

}

// ======================================================
// REMOVER
// ======================================================

async function remove(id) {

    if (!id) {
        throw new Error("ID inválido.");
    }

    return await Product.remove(id);

}

module.exports = {

    getAll,
    getById,
    create,
    update,
    remove

};