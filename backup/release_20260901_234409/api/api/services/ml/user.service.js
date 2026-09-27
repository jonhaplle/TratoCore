const axios = require("axios");
const pool = require("../../db");

exports.getMe = async () => {

    const result = await pool.query(`
        SELECT access_token
        FROM ml_tokens
        ORDER BY created_at DESC
        LIMIT 1
    `);

    if (result.rows.length === 0) {
        throw new Error("Nenhum token encontrado.");
    }

    const token = result.rows[0].access_token;

    const response = await axios.get(
        "https://api.mercadolibre.com/users/me",
        {
            headers: {
                Authorization: `Bearer ${token}`
            }
        }
    );

    return response.data;

};