// ======================================================
// TRATOCORE — REFERÊNCIA DE PREÇO
// ======================================================
//
// Sugere preço a partir de referências reais do Mercado Livre.
//
// Fontes, em ordem de confiança:
// 1. CONCORRENTES (catalog/ofertas): preços de anúncios de catálogo do mesmo
//    produto, aberto pela rota legítima /products/search -> /products/{id}/items.
// 2. MERCADO (categorias similares): anúncios ativos do próprio vendedor como
//    amostra de preço da categoria.
// 3. ESTIMATIVA: combinação das referências com a regra comercial de usado
//    (ex.: 70% do valor de novo). SEMPRE marcada como estimativa.
//
// A busca aberta /sites/MLB/search está bloqueada para a aplicação (403) e o
// navegador público recebe barreira anti-robô. Quando não há referência, o
// serviço devolve suggested = null e explica o motivo — nunca inventa preço.

const apiService = require("./api.service");

const SEARCH_TIMEOUT_MS = 12000;
const MAX_DETAIL_REQUESTS = 12;
const MAX_OWN_ITEMS_SAMPLE = 60;

// Desconto comercial usado quando só existem preços de produto novo.
const USED_RATIO = 0.7;

function roundMoney(value) {
    if (!Number.isFinite(Number(value))) return null;
    return Math.round(Number(value) * 100) / 100;
}

function median(values) {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2
        ? sorted[middle]
        : (sorted[middle - 1] + sorted[middle]) / 2;
}

function percentile(values, ratio) {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * ratio)));
    return sorted[index];
}

function normalizeCondition(value) {
    const text = String(value || "").toLowerCase();
    if (text === "new" || text === "novo") return "new";
    if (text === "used" || text === "usado") return "used";
    return null;
}

/**
 * "128 GB", "128Gb" e "128gb" viram o mesmo token "128gb", permitindo
 * comparar a variante de capacidade do catálogo com a do vendedor.
 */
function normalizeCapacity(value) {
    return String(value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/(\d)\s*(gb|tb|mb)\b/g, "$1$2");
}

let axiosOverride = null;

/** Permite injetar um cliente HTTP em testes sem perder os defaults. */
function setHttpClient(client) {
    axiosOverride = client || null;
}

function httpClient() {
    return axiosOverride || require("axios");
}

/** Termo de busca conservador: não inclui palavras de marketing. */
function buildSearchTerm(identification = {}, explicitQuery = "") {
    const explicit = String(explicitQuery || "").trim();
    if (explicit) return explicit.slice(0, 120);

    const ordered = [
        identification.brand,
        identification.line,
        identification.model,
        identification.version,
        identification.capacity,
        identification.color
    ]
        .map(value => String(value || "").trim())
        .filter(Boolean);

    // "Galaxy" + "Galaxy A15" vira "Galaxy Galaxy A15", que o Mercado Livre
    // interpreta mal. Removemos palavras que já aparecem em outro campo.
    const seenWords = new Set();
    const parts = [];

    for (const value of ordered) {
        const words = value.split(/\s+/).filter(Boolean);
        const unique = words.filter(word => !seenWords.has(normalizeWord(word)));

        if (!unique.length) continue;

        for (const word of words) seenWords.add(normalizeWord(word));
        parts.push(unique.join(" "));
    }

    // Título já otimizado é um bom termo quando a identificação está incompleta.
    if (parts.length < 2 && identification.title) {
        parts.push(String(identification.title).trim());
    }

    return parts.join(" ").slice(0, 120);
}

function normalizeWord(value) {
    return String(value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim();
}

// ----------------------------------------------------------------------
// FONTE 1 — concorrentes de catálogo
// ----------------------------------------------------------------------

function productMatches(product, identification) {
    const name = String(product?.name || "").toLowerCase();

    const brand = String(identification.brand || "").toLowerCase();
    const model = String(identification.model || "").toLowerCase();

    if (brand && !name.includes(brand)) return false;

    const modelWords = model
        .replace(/[^a-z0-9]+/gi, " ")
        .trim()
        .split(/\s+/)
        .filter(word => word.length > 1);

    return modelWords.every(word => name.includes(word)) || !modelWords.length;
}

const ACCESSORY_PATTERN = /\b(capa|capinha|pelicula|case|estojo|suporte|tela|display|bateria|carregador|cabo|fonte|adaptador|controle|carcaca|conector|flex|placa|peca|pecas|reparo|reposicao|compativel|protetor|kit|adesivo|modulo)\b/;

/** O nome do produto de catálogo descreve um acessório/peça, não o aparelho. */
function isAccessoryProduct(name) {
    return ACCESSORY_PATTERN.test(
        String(name || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    );
}

function attributeValue(product, id) {
    const attribute = (product?.attributes || []).find(item => item.id === id);
    return attribute?.value_name || "";
}

async function catalogReference(identification) {
    const term = buildSearchTerm(identification);
    if (!term || term.length < 3) return null;

    const http = httpClient();

    // As rotas de catálogo exigem o token da conta: sem Authorization o
    // Mercado Livre devolve "PA_UNAUTHORIZED_RESULT_FROM_POLICIES".
    let token = null;
    try {
        token = await apiService.getAccessToken();
    } catch (_) {
        return null;
    }

    const headers = {
        Authorization: `Bearer ${token}`,
        "User-Agent": "TratoCore/1.0"
    };

    let products = [];
    try {
        const response = await http.get("https://api.mercadolibre.com/products/search", {
            params: { site_id: "MLB", status: "active", q: term, limit: 8 },
            timeout: SEARCH_TIMEOUT_MS,
            headers
        });
        products = Array.isArray(response.data?.results) ? response.data.results : [];
    } catch (_) {
        return null;
    }

    const compatible = products
        .filter(product => !isAccessoryProduct(product.name))
        .filter(product => productMatches(product, identification))
        .filter(product => {
            // Se o vendedor informou capacidade, o produto de catálogo precisa bater.
            // "128 Gb" e "128GB" descrevem a mesma variante.
            const capacity = normalizeCapacity(identification.capacity);
            if (!capacity) return true;
            return normalizeCapacity(product.name).includes(capacity);
        });

    const offers = await fetchCatalogOffers(compatible.slice(0, 6));
    const usable = offers.filter(offer => Array.isArray(offer.prices) && offer.prices.length >= 1);

    if (!usable.length) return null;

    // Preferimos as ofertas no mesmo estado; sem elas, as de produto novo
    // ainda servem como base (com o desconto comercial de usado).
    const wantNew = String(identification.condition || "").toLowerCase() === "new";
    const targetCondition = wantNew ? "new" : "used";

    const sameState = usable.find(offer => {
        const conditions = Array.isArray(offer.conditions) ? offer.conditions : [];
        return conditions.length > 0 && conditions.every(condition => condition === targetCondition);
    });

    const chosen = sameState || usable[0];

    // Preços do mesmo estado de todas as variantes úteis (mais amostra).
    const pool = sameState
        ? chosen.prices
        : usable.flatMap(offer => offer.offers
            .filter(item => item.condition === (wantNew ? "new" : "used"))
            .map(item => Number(item.price))
            .filter(price => Number.isFinite(price) && price > 0));

    return {
        source: "catalog_offers",
        label: "Ofertas de catálogo no Mercado Livre",
        product: chosen.product,
        variants_checked: usable.length,
        conditions: [...new Set(chosen.offers.map(item => item.condition).filter(Boolean))],
        prices: pool.length >= 1 ? pool : chosen.prices,
        offers: chosen.offers.slice(0, 10)
    };
}

/**
 * Percorre produtos de catálogo até achar ofertas com preço. O Mercado Livre
 * responde "No winners found" (404) em muitos produtos, então precisamos de
 * mais de uma tentativa para não desistir cedo.
 */
async function fetchCatalogOffers(products) {
    let token = null;

    try {
        token = await apiService.getAccessToken();
    } catch (_) {
        return [];
    }

    const headers = {
        Authorization: `Bearer ${token}`,
        "User-Agent": "TratoCore/1.0"
    };

    const found = [];

    for (const product of products) {
        try {
            const response = await httpClient().get(
                `https://api.mercadolibre.com/products/${encodeURIComponent(product.id)}/items`,
                { params: { limit: 50 }, timeout: SEARCH_TIMEOUT_MS, headers }
            );

            const results = Array.isArray(response.data?.results) ? response.data.results : [];

            if (!results.length) continue;

            found.push({
                product: { id: String(product.id), name: String(product.name || "").slice(0, 140) },
                prices: results
                    .map(offer => Number(offer.price))
                    .filter(price => Number.isFinite(price) && price > 0),
                offers: results.map(offer => ({
                    id: offer.item_id,
                    price: roundMoney(offer.price),
                    condition: normalizeCondition(offer.condition),
                    seller_id: offer.seller_id || null
                }))
            });
        } catch (_) {
            // 404 "No winners found": produto sem oferta visível; segue para o próximo.
            continue;
        }
    }

    return found;
}

// ----------------------------------------------------------------------
// FONTE 2 — anúncios ativos do próprio vendedor
// ----------------------------------------------------------------------

async function sellerSampleReference(categoryId) {
    if (!categoryId) return null;

    const http = httpClient();

    let token = null;
    try {
        token = await apiService.getAccessToken();
    } catch (_) {
        return null;
    }

    try {
        const me = await http.get("https://api.mercadolibre.com/users/me", {
            timeout: SEARCH_TIMEOUT_MS,
            headers: { Authorization: `Bearer ${token}` }
        });

        const userId = me.data?.id;
        if (!userId) return null;

        const search = await http.get(
            `https://api.mercadolibre.com/users/${encodeURIComponent(userId)}/items/search`,
            {
                params: { status: "active", limit: MAX_OWN_ITEMS_SAMPLE },
                timeout: SEARCH_TIMEOUT_MS,
                headers: { Authorization: `Bearer ${token}` }
            }
        );

        const ids = (search.data?.results || []).slice(0, 20);
        if (!ids.length) return null;

        const bulk = await http.get(`https://api.mercadolibre.com/items/${ids.join(",")}`, {
            timeout: SEARCH_TIMEOUT_MS,
            headers: { Authorization: `Bearer ${token}` }
        });

        const items = (Array.isArray(bulk.data) ? bulk.data : [])
            .map(entry => entry?.body)
            .filter(item => item && item.status === "active" && item.category_id === categoryId);

        const prices = items
            .map(item => Number(item.price))
            .filter(price => Number.isFinite(price) && price > 0);

        if (prices.length < 3) return null;

        return {
            source: "seller_category_sample",
            label: "Preços médios da mesma categoria na sua loja",
            conditions: [...new Set(items.map(item => normalizeCondition(item.condition)).filter(Boolean))],
            prices,
            offers: items.slice(0, 10).map(item => ({
                id: item.id,
                price: roundMoney(item.price),
                condition: normalizeCondition(item.condition)
            }))
        };
    } catch (_) {
        return null;
    }
}

// ----------------------------------------------------------------------

function summarize(prices) {
    // Duas referências já permitem mediana e faixa úteis; com uma só não há
    // dispersão e a "média" seria apenas o preço de um concorrente.
    if (!prices || prices.length < 2) return null;

    return {
        count: prices.length,
        min: roundMoney(Math.min(...prices)),
        max: roundMoney(Math.max(...prices)),
        median: roundMoney(median(prices)),
        p25: roundMoney(percentile(prices, 0.25)),
        p75: roundMoney(percentile(prices, 0.75))
    };
}

/**
 * @param {object} params
 * @param {object} params.identification  marca, modelo, versao, capacidade, cor, titulo
 * @param {string} params.condition       "new" | "used" | ""
 * @param {string} [params.query]         termo explícito de busca
 * @param {string} [params.categoryId]    categoria ML para a amostra da loja
 */
async function reference({ identification = {}, condition = "", query = "", categoryId = "" } = {}) {
    const term = buildSearchTerm(identification, query);
    const wantsCondition = normalizeCondition(condition);

    const result = {
        query: term,
        compared_condition: wantsCondition || "any",
        confidence: "none",
        is_estimate: false,
        suggested: null,
        suggested_min: null,
        suggested_max: null,
        comparison: null,
        references: [],
        sources: [],
        explanation: [],
        warning: null
    };

    // A condição do vendedor também guia a escolha das ofertas do catálogo.
    identification = { ...identification, condition: wantsCondition || identification.condition || "" };

    if (!term || term.length < 3) {
        return {
            ...result,
            warning: "Sem termo de busca suficiente para consultar preços (informe marca e modelo ou um termo de pesquisa)."
        };
    }

    // 1. Concorrentes de catálogo
    const catalog = await catalogReference({ ...identification, title: identification.title || term });

    if (catalog) {
        result.sources.push({ type: catalog.source, label: catalog.label, product: catalog.product });
        result.references = catalog.offers;

        const summary = summarize(catalog.prices);

        if (!summary) {
            // Uma única oferta pública: ainda é referência real, mas sem faixa.
            const only = roundMoney(catalog.prices[0]);
            result.is_estimate = true;
            result.confidence = "low";
            result.suggested = wantsCondition === "used" ? roundMoney(only * USED_RATIO) : only;
            result.suggested_min = null;
            result.suggested_max = null;
            result.explanation.push(
                `Encontrei apenas 1 oferta pública deste produto no Mercado Livre (R$ ${only.toFixed(2)}).`
            );
            result.explanation.push(
                wantsCondition === "used"
                    ? `Estimativa para usado: ${Math.round((1 - USED_RATIO) * 100)}% de desconto sobre esse valor. É uma ESTIMATIVA.`
                    : "Use como referência inicial e ajuste conforme conservação e acessórios."
            );
            return result;
        }
        const sameState = catalog.conditions.length === 1
            ? catalog.conditions[0] === wantsCondition
            : null;

        result.comparison = { ...summary, condition: sameState ? wantsCondition : "mixed" };
        result.confidence = catalog.prices.length >= 8 ? "high" : "medium";

        if (sameState) {
            result.suggested = summary.median;
            result.suggested_min = summary.p25;
            result.suggested_max = summary.p75;
            result.explanation.push(
                `Mediana de ${summary.count} anúncio(s) de catálogo no mesmo estado ` +
                `(${wantsCondition === "new" ? "novo" : "usado"}): R$ ${summary.median.toFixed(2)}.`
            );
        } else if (wantsCondition === "used") {
            // A oferta é de produto novo; o usado sai com desconto comercial.
            const estimate = Math.round(summary.median * USED_RATIO * 100) / 100;
            result.is_estimate = true;
            result.confidence = "low";
            result.suggested = estimate;
            result.suggested_min = roundMoney(summary.p25 * USED_RATIO);
            result.suggested_max = roundMoney(summary.p75 * USED_RATIO);
            result.explanation.push(
                `Referência de catálogo em produto novo: mediana R$ ${summary.median.toFixed(2)} ` +
                `(${summary.count} anúncio(s)).`
            );
            result.explanation.push(
                `Não há ofertas de usados nesse catálogo. Estimativa de usado: ${Math.round((1 - USED_RATIO) * 100)}% de desconto ` +
                `sobre a mediana de novo = R$ ${estimate.toFixed(2)}. É uma ESTIMATIVA — ajuste conforme conservação e acessórios.`
            );
        } else {
            result.suggested = summary.median;
            result.suggested_min = summary.p25;
            result.suggested_max = summary.p75;
            result.explanation.push(
                `Mediana de ${summary.count} anúncio(s) de catálogo: R$ ${summary.median.toFixed(2)}.`
            );
        }

        return result;
    }

    // 2. Amostra da própria loja na categoria
    const sample = await sellerSampleReference(categoryId);

    if (sample) {
        const summary = summarize(sample.prices);

        result.sources.push({ type: sample.source, label: sample.label });
        result.references = sample.offers;

        if (!summary) {
            return {
                ...result,
                warning: "Há anúncios na sua loja nesta categoria, mas sem amostra suficiente para referência."
            };
        }

        result.comparison = { ...summary, condition: "mixed" };
        result.confidence = "low";
        result.is_estimate = true;
        result.suggested = summary.median;
        result.suggested_min = summary.p25;
        result.suggested_max = summary.p75;

        result.explanation.push(
            `Não foi possível localizar o catálogo exato do produto. ` +
            `Usada a mediana de ${summary.count} anúncio(s) ativos da sua loja na mesma categoria: ` +
            `R$ ${summary.median.toFixed(2)}.`
        );
        result.explanation.push("Esta é uma ESTIMATIVA por categoria — confira anúncios semelhantes antes de publicar.");

        return result;
    }

    return {
        ...result,
        warning: "Não há referência disponível para este produto. Defina o preço manualmente com base em pesquisa no Mercado Livre."
    };
}

module.exports = {
    reference,
    buildSearchTerm,
    summarize,
    median,
    roundMoney,
    productMatches,
    isAccessoryProduct,
    setHttpClient,
    USED_RATIO
};
