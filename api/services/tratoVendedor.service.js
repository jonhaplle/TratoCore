const db = require("../db");
const ProductService = require("./productService");

function normalize(value) {
    return String(value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

const STOP_WORDS = new Set([
    "a", "o", "as", "os", "um", "uma", "de", "do", "da", "dos", "das",
    "com", "sem", "para", "por", "no", "na", "nos", "nas", "tem", "quero",
    "procuro", "gostaria", "preciso", "me", "mostre", "ver", "produto",
    "produtos", "vocês", "voces", "ai", "e", "ou"
]);

function termsOf(value) {
    return normalize(value).split(" ").filter(term => term.length > 1 && !STOP_WORDS.has(term));
}

function publicProduct(product) {
    const images = Array.isArray(product.images) ? product.images : [];
    const main = images.find(image => image && image.is_main) || images[0] || {};
    return {
        id: Number(product.id),
        title: String(product.title || "").trim(),
        description: String(product.description || "").trim().slice(0, 700),
        brand: String(product.brand || ""),
        model: String(product.model || ""),
        condition: String(product.condition || "used"),
        price: Number(product.sale_price || 0),
        quantity: Number(product.quantity || 0),
        image_url: product.thumb_url || product.original_url || main.thumb_url || main.original_url || null,
        permalink: product.ml_permalink || null
    };
}

async function searchProducts(query, limit = 12) {
    const terms = termsOf(query);
    if (!terms.length) return [];

    const products = await ProductService.getAll();
    const eligible = products.filter(product =>
        String(product.status || "").toUpperCase() === "ACTIVE" &&
        Number(product.quantity || 0) > 0 &&
        Number(product.sale_price || 0) > 0 &&
        String(product.title || "").trim()
    );

    const normalizedQuery = normalize(query);
    return eligible.map(product => {
        const searchable = normalize([
            product.title, product.brand, product.model, product.product_type,
            product.line, product.description, product.sku
        ].join(" "));
        const title = normalize(product.title);
        let score = 0;

        if (title.includes(normalizedQuery)) score += 12;
        for (const term of terms) {
            if (title.includes(term)) score += 5;
            else if (searchable.includes(term)) score += 2;
        }
        return { product, score };
    })
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || Number(b.product.id) - Number(a.product.id))
    .slice(0, Math.max(1, Math.min(Number(limit) || 12, 24)))
    .map(item => publicProduct(item.product));
}

async function ensureHandoffSchema() {
    await db.query(`
        CREATE TABLE IF NOT EXISTS trato_vendedor_handoffs (
            id BIGSERIAL PRIMARY KEY,
            customer_name VARCHAR(120),
            customer_contact VARCHAR(160),
            message TEXT NOT NULL,
            product_id BIGINT NULL REFERENCES products(id) ON DELETE SET NULL,
            product_title VARCHAR(240),
            status VARCHAR(24) NOT NULL DEFAULT 'NEW',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            attended_at TIMESTAMPTZ
        )
    `);
    await db.query(`
        CREATE INDEX IF NOT EXISTS idx_trato_vendedor_handoffs_status_created
        ON trato_vendedor_handoffs (status, created_at DESC)
    `);
}

async function createHandoff(data) {
    await ensureHandoffSchema();
    const result = await db.query(
        `INSERT INTO trato_vendedor_handoffs
            (customer_name, customer_contact, message, product_id, product_title)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, status, created_at`,
        [
            data.customer_name || null,
            data.customer_contact || null,
            data.message,
            data.product_id || null,
            data.product_title || null
        ]
    );
    return result.rows[0];
}

async function listHandoffs(limit = 40) {
    await ensureHandoffSchema();
    const result = await db.query(
        `SELECT id, customer_name, customer_contact, message, product_id,
                product_title, status, created_at
         FROM trato_vendedor_handoffs
         WHERE status = 'NEW'
         ORDER BY created_at DESC
         LIMIT $1`,
        [Math.max(1, Math.min(Number(limit) || 40, 100))]
    );
    return result.rows;
}

module.exports = { searchProducts, createHandoff, listHandoffs };
