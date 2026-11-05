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
            sort_order,
            selected_for_ml,
            drive_file_id,
            drive_folder_id,
            drive_web_view_link,
            client_uuid,
            sha256,
            drive_sync_status,
            drive_sync_error,
            drive_synced_at
        )
        VALUES
        (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19
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
        image.sort_order,
        image.selected_for_ml ?? true,
        image.drive_file_id || null,
        image.drive_folder_id || null,
        image.drive_web_view_link || null,
        image.client_uuid || null,
        image.sha256 || null,
        image.drive_sync_status || (image.drive_file_id ? "synced" : "pending"),
        image.drive_sync_error || null,
        image.drive_synced_at || null

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
    const result = await db.query(
        `
        UPDATE product_images
        SET
            is_main = (id = $2),
            selected_for_ml = CASE WHEN id = $2 THEN TRUE ELSE selected_for_ml END
        WHERE product_id = $1
        RETURNING id
        `,
        [productId, imageId]
    );
    if (!result.rows.some(row => Number(row.id) === Number(imageId))) {
        throw new Error("Imagem não pertence ao produto informado.");
    }
    return true;
}

async function updateSelection(productId, selectedImageIds, mainImageId) {
    const uniqueIds = [...new Set(selectedImageIds.map(Number))];
    const found = await db.query(
        `SELECT id FROM product_images WHERE product_id = $1 AND id = ANY($2::int[])`,
        [productId, uniqueIds]
    );
    if (found.rows.length !== uniqueIds.length) {
        throw new Error("Uma ou mais imagens não pertencem ao produto informado.");
    }

    const result = await db.query(
        `
        UPDATE product_images
        SET
            selected_for_ml = (id = ANY($2::int[])),
            sort_order = CASE
                WHEN id = ANY($2::int[]) THEN array_position($2::int[], id)
                ELSE sort_order
            END,
            is_main = (id = $3)
        WHERE product_id = $1
        RETURNING id, selected_for_ml, sort_order, is_main
        `,
        [productId, uniqueIds, mainImageId]
    );
    return result.rows;
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