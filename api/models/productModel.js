const db = require("../db");

// ======================================================
// LISTAR TODOS
// ======================================================

async function getAll() {

    const sql = `
        SELECT

            p.*,

            pi.thumb_url,
            pi.original_url

        FROM products p

        LEFT JOIN product_images pi
            ON pi.product_id = p.id
            AND pi.is_main = TRUE

        ORDER BY p.id DESC
    `;

    const result = await db.query(sql);

    return result.rows;

}

// ======================================================
// BUSCAR POR ID
// ======================================================

async function getById(id) {

    const sql = `
        SELECT

            p.*,

            pi.thumb_url,
            pi.original_url

        FROM products p

        LEFT JOIN product_images pi
            ON pi.product_id = p.id
            AND pi.is_main = TRUE

        WHERE p.id = $1

        LIMIT 1
    `;

    const result = await db.query(sql, [id]);

    return result.rows[0] || null;

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
            status
        )
        VALUES
        (
            $1,$2,$3,$4,$5,$6,$7
        )
        RETURNING *
    `;

    const values = [

        product.sku,
        product.barcode,
        product.title,
        product.description,
        product.sale_price,
        product.quantity,
        product.status || "NEW"

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
            status=$7

        WHERE id=$8

        RETURNING *
    `;

    const values = [

        product.sku,
        product.barcode,
        product.title,
        product.description,
        product.sale_price,
        product.quantity,
        product.status,
        id

    ];

    const result = await db.query(sql, values);

    return result.rows[0] || null;

}

// ======================================================
// REMOVER
// ======================================================

async function remove(id) {

    const sql = `
        DELETE
        FROM products
        WHERE id=$1
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