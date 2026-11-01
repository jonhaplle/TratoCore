const express = require("express");
const crypto = require("crypto");
const { createGoogleDriveOAuthService } = require("../services/googleDriveOAuthService");

const STATE_COOKIE = "__Host-tratocore-google-oauth-state";
const STATE_TTL_SECONDS = 600;

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
            return res.status(400).json({ success: false, error: "Selecione a pasta Produtos pelo Google Picker." });
        }
        try {
            res.set("Cache-Control", "no-store");
            return res.json({ success: true, folder: await service.selectProductsFolder(fileId) });
        } catch (_) {
            return res.status(400).json({ success: false, error: "A pasta selecionada não pôde ser validada como Produtos." });
        }
    });

    router.post("/verify-write", requireAdmin, async (_req, res) => {
        try {
            res.set("Cache-Control", "no-store");
            return res.json(await service.verifyWrite());
        } catch (error) {
            logger.error("[Google OAuth] Erro no teste de gravação:", error);
            return res.status(503).json({ success: false, error: "Teste de gravação no Drive falhou; uploads continuam bloqueados." });
        }
    });

    return router;
}

module.exports = { createGoogleDriveOAuthRouter, safeEqual, cookieValue, STATE_COOKIE };
