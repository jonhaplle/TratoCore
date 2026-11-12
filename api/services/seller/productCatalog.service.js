// ======================================================
// TRATOCORE — CATÁLOGO ESTATÍSTICO CURADO
// ======================================================
//
// Padrões comuns de modelos conhecidos. Servem SOMENTE como sugestão de
// hipótese na revisão: nunca são gravados como fato e nunca são publicados
// sem confirmação do vendedor.
//
// Regras:
// - cada entrada declara o que é padrão da linha (`_reason`);
// - campos vazios não são sugeridos;
// - a busca é conservadora: exige marca E modelo quando a entrada exige.

const CATALOG = [
    {
        label: "Samsung Galaxy A15",
        match: {
            brand: ["samsung", "sm-a155"],
            model: ["galaxy a15", "galaxy-a15", "a15"]
        },
        values: {
            brand: "Samsung",
            line: "Galaxy",
            model: "Galaxy A15",
            capacity: "128GB",
            color: "Preto",
            is_dual_sim: true,
            manufacturer: "Samsung",
            product_type: "Celular"
        },
        reference_price: { min: 700, max: 950, currency: "BRL", used: true },
        _reason: "O Galaxy A15 4G é vendido com 128GB e Dual SIM na maior parte dos anúncios; confirme no aparelho e na caixa."
    },
    {
        label: "Samsung Galaxy A05",
        match: {
            brand: ["samsung"],
            model: ["galaxy a05", "galaxy-a05", "a05"]
        },
        values: {
            brand: "Samsung",
            line: "Galaxy",
            model: "Galaxy A05",
            capacity: "64GB",
            is_dual_sim: true,
            manufacturer: "Samsung",
            product_type: "Celular"
        },
        reference_price: { min: 450, max: 650, currency: "BRL", used: true },
        _reason: "O Galaxy A05 é mais comum na versão de 64GB; confirme a memória do aparelho."
    },
    {
        label: "Samsung Galaxy A14",
        match: {
            brand: ["samsung"],
            model: ["galaxy a14", "galaxy-a14", "a14"]
        },
        values: {
            brand: "Samsung",
            line: "Galaxy",
            model: "Galaxy A14",
            capacity: "128GB",
            is_dual_sim: true,
            manufacturer: "Samsung",
            product_type: "Celular"
        },
        reference_price: { min: 650, max: 850, currency: "BRL", used: true },
        _reason: "O Galaxy A14 é mais comum na versão de 128GB; confirme a memória do aparelho."
    },
    {
        label: "Samsung Galaxy S21",
        match: {
            brand: ["samsung"],
            model: ["galaxy s21", "galaxy-s21", "s21"]
        },
        values: {
            brand: "Samsung",
            line: "Galaxy",
            model: "Galaxy S21",
            capacity: "128GB",
            is_dual_sim: true,
            manufacturer: "Samsung",
            product_type: "Celular"
        },
        reference_price: { min: 1100, max: 1800, currency: "BRL", used: true },
        _reason: "O Galaxy S21 foi lançado em versões de 128GB e 256GB; confirme no aparelho."
    },
    {
        label: "Xiaomi Redmi Note 12",
        match: {
            brand: ["xiaomi", "redmi"],
            model: ["redmi note 12", "note 12"]
        },
        values: {
            brand: "Xiaomi",
            line: "Redmi",
            model: "Redmi Note 12",
            capacity: "128GB",
            is_dual_sim: true,
            manufacturer: "Xiaomi",
            product_type: "Celular"
        },
        reference_price: { min: 600, max: 850, currency: "BRL", used: true },
        _reason: "O Redmi Note 12 é mais comum com 128GB; confirme a memória do aparelho."
    },
    {
        label: "Motorola Moto G54",
        match: {
            brand: ["motorola", "moto"],
            model: ["moto g54", "g54"]
        },
        values: {
            brand: "Motorola",
            line: "Moto",
            model: "Moto G54",
            capacity: "128GB",
            is_dual_sim: true,
            manufacturer: "Motorola",
            product_type: "Celular"
        },
        reference_price: { min: 700, max: 950, currency: "BRL", used: true },
        _reason: "O Moto G54 é mais comum com 128GB; confirme a memória do aparelho."
    },
    {
        label: "Apple iPhone 11",
        match: {
            brand: ["apple", "iphone"],
            model: ["iphone 11"]
        },
        values: {
            brand: "Apple",
            line: "iPhone",
            model: "iPhone 11",
            capacity: "64GB",
            manufacturer: "Apple",
            product_type: "Celular"
        },
        reference_price: { min: 1200, max: 1800, currency: "BRL", used: true },
        _reason: "O iPhone 11 existe em 64GB e 128GB; confirme a capacidade nas configurações."
    },
    {
        label: "Apple iPhone 13",
        match: {
            brand: ["apple", "iphone"],
            model: ["iphone 13"]
        },
        values: {
            brand: "Apple",
            line: "iPhone",
            model: "iPhone 13",
            capacity: "128GB",
            is_dual_sim: true,
            manufacturer: "Apple",
            product_type: "Celular"
        },
        reference_price: { min: 2400, max: 3300, currency: "BRL", used: true },
        _reason: "O iPhone 13 é mais comum com 128GB; confirme a capacidade nas configurações."
    }
];

function normalize(value) {
    return String(value ?? "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim();
}

// Produto e ACESSÓRIO do produto compartilham marca e modelo ("Capa para
// iPhone 11"). Sem esse filtro, o preço de uma capa seria usado como
// referência do celular.
const ACCESSORY_WORDS = [
    "capa", "capinha", "pelicula", "case", "estojo", "bolsa", "suporte",
    "tela", "display", "bateria", "carregador", "cabo", "fonte", "adaptador",
    "controle", "carcaca", "conector", "flex", "placa", "peca", "pecas",
    "reparo", "reposicao", "compativel", "para iphone", "para galaxy",
    "protetor", "kit", "adesivo", "modulo", "camera traseira"
];

/** O nome descreve um acessório/peça em vez do aparelho? */
function isAccessoryName(name) {
    const text = normalize(name);
    return ACCESSORY_WORDS.some(word => text.includes(normalize(word)));
}

function matchesAny(haystack, needles) {
    return needles.some(needle => {
        const value = normalize(needle);
        if (!value) return false;
        if (value.length <= 3 && !/\d/.test(value)) {
            // Termos muito curtos (a15, s21, g54) precisam ser palavra inteira.
            return new RegExp(`(?:^|[^a-z0-9])${value}(?:$|[^a-z0-9])`).test(haystack);
        }
        return haystack.includes(value);
    });
}

/**
 * Nomes de marca que aparecem dentro do próprio nome do modelo.
 * Em iPhone, a marca faz parte do nome comercial.
 */
const NAME_EMBEDS_BRAND = {
    apple: ["iphone"]
};

// Mesma regra comercial usada pelo serviço de preço.
const USED_RATIO = 0.7;

/**
 * Nome comercial completo que começa com a marca já identifica o produto
 * ("Samsung Galaxy A15" dispensa o campo Marca).
 */
function matchBrandPrefix(entry, modelText) {
    const tokens = (entry?.match?.brand || []).filter(token => token.length > 3);

    return tokens.some(token => modelText.split(/\s+/)[0] === token);
}

/**
 * @param {object} identification  marca, linha, modelo e tipo do produto
 * @returns {object|null}          valores padrão (hipótese) da linha
 */
function getCatalogEntry(identification = {}) {
    const brand = normalize(identification.brand);
    const model = normalize(identification.model);
    const line = normalize(identification.line);
    const combined = `${brand} ${line} ${model} ${normalize(identification.product_type)}`.trim();
    const modelText = `${model} ${line}`.trim();

    if (!combined) return null;

    for (const entry of CATALOG) {
        const brandTokens = entry.match.brand || [];
        const primaryToken = brandTokens[0] || "";
        const embedded = NAME_EMBEDS_BRAND[primaryToken] || [];

        const brandOk = brand
            ? matchesAny(brand, brandTokens)
            : matchesAny(modelText, embedded) ||
              matchBrandPrefix(entry, modelText);

        const modelOk = !entry.match.model?.length || matchesAny(`${modelText} ${combined}`, entry.match.model);

        if (brandOk && modelOk) {
            return {
                ...entry.values,
                reference_price: entry.reference_price ? { ...entry.reference_price } : null,
                _reason: entry._reason,
                _label: entry.label
            };
        }
    }

    return null;
}

/**
 * Faixa de referência do modelo.
 *
 * `reference_price` no catálogo continua sendo a faixa do USADO. Quando a
 * data catalog_reference.json traz a faixa observada de produto NOVO, a
 * faixa de usado é recalculada como 70% do novo (a mesma regra comercial
 * usada quando não há anúncios de usados no catálogo).
 */
function priceRangeFor(entry) {
    // `entry` pode ser o resultado de getCatalogEntry (sem o label original):
    // usamos o label salvo em _label.
    const label = entry._label || entry.label;
    const observed = observedReference(label);

    if (observed && observed.new_min > 0) {
        const min = Math.round(observed.new_min * USED_RATIO * 100) / 100;
        const max = Math.round(observed.new_max * USED_RATIO * 100) / 100;

        return {
            min,
            max,
            currency: "BRL",
            used: true,
            is_estimate: true,
            observed_new: { min: observed.new_min, max: observed.new_max },
            observed_offers: observed.observed_offers,
            observed_at: observed.observed_at,
            source: observed.source
        };
    }

    if (entry.reference_price) {
        return {
            ...entry.reference_price,
            is_estimate: false,
            source: "Faixa de usados curada para este modelo"
        };
    }

    return null;
}

let referenceCache = null;

function loadReferenceFile() {
    if (referenceCache) return referenceCache;

    try {
        const fs = require("node:fs");
        const path = require("node:path");
        const file = path.join(__dirname, "catalog_reference.json");
        const raw = fs.readFileSync(file, "utf8");
        const parsed = JSON.parse(raw);

        referenceCache = Array.isArray(parsed?.models) ? parsed : { models: [] };
        referenceCache.updated_at = parsed?.updated_at || "";
        referenceCache.source = parsed?.source || "";
        referenceCache.note = parsed?.note || "";
    } catch (_) {
        referenceCache = { models: [], updated_at: "", source: "", note: "" };
    }

    return referenceCache;
}

function observedReference(label) {
    const file = loadReferenceFile();
    const entry = (file.models || []).find(item => normalize(item.label) === normalize(label));

    if (!entry) return null;

    return {
        ...entry,
        observed_at: file.updated_at,
        source: file.source
    };
}

/** Faixa de preço praticada no mercado de usados para o modelo. */
function getReferencePrice(identification = {}) {
    const entry = getCatalogEntry(identification);
    if (!entry) return null;

    const range = priceRangeFor(entry);
    if (!range) return null;

    return {
        ...range,
        label: entry._label
    };
}

module.exports = {
    getCatalogEntry,
    getReferencePrice,
    isAccessoryName,
    loadReferenceFile,
    CATALOG
};
