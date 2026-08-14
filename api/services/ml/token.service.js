const axios = require("axios");
const pool = require("../../db");
const querystring = require("querystring");
const apiService = require("./api.service");

exports.getToken = async () => {

    const result = await pool.query(`
        SELECT *
        FROM ml_tokens
        ORDER BY created_at DESC
        LIMIT 1
    `);

    if (!result.rows.length) {
        throw new Error("Nenhum token encontrado.");
    }

    return result.rows[0];

};

exports.refresh = async () => {

    const token = await exports.getToken();

    const body = querystring.stringify({
        grant_type: "refresh_token",
        client_id: process.env.ML_CLIENT_ID,
        client_secret: process.env.ML_CLIENT_SECRET,
        refresh_token: token.refresh_token
    });

    const response = await axios.post(
        "https://api.mercadolibre.com/oauth/token",
        body,
        {
            headers: {
                "Accept": "application/json",
                "Content-Type": "application/x-www-form-urlencoded"
            },
            timeout: 30000
        }
    );

    const newToken = response.data;

    if (!newToken.access_token || !newToken.refresh_token) {
        throw new Error("Mercado Livre não retornou os novos tokens no refresh.");
    }

    await pool.query(
        `
        UPDATE ml_tokens
        SET
            access_token = $1,
            refresh_token = $2,
            token_type = $3,
            scope = $4,
            expires_in = $5,
            created_at = NOW()
        WHERE user_id = $6
        `,
        [
            newToken.access_token,
            newToken.refresh_token,
            newToken.token_type,
            newToken.scope,
            newToken.expires_in,
            token.user_id
        ]
    );

    apiService.setAccessToken(newToken.access_token);

    return newToken.access_token;

};
