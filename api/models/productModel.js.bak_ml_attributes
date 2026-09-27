const db = require("../db");

function normalizeImageUrl(value) {
    if (!value) return null;
    const v = String(value).trim();
    if (!v) return null;
    if (/^https?:\/\//i.test(v)) return v;
    return v.startsWith("/") ? v : "/" + v;
}

function fallbackThumb(fileName) {
    if (!fileName) return null;
    const name = String(fileName).trim();
    if (!name) return null;
    return "/storage/thumbs/" + name.replace(/\.[^.]+$/, ".webp");
}

function fallbackOriginal(fileName) {
    if (!fileName) return null;
    const name = String(fileName).trim();
    if (!name) return null;
    return "/storage/originals/" + name;
}

function normalizeImageFields(product) {
    if (!product) return product;
    product.thumb_url = normalizeImageUrl(product.thumb_url) || fallbackThumb(product.file_name);
    product.original_url = normalizeImageUrl(product.original_url) || fallbackOriginal(product.file_name);
    if (Array.isArray(product.images)) {
        product.images = product.images.map(img => ({
            ...img,
            thumb_url: normalizeImageUrl(img.thumb_url) || fallbackThumb(img.file_name),
            original_url: normalizeImageUrl(img.original_url) || fallbackOriginal(img.file_name)
        }));
    }
    return product;
}

// ======================================================
// LISTAR TODOS
// ======================================================

async function getAll() {

    const sql = `
        SELECT

            p.*,

            pi.thumb_url,
            pi.original_url,
            pi.file_name,

            COALESCE((
                SELECT json_agg(
                    json_build_object(
                        'id', img.id,
                        'file_name', img.file_name,
                        'original_url', img.original_url,
                        'thumb_url', img.thumb_url,
                        'is_main', img.is_main,
                        'sort_order', img.sort_order
                    )
                    ORDER BY img.is_main DESC, img.sort_order ASC, img.id ASC
                )
                FROM product_images img
                WHERE img.product_id = p.id
            ), '[]'::json) AS images

        FROM products p

        LEFT JOIN LATERAL (
            SELECT
                pi.thumb_url,
                pi.original_url,
                pi.file_name
            FROM product_images pi
            WHERE pi.product_id = p.id
            ORDER BY pi.is_main DESC, pi.sort_order ASC, pi.id ASC
            LIMIT 1
        ) pi ON TRUE

        ORDER BY p.id DESC
    `;

    const result = await db.query(sql);

    return result.rows.map(normalizeImageFields);

}

// ======================================================
// BUSCAR POR ID
// ======================================================

async function getById(id) {

    const sql = `
        SELECT

            p.*,

            pi.thumb_url,
            pi.original_url,
            pi.file_name,

            COALESCE((
                SELECT json_agg(
                    json_build_object(
                        'id', img.id,
                        'file_name', img.file_name,
                        'original_url', img.original_url,
                        'thumb_url', img.thumb_url,
                        'is_main', img.is_main,
                        'sort_order', img.sort_order
                    )
                    ORDER BY img.is_main DESC, img.sort_order ASC, img.id ASC
                )
                FROM product_images img
                WHERE img.product_id = p.id
            ), '[]'::json) AS images

        FROM products p

        LEFT JOIN LATERAL (
            SELECT
                pi.thumb_url,
                pi.original_url,
                pi.file_name
            FROM product_images pi
            WHERE pi.product_id = p.id
            ORDER BY pi.is_main DESC, pi.sort_order ASC, pi.id ASC
            LIMIT 1
        ) pi ON TRUE

        WHERE p.id = $1

        LIMIT 1
    `;

    const result = await db.query(sql, [id]);

    if (!result.rows.length) {
        return null;
    }

    const product = normalizeImageFields(result.rows[0]);

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

async function create(product) {

    const sql = `
        INSERT INTO products
        (
            sku,
            barcode,
            title,
            description,
            sale_price,
            quantity,
            status,
            product_type,
            brand,
            line,
            model,
            generation,
            version,
            color,
            condition,
            ai_confidence
        )
        VALUES
        (
            $1,$2,$3,$4,$5,$6,$7,$8,
            $9,$10,$11,$12,$13,$14,$15,$16
        )
        RETURNING *
    `;

    const values = [
        product.sku || "",
        product.barcode || "",
        product.title || "",
        product.description || "",
        Number(product.sale_price || 0),
        Math.max(1, Number(product.quantity || 1)),
        product.status || "NEW",
        product.product_type || "",
        product.brand || "",
        product.line || "",
        product.model || "",
        product.generation || "",
        product.version || "",
        product.color || "",
        product.condition || "used",
        Number(product.ai_confidence || 0)
    ];

    const result = await db.query(sql, values);

    return result.rows[0];
}

// ======================================================
// ATUALIZAR
// ======================================================

async function update(id, product) {

    const sql = `
        UPDATE products
        SET
            sku=$1,
            barcode=$2,
            title=$3,
            description=$4,
            sale_price=$5,
            quantity=$6,
            status=$7,
            product_type=$8,
            brand=$9,
            line=$10,
            model=$11,
            generation=$12,
            version=$13,
            color=$14,
            condition=$15,
            ai_confidence=$16
        WHERE id=$17
        RETURNING *
    `;

    const values = [
        product.sku || "",
        product.barcode || "",
        product.title || "",
        product.description || "",
        Number(product.sale_price || 0),
        Math.max(1, Number(product.quantity || 1)),
        product.status || "NEW",
        product.product_type || "",
        product.brand || "",
        product.line || "",
        product.model || "",
        product.generation || "",
        product.version || "",
        product.color || "",
        product.condition || "used",
        Number(product.ai_confidence || 0),
        id
    ];

    const result = await db.query(sql, values);

    return result.rows[0] || null;
}

// ======================================================

// ======================================================
// REMOVER
// ======================================================

async function remove(id) {

    const sql = `
        DELETE
        FROM products
        WHERE id = $1
    `;

    await db.query(sql, [id]);

    return true;

}

module.exports = {

    getAll,
    getById,
    create,
    update,
    remove

};