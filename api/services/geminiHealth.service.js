// Verifica uma vez se a chave Gemini é aceita pelo Google (cache em memória).
const axios = require("axios");

let cache = { value: null, at: 0 };
const TTL_MS = 10 * 60 * 1000;

async function isAvailable() {
    const key = String(process.env.GEMINI_API_KEY || "").trim();
    if (!key) return false;

    if (cache.value !== null && Date.now() - cache.at < TTL_MS) {
        return cache.value;
    }

    let ok = false;

    try {
        await axios.get("https://generativelanguage.googleapis.com/v1beta/models", {
            headers: { "x-goog-api-key": key },
            timeout: 8000
        });
        ok = true;
    } catch (_) {
        ok = false;
    }

    cache = { value: ok, at: Date.now() };
    return ok;
}

function reset() {
    cache = { value: null, at: 0 };
}

module.exports = { isAvailable, reset };
