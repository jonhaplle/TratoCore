const axios = require("axios");
const querystring = require("querystring");
const pool = require("../../db");

exports.getLoginUrl = () => {
    const params = querystring.stringify({
        response_type: "code",
        client_id: process.env.ML_CLIENT_ID,
        redirect_uri: process.env.ML_REDIRECT_URI
    });

    return "https://auth.mercadolivre.com.br/authorization?" + params;
};

exports.callback = async (req) => {
    const code = req.query.code;

    if (!code) {
        throw new Error("Código de autorização não informado.");
    }

    const response = await axios.post(
        "https://api.mercadolibre.com/oauth/token",
        {
            grant_type: "authorization_code",
            client_id: process.env.ML_CLIENT_ID,
            client_secret: process.env.ML_CLIENT_SECRET,
            code,
            redirect_uri: process.env.ML_REDIRECT_URI
        },
        {
            headers: {
                "Content-Type": "application/json"
            }
        }
    );

    const token = response.data;

    await pool.query(
        `INSERT INTO ml_tokens
        (user_id, access_token, refresh_token, token_type, scope, expires_in)
        VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (user_id)
        DO UPDATE SET
            access_token = EXCLUDED.access_token,
            refresh_token = EXCLUDED.refresh_token,
            token_type = EXCLUDED.token_type,
            scope = EXCLUDED.scope,
            expires_in = EXCLUDED.expires_in,
            created_at = NOW()`,
        [
            token.user_id,
            token.access_token,
            token.refresh_token,
            token.token_type,
            token.scope,
            token.expires_in
        ]
    );

    return {
        success: true,
        message: "Token salvo com sucesso.",
        user_id: token.user_id
    };
};exports.getMe = async () => {

    const result = await pool.query(`
        SELECT access_token
        FROM ml_tokens
        LIMIT 1
    `);

    if (result.rows.length === 0) {
        throw new Error("Token não encontrado.");
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