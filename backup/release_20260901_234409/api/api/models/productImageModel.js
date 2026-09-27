const db = require("../db");

// ======================================================
// SALVAR IMAGEM
// ======================================================

async function create(image) {

    const sql = `
        INSERT INTO product_images
        (
            product_id,
            file_name,
            original_url,
            thumb_url,
            mime_type,
            width,
            height,
            file_size,
            is_main,
            sort_order
        )
        VALUES
        (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10
        )
        RETURNING *
    `;

    const values = [

        image.product_id,
        image.file_name,
        image.original_url,
        image.thumb_url,
        image.mime_type,
        image.width,
        image.height,
        image.file_size,
        image.is_main,
        image.sort_order

    ];

    const result = await db.query(sql, values);

    return result.rows[0];

}

// ======================================================
// LISTAR IMAGENS DO PRODUTO
// ======================================================

async function getByProductId(productId) {

    const sql = `
        SELECT *
        FROM product_images
        WHERE product_id = $1
        ORDER BY sort_order ASC, id ASC
    `;

    const result = await db.query(sql, [productId]);

    return result.rows;

}

// ======================================================
// IMAGEM PRINCIPAL
// ======================================================

async function getMainImage(productId) {

    const sql = `
        SELECT *
        FROM product_images
        WHERE product_id = $1
        AND is_main = TRUE
        LIMIT 1
    `;

    const result = await db.query(sql, [productId]);

    return result.rows[0] || null;

}

// ======================================================
// DEFINIR IMAGEM PRINCIPAL
// ======================================================

async function setMainImage(productId, imageId) {

    await db.query(

        `
        UPDATE product_images
        SET is_main = FALSE
        WHERE product_id = $1
        `,
        [productId]

    );

    await db.query(

        `
        UPDATE product_images
        SET is_main = TRUE
        WHERE id = $1
        `,
        [imageId]

    );

    return true;

}

// ======================================================
// REMOVER IMAGEM
// ======================================================

async function remove(id) {

    await db.query(

        `
        DELETE
        FROM product_images
        WHERE id = $1
        `,
        [id]

    );

    return true;

}

// ======================================================

module.exports = {

    create,
    getByProductId,
    getMainImage,
    setMainImage,
    remove

};