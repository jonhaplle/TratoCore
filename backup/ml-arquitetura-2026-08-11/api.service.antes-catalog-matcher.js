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
        throw new Error("Access Token não configurado.");
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

    try {

        console.log("====================================");
        console.log("PUBLICANDO ANÚNCIO MERCADO LIVRE");
        console.log("====================================");

        const response = await request({
            method: "post",
            url: `${API}/items`,
            data: item,
            headers: {
                "Content-Type": "application/json"
            },
            timeout: 30000
        });

        console.log("====================================");
        console.log("ANÚNCIO PUBLICADO");
        console.log("ID:", response.data.id);
        console.log("STATUS:", response.data.status);
        console.log("====================================");

        return response.data;

    } catch (err) {

        console.log("====================================");
        console.log("ERRO API MERCADO LIVRE");
        console.log("====================================");

        if (err.response) {

            console.log("HTTP:", err.response.status);

            console.dir(err.response.data, {
                depth: null
            });

        } else {

            console.error(err.message);

        }

        throw err;

    }

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
        throw new Error("Título não informado para previsão de categoria.");
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

    if (!Array.isArray(response.data) || response.data.length === 0) {
        throw new Error("Mercado Livre não encontrou categoria para este produto.");
    }

    return response.data;
};

exports.getCategory = async (categoryId) => {

    if (!categoryId || !String(categoryId).trim()) {
        throw new Error("category_id não informado.");
    }

    const response = await request({
        method: "get",
        url: `${API}/categories/${String(categoryId).trim()}`,
        timeout: 30000
    });

    return response.data;
};

exports.getCategoryAttributes = async (categoryId) => {

    if (!categoryId || !String(categoryId).trim()) {
        throw new Error("category_id não informado.");
    }

    const response = await request({
        method: "get",
        url: `${API}/categories/${String(categoryId).trim()}/attributes`,
        timeout: 30000
    });

    return response.data;
};

exports.getConditionalAttributes = async (categoryId, item) => {

    if (!categoryId || !String(categoryId).trim()) {
        throw new Error("category_id não informado.");
    }

    const response = await request({
        method: "post",
        url: `${API}/categories/${String(categoryId).trim()}/attributes/conditional`,
        data: item,
        headers: {
            "Content-Type": "application/json"
        },
        timeout: 30000
    });

    return response.data;
};

exports.getAvailableListingTypes = async (userId, categoryId) => {

    if (!userId || !categoryId) {
        throw new Error("user_id e category_id são obrigatórios para consultar listing types.");
    }

    const response = await request({
        method: "get",
        url: `${API}/users/${userId}/available_listing_types`,
        params: {
            category_id: categoryId
        },
        timeout: 30000
    });

    return response.data;
};

exports.validateItem = async (item) => {

    const response = await request({
        method: "post",
        url: `${API}/items/validate`,
        data: item,
        headers: {
            "Content-Type": "application/json"
        },
        timeout: 30000
    });

    return response.data;
};

// ======================================================
// BUSCA DE ANÚNCIOS MERCADO LIVRE
// ======================================================

exports.searchItems = async (query, categoryId, limit = 10) => {

    if (!query || !String(query).trim()) {
        throw new Error("Texto de busca não informado.");
    }

    const params = {
        q: String(query).trim(),
        limit: Math.min(Math.max(Number(limit) || 10, 1), 50)
    };

    if (categoryId) {
        params.category = String(categoryId).trim();
    }

    const response = await request({
        method: "get",
        url: `${API}/sites/MLB/search`,
        params,
        timeout: 30000
    });

    return response.data;
};// ======================================================
// BUSCA DE PRODUTOS / CATÁLOGO MERCADO LIVRE
// ======================================================

exports.searchProducts = async (query, limit = 10) => {

    if (!query || !String(query).trim()) {
        throw new Error("Texto de busca não informado.");
    }

    const safeLimit = Math.min(
        Math.max(Number(limit) || 10, 1),
        20
    );

    const response = await request({
        method: "get",
        url: `${API}/products/search`,
        params: {
            status: "active",
            site_id: "MLB",
            q: String(query).trim(),
            limit: safeLimit
        },
        timeout: 30000
    });

    const data = response.data || {};

    return {
        keywords: data.keywords || String(query).trim(),
        paging: data.paging || {},
        results: (data.results || []).map(product => ({
            id: product.id,
            catalog_product_id: product.catalog_product_id,
            domain_id: product.domain_id,
            name: product.name,
            settings: product.settings || {},
            attributes: (product.attributes || []).map(attribute => ({
                id: attribute.id,
                name: attribute.name,
                value_id: attribute.value_id || null,
                value_name: attribute.value_name || null
            }))
        }))
    };
};