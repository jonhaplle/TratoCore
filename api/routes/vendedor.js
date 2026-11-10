const express = require("express");
const crypto = require("crypto");
const service = require("../services/tratoVendedor.service");

const router = express.Router();

function safeEqual(left, right) {
    const a = Buffer.from(String(left || ""));
    const b = Buffer.from(String(right || ""));
    return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

router.get("/status", (req, res) => {
    res.json({
        success: true,
        module: "Trato Vendedor IA",
        version: "1.0.0",
        catalog: "PostgreSQL",
        voice_input: "browser-dependent",
        voice_output: "browser-dependent",
        ai_provider_required: false
    });
});

router.get("/search", async (req, res) => {
    try {
        const query = String(req.query.q || "").trim();
        if (query.length < 2) {
            return res.status(400).json({
                success: false,
                error: "Digite pelo menos duas letras para pesquisar."
            });
        }
        if (query.length > 160) {
            return res.status(400).json({
                success: false,
                error: "A pesquisa deve ter no máximo 160 caracteres."
            });
        }
        const products = await service.searchProducts(query, req.query.limit);
        return res.json({
            success: true,
            query,
            count: products.length,
            products
        });
    } catch (error) {
        console.error("[Trato Vendedor] Erro na busca:", error.message);
        return res.status(500).json({
            success: false,
            error: "Não foi possível consultar o catálogo agora."
        });
    }
});

router.post("/handoff", async (req, res) => {
    try {
        const customerName = String(req.body?.customer_name || "").trim().slice(0, 120);
        const contact = String(req.body?.customer_contact || "").trim().slice(0, 160);
        const message = String(req.body?.message || "").trim().slice(0, 2000);
        const productTitle = String(req.body?.product_title || "").trim().slice(0, 240);
        const rawProductId = req.body?.product_id;
        const productId = rawProductId === null || rawProductId === undefined || rawProductId === ""
            ? null
            : Number(rawProductId);

        if (!message) {
            return res.status(400).json({ success: false, error: "Escreva sua dúvida para chamar o vendedor." });
        }
        if (productId !== null && (!Number.isInteger(productId) || productId <= 0)) {
            return res.status(400).json({ success: false, error: "Produto inválido." });
        }

        const handoff = await service.createHandoff({
            customer_name: customerName,
            customer_contact: contact,
            message,
            product_id: productId,
            product_title: productTitle
        });
        return res.status(201).json({
            success: true,
            message: "Sua solicitação foi encaminhada para a equipe da loja.",
            handoff
        });
    } catch (error) {
        console.error("[Trato Vendedor] Erro ao encaminhar atendimento:", error.message);
        return res.status(500).json({
            success: false,
            error: "Não foi possível encaminhar sua solicitação. Tente novamente."
        });
    }
});

router.get("/handoffs", async (req, res) => {
    const expected = process.env.TRATO_VENDEDOR_ADMIN_KEY;
    const supplied = req.get("Authorization")?.replace(/^Bearer\s*/i, "").trim();
    if (!expected) {
        return res.status(503).json({
            success: false,
            error: "Configure TRATO_VENDEDOR_ADMIN_KEY no ambiente para habilitar a caixa de atendimento."
        });
    }
    if (!safeEqual(expected, supplied)) {
        return res.status(401).json({ success: false, error: "Acesso não autorizado." });
    }
    try {
        const handoffs = await service.listHandoffs(req.query.limit);
        return res.json({ success: true, count: handoffs.length, handoffs });
    } catch (error) {
        console.error("[Trato Vendedor] Erro ao listar atendimentos:", error.message);
        return res.status(500).json({ success: false, error: "Não foi possível consultar os atendimentos." });
    }
});

module.exports = router;
