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

    if (!code)
        throw new Error("Código de autorização não informado.");

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

    await pool.query(`
        INSERT INTO ml_tokens
        (user_id, access_token, refresh_token, token_type, scope, expires_in)
        VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (user_id)
        DO UPDATE SET
            access_token = EXCLUDED.access_token,
            refresh_token = EXCLUDED.refresh_token,
            token_type = EXCLUDED.token_type,
            scope = EXCLUDED.scope,
            expires_in = EXCLUDED.expires_in,
            created_at = NOW()
    `, [
        token.user_id,
        token.access_token,
        token.refresh_token,
        token.token_type,
        token.scope,
        token.expires_in
    ]);

    return {
        success: true,
        message: "Token salvo com sucesso.",
        user_id: token.user_id
    };

};

exports.getAccessToken = async () => {

    const result = await pool.query(`
        SELECT access_token
        FROM ml_tokens
        ORDER BY created_at DESC
        LIMIT 1
    `);

    if (!result.rows.length)
        throw new Error("Token não encontrado.");

    return result.rows[0].access_token;

};

exports.refreshAccessToken = async () => {

    const result = await pool.query(`
        SELECT *
        FROM ml_tokens
        ORDER BY created_at DESC
        LIMIT 1
    `);

    if (!result.rows.length)
        throw new Error("Token não encontrado.");

    const atual = result.rows[0];

    const response = await axios.post(
        "https://api.mercadolibre.com/oauth/token",
        {
            grant_type: "refresh_token",
            client_id: process.env.ML_CLIENT_ID,
            client_secret: process.env.ML_CLIENT_SECRET,
            refresh_token: atual.refresh_token
        },
        {
            headers: {
                "Content-Type": "application/json"
            }
        }
    );

    const novo = response.data;

    await pool.query(`
        UPDATE ml_tokens
        SET
            access_token=$1,
            refresh_token=$2,
            token_type=$3,
            scope=$4,
            expires_in=$5,
            created_at=NOW()
        WHERE user_id=$6
    `, [
        novo.access_token,
        novo.refresh_token,
        novo.token_type,
        novo.scope,
        novo.expires_in,
        atual.user_id
    ]);

    return novo.access_token;

};

exports.getMe = async () => {

    const token = await exports.getAccessToken();

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