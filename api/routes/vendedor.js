const express = require("express");
const crypto = require("crypto");
const service = require("../services/tratoVendedor.service");
const chatService = require("../services/tratoVendedorChat.service");
const sellerListing = require("../services/seller/sellerListing.service");

const router = express.Router();
const handoffAttempts = new Map();
const voiceAttempts = new Map();
const chatAttempts = new Map();
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

function allowVoiceSynthesis(ip) {
    const now = Date.now();
    const recent = (voiceAttempts.get(ip) || []).filter(timestamp => now - timestamp < 60 * 1000);
    if (recent.length >= 4) {
        voiceAttempts.set(ip, recent);
        return false;
    }
    recent.push(now);
    voiceAttempts.set(ip, recent);
    return true;
}

function allowChat(ip) {
    const now = Date.now();
    const recent = (chatAttempts.get(ip) || []).filter(timestamp => now - timestamp < 60 * 1000);
    if (recent.length >= 15) {
        chatAttempts.set(ip, recent);
        return false;
    }
    recent.push(now);
    chatAttempts.set(ip, recent);
    return true;
}

function safeEqual(left, right) {
    const a = Buffer.from(String(left || ""));
    const b = Buffer.from(String(right || ""));
    return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Autorização de ações com efeito real (publicar anúncio).
 *
 * A implementação vive em middleware/publishKeyAuth.js e é a MESMA usada pela
 * rota antiga /api/ml/publish/:id, para não existirem duas regras de acesso.
 * A chave é comparada sempre no servidor e nunca é devolvida ou registrada.
 */
const requireAdminKey = require("../middleware/publishKeyAuth");

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

// Cérebro conversacional remoto via API DeepSeek.
router.get("/chat/status", (req, res) => {
    const status = chatService.status();
    return res.json({
        success: true,
        available: status.available,
        configured: status.configured,
        provider: status.provider,
        model: status.model,
        scope: status.scope
    });
});

router.post("/chat", async (req, res) => {
    const clientIp = String(req.ip || req.socket?.remoteAddress || "unknown");
    if (!allowChat(clientIp)) {
        return res.status(429).json({
            success: false,
            error: "Muitas mensagens em pouco tempo. Aguarde um minuto."
        });
    }

    const messages = req.body?.messages;
    if (!Array.isArray(messages) || messages.length < 1 || messages.length > 12) {
        return res.status(400).json({
            success: false,
            error: "Envie uma conversa com até 12 mensagens."
        });
    }

    const safeMessages = [];
    for (const message of messages) {
        const role = String(message?.role || "");
        const content = String(message?.content || "").trim();
        if (!["user", "assistant"].includes(role) || !content || content.length > 2000) {
            return res.status(400).json({
                success: false,
                error: "Mensagem inválida. Cada mensagem deve ter até 2.000 caracteres."
            });
        }
        safeMessages.push({ role, content });
    }
    if (safeMessages[safeMessages.length - 1].role !== "user") {
        return res.status(400).json({
            success: false,
            error: "A última mensagem precisa ser do usuário."
        });
    }

    try {
        const lastUserMessage = safeMessages[safeMessages.length - 1].content;
        let catalogProducts = [];
        if (/\b(tem|vende|procur|busc|pre[cç]o|estoque|produto|compr|playstation|xbox|videogame|celular|console|vinil)\b/i.test(lastUserMessage)) {
            try {
                catalogProducts = await service.searchProducts(lastUserMessage, 5);
            } catch (catalogError) {
                console.error("[Trato Vendedor IA] Falha ao consultar catálogo para o chat:", catalogError.message);
            }
        }
        const result = await chatService.chat(safeMessages, catalogProducts);
        return res.json({ success: true, answer: result.answer, model: result.model });
    } catch (error) {
        const status = Number(error.status) || 502;
        console.error("[Trato Vendedor IA] Erro no chat DeepSeek:", error.message);
        return res.status(status).json({
            success: false,
            code: error.code || "CHAT_ERROR",
            error: error.message || "Não foi possível gerar uma resposta."
        });
    }
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
    const clientIp = String(req.ip || req.socket?.remoteAddress || "unknown");
    if (!allowVoiceSynthesis(clientIp)) {
        return res.status(429).json({
            success: false,
            error: "Limite de geração de voz atingido. Aguarde um minuto."
        });
    }
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

// ======================================================
// VENDEDOR AUTOMÁTICO — ANÚNCIO ASSISTIDO
// ======================================================
// Rotas ADITIVAS: convivem com o chat, a voz e o atendimento acima.
// Nenhuma rota existente foi alterada.

/**
 * Converte os erros do serviço em respostas para a tela de revisão.
 */
function sendListingError(res, error, fallbackStatus = 500) {
    if (error.code === "ML_MISSING_ATTRIBUTES") {
        return res.status(422).json({
            success: false,
            code: error.code,
            message: error.message,
            needs_input: true,
            missing: error.missing || [],
            suggestions: error.suggestions || []
        });
    }

    if (error.code === "ML_APPROVAL_REQUIRED") {
        return res.status(428).json({
            success: false,
            code: error.code,
            message: error.message
        });
    }

    if (error.code === "ML_MISSING_PICTURES") {
        return res.status(422).json({
            success: false,
            code: error.code,
            message: error.message
        });
    }

    // O anúncio foi criado no Mercado Livre, mas o vínculo não foi gravado.
    if (error.ml?.id) {
        return res.status(500).json({
            success: false,
            message: error.message || "Anúncio criado no Mercado Livre, mas não registrado no banco.",
            persisted: false,
            ml: {
                id: error.ml.id,
                permalink: error.ml.permalink || null,
                status: error.ml.status || null
            }
        });
    }

    if (error.response) {
        return res.status(error.response.status || fallbackStatus).json({
            success: false,
            message: "O Mercado Livre recusou a solicitação.",
            error: error.response.data
        });
    }

    return res.status(error.status || fallbackStatus).json({
        success: false,
        message: error.message || "Erro ao processar o anúncio."
    });
}

// Status do Mercado Livre + estado real das IAs (nuvem e local).
router.get("/anuncio/status", async (req, res) => {
    let mercadoLivre = { conectado: false };

    try {
        const apiService = require("../services/ml/api.service");
        const me = await apiService.getMe();

        mercadoLivre = {
            conectado: true,
            user_id: me.id,
            nickname: me.nickname,
            site_id: me.site_id
        };
    } catch (_) {
        mercadoLivre = {
            conectado: false,
            message: "Mercado Livre desconectado. Autorize a conta em /api/ml/login."
        };
    }

    const { status: aiStatus } = require("../services/local-ai.service");
    const localVision = require("../services/localVision.service");

    const ia = {
        gemini: { disponivel: false },
        local: { disponivel: false },
        modo: "manual"
    };

    try {
        const gemini = await aiStatus();
        ia.gemini = {
            disponivel: Boolean(gemini.online && gemini.vision_ready),
            modelo: gemini.vision_model || null,
            chave_valida: gemini.key_valid !== false
        };
    } catch (_) {
        ia.gemini = { disponivel: false };
    }

    try {
        const local = await localVision.status();
        ia.local = {
            disponivel: Boolean(local.online && local.vision_ready),
            modelo: local.vision_model || null,
            url: local.url,
            // Motivo real para o vendedor entender por que a visão local
            // não está sendo usada (modelo ausente, falha ao carregar, etc.).
            motivo: local.motivo || null
        };
    } catch (_) {
        ia.local = { disponivel: false };
    }

    if (ia.gemini.disponivel) ia.modo = "gemini";
    else if (ia.local.disponivel) ia.modo = "local";
    else ia.modo = "manual";

    return res.json({
        success: true,
        mercado_livre: mercadoLivre,
        ia,
        conectado: mercadoLivre.conectado
    });
});

// Monta o pacote de revisão (não publica nada).
router.post("/anuncio/revisao", requireAdminKey, async (req, res) => {
    try {
        const body = req.body || {};

        if (!body.productId) {
            return res.status(400).json({
                success: false,
                message: "produto não informado (envie productId)."
            });
        }

        const review = await sellerListing.buildReview({
            productId: body.productId,
            identification: body.identification || {},
            sellerObservation: body.sellerObservation || body.observacao_vendedor || "",
            overrides: body.overrides || {},
            attributeOverrides: body.attributeOverrides || body.attribute_overrides || {},
            skipAi: body.skipAi === true,
            skipPrice: body.skipPrice === true
        });

        return res.json(review);
    } catch (error) {
        console.error("[Trato Vendedor] Erro na revisão do anúncio:", error.response?.data || error.message);
        return sendListingError(res, error, 502);
    }
});

// Publica o anúncio aprovado (exige approve: true).
// Publica o anúncio aprovado (exige approve: true e chave de autorização).
router.post("/anuncio/publicar", requireAdminKey, async (req, res) => {
    try {
        const body = req.body || {};

        if (!body.productId) {
            return res.status(400).json({ success: false, message: "produto não informado (envie productId)." });
        }

        const result = await sellerListing.publish({
            productId: body.productId,
            identification: body.identification || {},
            overrides: body.overrides || {},
            attributeOverrides: body.attributeOverrides || body.attribute_overrides || {},
            approve: body.approve === true,
            dryRun: body.dryRun === true,
            skipValidation: body.skipValidation === true
        });

        return res.json({
            ...result,
            message: result.published
                ? "Anúncio publicado no Mercado Livre."
                : "Simulação concluída (modo de teste, nada foi publicado)."
        });
    } catch (error) {
        console.error("[Trato Vendedor] Erro na publicação:", error.response?.data || error.message);
        return sendListingError(res, error, 502);
    }
});

// ======================================================
// SINCRONIZAÇÃO DAS FOTOS COM O GOOGLE DRIVE
// ======================================================
// O Render não tem disco persistente: sem `drive_file_id` a publicação falha
// ao tentar enviar a foto. Estas rotas apenas operam a sincronização; a
// integração OAuth é a MESMA do TratoCap (nenhuma segunda integração).

function servicoDrive() {
    return require("../services/googleDriveOAuthService").createGoogleDriveOAuthService();
}

// Situação atual: quantas imagens já têm Drive e quantas faltam.
router.get("/anuncio/imagens/status", requireAdminKey, async (req, res) => {
    try {
        const driveImageSync = require("../services/driveImageSync.service");
        const resumo = await driveImageSync.resumo();

        let autorizado = false;
        try {
            const servico = servicoDrive();
            autorizado = Boolean(servico.configured && servico.configured());
        } catch (_) {
            autorizado = false;
        }

        return res.json({ success: true, ...resumo, drive_autorizado: autorizado });
    } catch (error) {
        return res.status(500).json({ success: false, error: "Não foi possível consultar as imagens." });
    }
});

// Envia um lote de imagens para o Drive. `dryRun` (padrão) só relata.
router.post("/anuncio/imagens/sincronizar", requireAdminKey, async (req, res) => {
    try {
        const body = req.body || {};
        const dryRun = body.dryRun !== false;
        const limite = Math.max(1, Math.min(100, Number(body.limite) || 10));

        const driveImageSync = require("../services/driveImageSync.service");

        if (dryRun) {
            const previsao = await driveImageSync.sincronizarLote({ limite, dryRun: true });
            return res.json({ success: true, ...previsao });
        }

        const servico = servicoDrive();

        if (!servico.configured || !servico.configured()) {
            return res.status(503).json({
                success: false,
                code: "DRIVE_NOT_CONFIGURED",
                error: "Google Drive não configurado neste servidor."
            });
        }

        const resultado = await driveImageSync.sincronizarLote({
            driveService: servico,
            limite,
            dryRun: false
        });

        return res.json({ success: true, ...resultado });
    } catch (error) {
        console.error("[Trato Vendedor] Falha ao sincronizar imagens:", String(error.message || "").slice(0, 200));
        return res.status(500).json({ success: false, error: "Falha ao sincronizar as imagens." });
    }
});

module.exports = router;
