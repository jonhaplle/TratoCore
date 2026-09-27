const axios = require("axios");
const crypto = require("crypto");
const querystring = require("querystring");
const pool = require("../../db");
const apiService = require("./api.service");

// ======================================================
// PKCE
// ======================================================

const pkceStore = new Map();

// ======================================================
// GERAR URL DE LOGIN
// ======================================================

exports.getLoginUrl = () => {

    const codeVerifier = crypto
        .randomBytes(32)
        .toString("base64url");

    const state = crypto
        .randomBytes(32)
        .toString("hex");

    const codeChallenge = crypto
        .createHash("sha256")
        .update(codeVerifier)
        .digest("base64url");

    pkceStore.set(state, {
        codeVerifier,
        createdAt: Date.now()
    });

    setTimeout(() => {
        pkceStore.delete(state);
    }, 10 * 60 * 1000);

    const params = querystring.stringify({
        response_type: "code",
        client_id: process.env.ML_CLIENT_ID,
        redirect_uri: process.env.ML_REDIRECT_URI,
        state,
        code_challenge: codeChallenge,
        code_challenge_method: "S256"
    });

    return (
        "https://auth.mercadolivre.com.br/authorization?" +
        params
    );
};

// ======================================================
// CALLBACK OAUTH
// ======================================================

exports.callback = async (req) => {

    const code = req.query.code;
    const state = req.query.state;

    if (!code) {
        throw new Error(
            "Código de autorização não informado."
        );
    }

    if (!state) {
        throw new Error(
            "State não informado pelo Mercado Livre."
        );
    }

    const pkceData = pkceStore.get(state);

    if (!pkceData) {
        throw new Error(
            "State inválido ou expirado. Inicie novamente a autorização."
        );
    }

    const codeVerifier = pkceData.codeVerifier;

    pkceStore.delete(state);

    // ==================================================
    // TROCAR CODE POR TOKEN
    // ==================================================

    const body = querystring.stringify({
        grant_type: "authorization_code",
        client_id: process.env.ML_CLIENT_ID,
        client_secret: process.env.ML_CLIENT_SECRET,
        code,
        redirect_uri: process.env.ML_REDIRECT_URI,
        code_verifier: codeVerifier
    });

    const response = await axios.post(
        "https://api.mercadolibre.com/oauth/token",
        body,
        {
            headers: {
                "Accept": "application/json",
                "Content-Type": "application/x-www-form-urlencoded"
            }
        }
    );

    const token = response.data;

    // ==================================================
    // VALIDAR TOKEN
    // ==================================================

    if (!token.access_token) {
        throw new Error(
            "Mercado Livre não retornou access_token."
        );
    }

    if (!token.refresh_token) {
        throw new Error(
            "Mercado Livre não retornou refresh_token."
        );
    }

    // ==================================================
    // ATUALIZAR TOKEN EM MEMÓRIA
    // ==================================================

    apiService.setAccessToken(token.access_token);

    // ==================================================
    // SALVAR TOKEN
    // ==================================================

    await pool.query(
        `
        INSERT INTO ml_tokens
        (
            user_id,
            access_token,
            refresh_token,
            token_type,
            scope,
            expires_in
        )
        VALUES ($1,$2,$3,$4,$5,$6)

        ON CONFLICT (user_id)

        DO UPDATE SET
            access_token = EXCLUDED.access_token,
            refresh_token = EXCLUDED.refresh_token,
            token_type = EXCLUDED.token_type,
            scope = EXCLUDED.scope,
            expires_in = EXCLUDED.expires_in,
            created_at = NOW()
        `,
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
        user_id: token.user_id,
        expires_in: token.expires_in,
        scope: token.scope
    };
};

// ======================================================
// USUÁRIO AUTENTICADO
// ======================================================

exports.getMe = async () => {

    const result = await pool.query(`
        SELECT access_token
        FROM ml_tokens
        ORDER BY created_at DESC
        LIMIT 1
    `);

    if (result.rows.length === 0) {
        throw new Error(
            "Token não encontrado."
        );
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