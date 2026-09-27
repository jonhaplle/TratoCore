const pool = require("../../db");

exports.savePublication = async (productId, ml) => {

    await pool.query(`
        UPDATE products
        SET
            ml_item_id=$1,
            ml_permalink=$2,
            ml_status=$3,
            published_at=NOW(),
            last_sync_at=NOW()
        WHERE id=$4
    `,[
        ml.id,
        ml.permalink,
        ml.status,
        productId
    ]);

};

exports.updateStatus = async(productId,status)=>{

    await pool.query(`
        UPDATE products
        SET
            ml_status=$1,
            last_sync_at=NOW()
        WHERE id=$2
    `,[
        status,
        productId
    ]);

};

exports.getPublication = async(productId)=>{

    const result = await pool.query(`
        SELECT
            ml_item_id,
            ml_permalink,
            ml_status,
            published_at,
            last_sync_at
        FROM products
        WHERE id=$1
    `,[productId]);

    return result.rows[0];

};