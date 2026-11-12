// ======================================================
// TRATOCORE — MOTOR DE VISÃO LOCAL (Ollama)
// ======================================================
//
// Alternativa ao Gemini quando a chave da nuvem está inválida ou a internet
// não está disponível. Usa um modelo de visão local (Ollama) para descrever
// as fotos do produto.
//
// Regras idênticas às do Gemini:
// - não inventar marca, modelo, especificação ou acessório;
// - não decidir estado (novo/usado) pela foto;
// - devolver SOMENTE JSON.
//
// O download do modelo é pesado, então:
// - o modelo é carregado na primeira chamada (pode demorar minutos);
// - cada tentativa tem um tempo limite configurável;
// - se o Ollama não estiver instalado, a função devolve `null` rapidamente e
//   o fluxo cai para a identificação manual do vendedor.

const fs = require("fs");
const path = require("path");
const axios = require("axios");

const OLLAMA_URL = String(process.env.OLLAMA_URL || "http://127.0.0.1:11434").replace(/\/+$/, "");
const LOCAL_VISION_MODEL = String(process.env.LOCAL_VISION_MODEL || "qwen3-vl:4b-instruct").trim();
const TIMEOUT_MS = Number(process.env.LOCAL_VISION_TIMEOUT_MS || 300000);
const ENABLED = String(process.env.LOCAL_VISION_ENABLED || "true").toLowerCase() !== "false";

const PROMPT = `Você analisa a FOTO de um produto para o TratoCore (anúncios no Mercado Livre).

REGRAS OBRIGATÓRIAS:
1. Nunca invente marca, modelo, versão, capacidade, código ou acessório.
2. Só afirme o que a imagem mostra ou o que o vendedor declarou.
3. Se o modelo não puder ser lido na foto, deixe "model" vazio e explique em "hypotheses".
4. Estado de conservação (novo/usado) NÃO deve ser decidido pela foto: deixe "condition" vazio.
5. "facts" = características visíveis (cor, formato, marca estampada, telas, botões).
6. "hypotheses" = o que você supoe mas NÃO está confirmado.
7. Responda SOMENTE JSON válido, sem markdown.

OBSERVAÇÃO DO VENDEDOR:
{{OBSERVACAO}}

FORMATO:
{"identification":{"product_type":"","brand":"","line":"","model":"","generation":"","version":"","color":"","condition":""},"facts":[],"hypotheses":[],"confidence":{"score":0,"level":"LOW"}}`;

function cleanJson(text) {
    return String(text || "")
        .replace(/```json/gi, "")
        .replace(/```/g, "")
        .trim();
}

function extractJson(text) {
    const clean = cleanJson(text);
    try {
        return JSON.parse(clean);
    } catch (_) {
        const start = clean.indexOf("{");
        const end = clean.lastIndexOf("}");
        if (start >= 0 && end > start) {
            try {
                return JSON.parse(clean.slice(start, end + 1));
            } catch (_) {
                return null;
            }
        }
        return null;
    }
}

function imagePayload(file) {
    const ext = path.extname(file).toLowerCase();
    const mime = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";

    return {
        mime,
        data: fs.readFileSync(file).toString("base64")
    };
}

/** Verifica rapidamente se o Ollama está de pé. */
async function isAvailable() {
    if (!ENABLED) return false;

    try {
        await axios.get(`${OLLAMA_URL}/api/version`, { timeout: 2500 });
        return true;
    } catch (_) {
        return false;
    }
}

/** Lista os modelos instalados (nomes completos com tag). */
async function listModels() {
    try {
        const response = await axios.get(`${OLLAMA_URL}/api/tags`, { timeout: 5000 });
        return (response.data?.models || []).map(model => String(model.name || ""));
    } catch (_) {
        return [];
    }
}

async function pickVisionModel() {
    const models = await listModels();
    if (!models.length) return null;

    if (models.includes(LOCAL_VISION_MODEL)) return LOCAL_VISION_MODEL;

    // Fallback apenas para modelos visuais presentes na máquina.
    const fallback = models.find(name => /vl|vision|llava|gemma3/i.test(name) && !/text/i.test(name));
    return fallback || null;
}

function normalizeConfidence(value) {
    const number = Number(value?.score ?? value);

    if (!Number.isFinite(number)) return { score: 0, level: "LOW" };

    const score = number > 1 ? Math.min(number, 100) : Math.round(number * 100);
    const level = score >= 80 ? "HIGH" : score >= 55 ? "MEDIUM" : "LOW";

    return { score, level };
}

function toAnalysis(parsed) {
    if (!parsed || typeof parsed !== "object") return null;

    const identification = parsed.identification || {};

    // Estado nunca vem da foto, mesmo que o modelo tente responder.
    identification.condition = "";

    const facts = Array.isArray(parsed.facts)
        ? parsed.facts.map(item => typeof item === "string" ? item : String(item?.text || item?.value || "")).filter(Boolean)
        : [];

    const hypotheses = Array.isArray(parsed.hypotheses)
        ? parsed.hypotheses
            .map(item => typeof item === "string"
                ? { field: "produto", value: item }
                : { field: String(item?.field || "produto"), value: String(item?.value || item?.text || "") })
            .filter(item => item.value)
        : [];

    return {
        product_type: String(identification.product_type || ""),
        brand: String(identification.brand || ""),
        line: String(identification.line || ""),
        model: String(identification.model || ""),
        generation: String(identification.generation || ""),
        version: String(identification.version || ""),
        color: String(identification.color || ""),
        condition: "",
        identification,
        facts,
        hypotheses,
        confidence: normalizeConfidence(parsed.confidence),
        provider: "local_vision"
    };
}

/**
 * Analisa a foto principal do produto.
 *
 * @param {string} imagePath  caminho absoluto da imagem
 * @param {string} sellerObservation
 * @returns {Promise<object|null>}  análise no mesmo formato do Gemini, ou null
 */
async function analyzeImage(imagePath, sellerObservation = "") {
    if (!ENABLED) return null;

    const available = await isAvailable();
    if (!available) return null;

    const absolute = path.resolve(String(imagePath || ""));
    if (!fs.existsSync(absolute)) return null;

    const model = await pickVisionModel();
    if (!model) return null;

    const payload = imagePayload(absolute);
    const prompt = PROMPT.replace("{{OBSERVACAO}}", String(sellerObservation || "nenhuma"));

    const response = await axios.post(
        `${OLLAMA_URL}/api/chat`,
        {
            model,
            messages: [{
                role: "user",
                content: prompt,
                images: [payload.data]
            }],
            stream: false,
            options: {
                temperature: 0.1,
                num_predict: 700
            }
        },
        { timeout: TIMEOUT_MS }
    );

    const text = response.data?.message?.content || response.data?.response || "";
    const parsed = extractJson(text);

    if (!parsed) {
        const error = new Error("O modelo local não retornou JSON válido.");
        error.raw = String(text).slice(0, 400);
        throw error;
    }

    return {
        ...toAnalysis(parsed),
        model_used: model
    };
}

async function status() {
    const available = await isAvailable();

    if (!available) {
        return {
            enabled: ENABLED,
            online: false,
            url: OLLAMA_URL,
            vision_model: LOCAL_VISION_MODEL,
            vision_ready: false
        };
    }

    const model = await pickVisionModel();

    return {
        enabled: ENABLED,
        online: true,
        url: OLLAMA_URL,
        vision_model: model || LOCAL_VISION_MODEL,
        vision_ready: Boolean(model),
        configured_model: LOCAL_VISION_MODEL
    };
}

function isEnabled() {
    return ENABLED;
}

module.exports = {
    analyzeImage,
    isAvailable,
    isEnabled,
    status,
    listModels,
    pickVisionModel,
    extractJson,
    toAnalysis,
    OLLAMA_URL,
    LOCAL_VISION_MODEL
};
