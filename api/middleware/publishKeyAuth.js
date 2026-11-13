const crypto = require("crypto");

/**
 * Autorização para ações que publicam anúncios de verdade.
 *
 * A chave (`TRATO_VENDEDOR_ADMIN_KEY`) é comparada SOMENTE no servidor.
 * Ela nunca é enviada ao navegador pelo servidor, nunca aparece em respostas
 * e nunca é registrada em log — o vendedor a digita na própria tela.
 *
 * Sem a chave configurada, a ação fica DESABILITADA (503) em vez de aberta:
 * falhar fechado é o comportamento seguro.
 */
const HEADER = "authorization";

function safeEqual(left, right) {
    const a = Buffer.from(String(left || ""), "utf8");
    const b = Buffer.from(String(right || ""), "utf8");
    if (a.length === 0 || a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
}

function extrairChave(req) {
    const header = req.get(HEADER)?.replace(/^Bearer\s*/i, "").trim();
    if (header) return header;

    const corpo = req.body?.adminKey;
    return typeof corpo === "string" ? corpo.trim() : "";
}

function criar(req, res, next) {
    res.set("Cache-Control", "no-store");

    const esperada = process.env.TRATO_VENDEDOR_ADMIN_KEY;

    if (!esperada) {
        return res.status(503).json({
            success: false,
            code: "ADMIN_KEY_NOT_CONFIGURED",
            error: "Publicação desabilitada: configure TRATO_VENDEDOR_ADMIN_KEY no servidor."
        });
    }

    if (!safeEqual(esperada, extrairChave(req))) {
        return res.status(401).json({
            success: false,
            code: "UNAUTHORIZED",
            error: "Chave de autorização inválida."
        });
    }

    // A chave não segue adiante em nenhum formato.
    if (req.body && Object.hasOwn(req.body, "adminKey")) delete req.body.adminKey;

    return next();
}

module.exports = criar;
module.exports.safeEqual = safeEqual;
module.exports.extrairChave = extrairChave;
