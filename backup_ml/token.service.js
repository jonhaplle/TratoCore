const pool = require("../../db");

exports.getToken = async () => {

    const result = await pool.query(`
        SELECT *
        FROM ml_tokens
        ORDER BY created_at DESC
        LIMIT 1
    `);

    if (!result.rows.length)
        throw new Error("Nenhum token encontrado.");

    return result.rows[0];

};
