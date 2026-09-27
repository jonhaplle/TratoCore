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
        throw new Error("ID do produto nÃ£o informado.");
    }

    const product = await Product.getById(id);

    if (!product) {
        return null;
    }

    // Valores padrÃ£o para publicaÃ§Ã£o ML
    product.sale_price = Number(product.sale_price || 0);
    product.quantity = Math.max(1, Number(product.quantity || 1));

    product.condition =
        String(product.condition || "used").toLowerCase() === "new"
            ? "new"
            : "used";

    product.ml_listing_type =
        product.ml_listing_type || "gold_pro";

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
        throw new Error("TÃ­tulo obrigatÃ³rio.");
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

        status: data.status || "NEW",

        product_type: data.product_type || "",
        brand: data.brand || "",
        line: data.line || "",
        model: data.model || "",
        generation: data.generation || "",
        version: data.version || "",
        color: data.color || "",
        condition: String(data.condition || "used").toLowerCase() === "new" ? "new" : "used",
        ai_confidence: Number(data.ai_confidence || 0)

    };

    return await Product.create(product);

}

// ======================================================
// ATUALIZAR
// ======================================================

async function update(id, data) {

    if (!id) {
        throw new Error("ID invÃ¡lido.");
    }

    const atual = await Product.getById(id);

    if (!atual) {
        throw new Error("Produto nÃ£o encontrado.");
    }

    const product = {

        sku: data.sku ?? atual.sku,

        barcode: data.barcode ?? atual.barcode,

        title: (data.title ?? atual.title).trim(),

        description: data.description ?? atual.description,

        sale_price: Number(
            data.sale_price ?? atual.sale_price
        ),
        ml_attributes: data.ml_attributes ?? atual.ml_attributes ?? null,

        quantity: Math.max(
            1,
            Number(data.quantity ?? atual.quantity)
        ),

        status: data.status ?? atual.status,

        product_type: data.product_type ?? atual.product_type ?? "",
        brand: data.brand ?? atual.brand ?? "",
        line: data.line ?? atual.line ?? "",
        model: data.model ?? atual.model ?? "",
        generation: data.generation ?? atual.generation ?? "",
        version: data.version ?? atual.version ?? "",
        color: data.color ?? atual.color ?? "",
        condition: data.condition ?? atual.condition ?? "used",
        ai_confidence: Number(
            data.ai_confidence ?? atual.ai_confidence ?? 0
        )

    };

    return await Product.update(id, product);

}

// ======================================================
// REMOVER
// ======================================================

async function remove(id) {

    if (!id) {
        throw new Error("ID invÃ¡lido.");
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
