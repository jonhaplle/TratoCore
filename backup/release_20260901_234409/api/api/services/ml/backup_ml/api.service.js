const axios = require("axios");
const pool = require("../../db");
const tokenService = require("./token.service");

const API = "https://api.mercadolibre.com";

let accessToken = null;

exports.setAccessToken = (token) => {
    accessToken = token;
};

exports.getAccessToken = async () => {
    if (accessToken) {
        return accessToken;
    }

    const result = await pool.query(`
        SELECT access_token
        FROM ml_tokens
        ORDER BY created_at DESC
        LIMIT 1
    `);

    if (result.rows.length === 0) {
        throw new Error("Access Token nao configurado.");
    }

    accessToken = result.rows[0].access_token;

    return accessToken;
};

async function request(config, retry = true) {
    try {
        const token = await exports.getAccessToken();

        config.headers = {
            ...(config.headers || {}),
            Authorization: `Bearer ${token}`,
            "User-Agent": "TratoCore/1.0"
        };

        return await axios(config);

    } catch (err) {

        if (
            retry &&
            err.response &&
            err.response.status === 401
        ) {
            console.log("====================================");
            console.log("ACCESS TOKEN EXPIRADO");
            console.log("RENOVANDO TOKEN...");
            console.log("====================================");

            accessToken = await tokenService.refresh();

            return request(config, false);
        }

        throw err;
    }
}

exports.publishItem = async (item) => {

    const response = await request({
        method: "post",
        url: `${API}/items`,
        data: item,
        headers: {
            "Content-Type": "application/json"
        },
        timeout: 30000
    });

    return response.data;
};

exports.createDescription = async (itemId, description) => {

    const response = await request({
        method: "post",
        url: `${API}/items/${itemId}/description`,
        data: {
            plain_text: description
        },
        headers: {
            "Content-Type": "application/json"
        },
        timeout: 30000
    });

    return response.data;
};

exports.getItem = async (itemId) => {

    const response = await request({
        method: "get",
        url: `${API}/items/${itemId}`,
        timeout: 30000
    });

    return response.data;
};

exports.getMe = async () => {

    const response = await request({
        method: "get",
        url: `${API}/users/me`,
        timeout: 30000
    });

    return response.data;
};

exports.updateItem = async (itemId, body) => {

    const response = await request({
        method: "put",
        url: `${API}/items/${itemId}`,
        data: body,
        headers: {
            "Content-Type": "application/json"
        },
        timeout: 30000
    });

    return response.data;
};

// ======================================================
// PREDITOR DE CATEGORIA MERCADO LIVRE
// ======================================================

exports.predictCategory = async (title) => {

    if (!title || !String(title).trim()) {
        throw new Error(
            "Titulo nao informado para previsao de categoria."
        );
    }

    const response = await request({
        method: "get",
        url: `${API}/sites/MLB/domain_discovery/search`,
        params: {
            limit: 3,
            q: String(title).trim()
        },
        timeout: 30000
    });

    if (
        !Array.isArray(response.data) ||
        response.data.length === 0
    ) {
        throw new Error(
            "Mercado Livre nao encontrou categoria para este produto."
        );
    }

    return response.data;
};

// ======================================================
// BUSCADOR DE PRODUTOS DE CATALOGO
// ======================================================

exports.searchProducts = async (params = {}) => {

    const response = await request({
        method: "get",
        url: `${API}/products/search`,
        params: {
            site_id: "MLB",
            status: "active",
            ...params
        },
        timeout: 30000
    });

    return response.data;
};

exports.getProduct = async (productId) => {

    if (!productId) {
        throw new Error("Product ID nao informado.");
    }

    const response = await request({
        method: "get",
        url: `${API}/products/${encodeURIComponent(productId)}`,
        timeout: 30000
    });

    return response.data;
};