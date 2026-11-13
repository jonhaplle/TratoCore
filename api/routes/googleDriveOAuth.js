const express = require("express");
const crypto = require("crypto");
const { createGoogleDriveOAuthService } = require("../services/googleDriveOAuthService");

const STATE_COOKIE = "__Host-tratocore-google-oauth-state";
const STATE_TTL_SECONDS = 600;

/**
 * Traduz o erro real da verificação de gravação em um código seguro.
 *
 * O log do servidor guarda a mensagem completa (para diagnóstico técnico).
 * A resposta HTTP NUNCA devolve token, credencial, caminho interno ou a
 * mensagem crua do Google — só um código estável e uma dica curta.
 */
function codigoDiagnostico(error) {
    const mensagem = String(error?.message || "");
    const resposta = String(error?.response?.data?.error || "");

    // Rede vem primeiro: mensagens como "ENOTFOUND oauth2.googleapis.com"
    // contêm "oauth" e seriam classificadas errado pela regra seguinte.
    if (/ENOTFOUND|ETIMEDOUT|ECONNRESET|EAI_AGAIN|ECONNREFUSED|timeout/i.test(mensagem)) {
        return { code: "REDE_INDISPONIVEL", hint: "Falha de rede ao falar com o Google." };
    }
    if (/invalid_grant|invalid_client|OAuth.*required|authorization is required/i.test(mensagem)) {
        return { code: "OAUTH_NAO_AUTORIZADO", hint: "Autorize a conta Google novamente." };
    }
    if (/Selecione a pasta FOTOS/i.test(mensagem)) {
        return { code: "PASTA_NAO_SELECIONADA", hint: "Selecione a pasta FOTOS no Google Picker." };
    }
    if (/não é mais a pasta FOTOS/i.test(mensagem)) {
        return { code: "PASTA_INVALIDA", hint: "A pasta configurada deixou de ser FOTOS." };
    }
    if (/insufficientPermissions|insufficientFilePermissions/i.test(resposta)) {
        return { code: "SEM_PERMISSAO_ESCRITA", hint: "A conta não tem permissão de escrita na pasta FOTOS." };
    }
    if (/storageQuota/i.test(resposta) || /storageQuota/i.test(mensagem)) {
        return { code: "COTA_EXCEDIDA", hint: "A cota do Google Drive foi excedida." };
    }
    if (/não corresponde ao original/i.test(mensagem)) {
        return { code: "VERIFICACAO_INCONSISTENTE", hint: "O arquivo de teste não voltou idêntico." };
    }
    if (/não confirmou o arquivo/i.test(mensagem)) {
        return { code: "DRIVE_SEM_RESPOSTA", hint: "O Drive não confirmou a criação do arquivo." };
    }

    return { code: "ERRO_NAO_CLASSIFICADO", hint: "Consulte os logs do servidor." };
}

function safeEqual(left, right) {
    if (typeof left !== "string" || typeof right !== "string") return false;
    const a = Buffer.from(left);
    const b = Buffer.from(right);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function cookieValue(header, name) {
    const prefix = `${name}=`;
    const part = String(header || "").split(";").map(value => value.trim()).find(value => value.startsWith(prefix));
    return part ? decodeURIComponent(part.slice(prefix.length)) : null;
}

function createGoogleDriveOAuthRouter(options = {}) {
    const router = express.Router();
    const service = options.service || createGoogleDriveOAuthService(options.serviceOptions);
    const env = options.env || process.env;
    const logger = options.logger || console;

    function requireAdmin(req, res, next) {
        const configuredKey = env.GOOGLE_OAUTH_ADMIN_KEY;
        const supplied = req.get("Authorization")?.replace(/^Bearer\s+/i, "");
        if (!configuredKey || !safeEqual(supplied, configuredKey)) {
            return res.status(401).json({ success: false, error: "Autorização administrativa necessária." });
        }
        next();
    }

    router.post("/start", requireAdmin, (req, res) => {
        try {
            const state = crypto.randomBytes(32).toString("base64url");
            const url = service.authorizationUrl(state);
            res.cookie(STATE_COOKIE, state, {
                httpOnly: true,
                secure: true,
                sameSite: "lax",
                path: "/",
                maxAge: STATE_TTL_SECONDS * 1000
            });
            res.set("Cache-Control", "no-store");
            return res.json({ success: true, authorization_url: url });
        } catch (_) {
            return res.status(503).json({ success: false, error: "OAuth Google não está configurado." });
        }
    });

    router.get("/callback", async (req, res) => {
        const state = String(req.query.state || "");
        const cookieState = cookieValue(req.get("Cookie"), STATE_COOKIE);
        res.clearCookie(STATE_COOKIE, { httpOnly: true, secure: true, sameSite: "lax", path: "/" });
        if (!state || !safeEqual(state, cookieState)) {
            return res.redirect(303, "/google-drive-setup.html?oauth=failed");
        }
        if (req.query.error || !req.query.code) {
            return res.redirect(303, "/google-drive-setup.html?oauth=denied");
        }
        try {
            await service.completeAuthorization(String(req.query.code));
            return res.redirect(303, "/google-drive-setup.html?oauth=connected");
        } catch (_) {
            logger.error("[Google OAuth] Falha segura ao concluir autorização.");
            return res.redirect(303, "/google-drive-setup.html?oauth=failed");
        }
    });

    router.get("/status", requireAdmin, async (_req, res) => {
        try {
            res.set("Cache-Control", "no-store");
            return res.json({ success: true, ...(await service.getStatus()) });
        } catch (_) {
            return res.status(503).json({ success: false, error: "Não foi possível consultar o status OAuth." });
        }
    });

    router.get("/picker-config", requireAdmin, async (_req, res) => {
        try {
            res.set("Cache-Control", "no-store");
            return res.json({ success: true, ...(await service.getPickerConfiguration()) });
        } catch (_) {
            return res.status(503).json({ success: false, error: "Autorize o Google e configure o Picker antes de selecionar a pasta." });
        }
    });

    router.post("/selected-folder", requireAdmin, async (req, res) => {
        const fileId = String(req.body?.fileId || "");
        if (!/^[a-zA-Z0-9_-]+$/.test(fileId)) {
            return res.status(400).json({ success: false, error: "Selecione a pasta FOTOS pelo Google Picker." });
        }
        try {
            res.set("Cache-Control", "no-store");
            return res.json({ success: true, folder: await service.selectRootFolder(fileId) });
        } catch (_) {
            return res.status(400).json({ success: false, error: "A pasta selecionada não pôde ser validada como FOTOS." });
        }
    });

    router.post("/verify-write", requireAdmin, async (_req, res) => {
        try {
            res.set("Cache-Control", "no-store");
            return res.json(await service.verifyWrite());
        } catch (error) {
            // Log técnico completo no servidor (não vai para o cliente).
            logger.error("[Google OAuth] Erro no teste de gravação:", error);

            const diagnostico = codigoDiagnostico(error);

            // Resposta segura: apenas código e dica. Nada de token, caminho
            // interno ou mensagem crua do Google.
            return res.status(503).json({
                success: false,
                error: "Teste de gravação no Drive falhou; uploads continuam bloqueados.",
                code: diagnostico.code,
                hint: diagnostico.hint
            });
        }
    });

    return router;
}

module.exports = { createGoogleDriveOAuthRouter, safeEqual, cookieValue, STATE_COOKIE, codigoDiagnostico };
