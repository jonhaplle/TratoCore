const express = require("express");
const crypto = require("crypto");
const service = require("../services/tratoVendedor.service");

const router = express.Router();
const handoffAttempts = new Map();
const HANDOFF_WINDOW_MS = 60 * 1000;
const HANDOFF_MAX_ATTEMPTS = 8;

function allowHandoff(ip) {
    const now = Date.now();
    const previous = handoffAttempts.get(ip) || [];
    const recent = previous.filter(timestamp => now - timestamp < HANDOFF_WINDOW_MS);
    if (recent.length >= HANDOFF_MAX_ATTEMPTS) {
        handoffAttempts.set(ip, recent);
        return false;
    }
    recent.push(now);
    handoffAttempts.set(ip, recent);
    return true;
}

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

// O motor Qwen3-TTS roda apenas no computador da loja, em loopback.
router.get("/voice/status", async (req, res) => {
    try {
        const response = await fetch("http://127.0.0.1:8765/health", {
            signal: AbortSignal.timeout(2500)
        });
        if (!response.ok) throw new Error("Motor de voz indisponível.");
        const data = await response.json();
        return res.json({
            success: true,
            available: Boolean(data.success && data.reference_loaded),
            engine: data.engine || "Qwen3-TTS",
            voice: data.voice || "Marcos",
            scope: "local-network"
        });
    } catch (_) {
        return res.json({
            success: true,
            available: false,
            engine: "browser-fallback",
            voice: null,
            scope: "local-only"
        });
    }
});

router.post("/voice/speak", async (req, res) => {
    const text = String(req.body?.text || "").trim();
    if (!text) {
        return res.status(400).json({ success: false, error: "Informe o texto para falar." });
    }
    if (text.length > 1200) {
        return res.status(400).json({ success: false, error: "O texto deve ter no máximo 1.200 caracteres." });
    }

    try {
        const response = await fetch("http://127.0.0.1:8765/synthesize", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text }),
            signal: AbortSignal.timeout(180000)
        });
        if (!response.ok) {
            const detail = await response.json().catch(() => ({}));
            return res.status(response.status).json({
                success: false,
                error: detail.error || "O motor local não conseguiu gerar o áudio."
            });
        }
        const audio = Buffer.from(await response.arrayBuffer());
        res.setHeader("Content-Type", "audio/wav");
        res.setHeader("Content-Length", audio.length);
        res.setHeader("Cache-Control", "no-store");
        return res.status(200).send(audio);
    } catch (error) {
        console.error("[Trato Vendedor] Erro no Qwen3-TTS local:", error.message);
        return res.status(503).json({
            success: false,
            error: "Voz clonada indisponível. Verifique se o motor local está iniciado."
        });
    }
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
    const clientIp = String(req.ip || req.socket?.remoteAddress || "unknown");
    if (!allowHandoff(clientIp)) {
        return res.status(429).json({
            success: false,
            error: "Muitas solicitações em pouco tempo. Aguarde um minuto e tente novamente."
        });
    }
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
