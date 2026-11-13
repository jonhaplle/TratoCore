// ======================================================
// TRATOCORE — TÍTULO E DESCRIÇÃO DO ANÚNCIO
// ======================================================
//
// Regras que este módulo garante:
// - o título não passa do limite oficial da categoria (60 por padrão);
// - não repete a mesma palavra ("Samsung Galaxy A15 Samsung" nunca acontece);
// - não usa hashtags como substituto de informação;
// - a descrição só afirma o que foi declarado ou identificado com evidência.

const DEFAULT_MAX_TITLE = 60;
const MAX_DESCRIPTION = 4000;

function clean(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalize(value) {
    return clean(value)
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();
}

function conditionLabel(condition) {
    return normalize(condition) === "new" ? "Novo" : "Usado";
}

/**
 * Monta o título comercial sem inventar nada. A ordem é a que o comprador
 * procura: marca, modelo, variante e estado.
 *
 * @param {object} params.identification  brand, line, model, version, capacity, color
 * @param {string} params.condition       "new" | "used"
 * @param {number} params.maxLength       limite oficial (padrão 60)
 * @param {string} params.fallback        termo mínimo quando não há identificação
 */
function buildTitle({ identification = {}, condition = "used", maxLength = DEFAULT_MAX_TITLE, fallback = "" } = {}) {
    const limit = Math.max(10, Number(maxLength) || DEFAULT_MAX_TITLE);

    const ordered = [
        identification.brand,
        identification.line,
        identification.model,
        identification.version,
        identification.capacity,
        identification.color
    ]
        .map(clean)
        .filter(Boolean);

    const parts = [];
    const seen = new Set();

    const pushPart = value => {
        const words = clean(value).split(" ").filter(Boolean);
        const kept = [];

        for (const word of words) {
            const key = normalize(word);
            if (!key || seen.has(key)) continue;
            if (key.length <= 1 && !/\d/.test(key)) continue;
            seen.add(key);
            kept.push(word);
        }

        if (kept.length) parts.push(kept.join(" "));
    };

    for (const value of ordered) pushPart(value);

    const state = conditionLabel(condition);
    const joined = parts.join(" ");
    let title = joined;

    // O estado entra quando couber no limite oficial. Se não couber, sai a
    // cor antes de cortar letras no meio de uma palavra.
    if (`${joined} ${state}`.length <= limit) {
        title = `${joined} ${state}`;
    }

    if (title.length > limit) {
        title = title.slice(0, limit).trim();
    }

    if (title.length < 8) {
        title = clean(fallback) || clean(`${parts.join(" ")} ${state}`);
    }

    if (title.length < 8) {
        title = `${state} sem descrição do modelo`;
    }

    return title.slice(0, limit).trim();
}

function bullet(line) {
    return `• ${clean(line)}`;
}

/**
 * Descrição informativa e orientada à conversão. Cada seção só aparece
 * quando há informação real que a sustente.
 */
function buildDescription({
    identification = {},
    condition = "",
    working = null,
    accessories = [],
    defects = [],
    features = []
} = {}) {
    const lines = [];
    const brand = clean(identification.brand);
    const model = clean(identification.model);
    const name = clean(
        [brand, identification.line, model, identification.version, identification.capacity]
            .map(clean)
            .filter(Boolean)
            .join(" ")
    );

    // Sem marca/modelo não inventamos um "produto": a descrição começa pela
    // condição real e pelas características evidenciadas.
    if (name) {
        lines.push(`**${name}**`);
        lines.push("");
    }

    const summary = [];
    if (condition) summary.push(`Estado: ${conditionLabel(condition).toLowerCase()}`);
    if (identification.color) summary.push(`Cor: ${clean(identification.color)}`);
    if (identification.capacity) summary.push(`Capacidade: ${clean(identification.capacity)}`);
    if (working === true) summary.push("Funcionamento declarado pelo vendedor");
    if (working === false) summary.push("Vendido como está: o vendedor declarou que não está funcionando ou não foi testado");

    if (summary.length) {
        lines.push(...summary.map(bullet));
        lines.push("");
    }

    const realFeatures = (Array.isArray(features) ? features : [])
        .map(clean)
        .filter(Boolean)
        .filter(item => !/^(foto|análise|ia|imagem)\b/i.test(item));

    if (realFeatures.length) {
        lines.push("**Características identificadas**");
        lines.push(...realFeatures.slice(0, 10).map(bullet));
        lines.push("");
    }

    if (Array.isArray(accessories) && accessories.length) {
        lines.push("**Acompanha**");
        lines.push(...accessories.map(item => bullet(clean(item))));
        lines.push("");
    }

    if (Array.isArray(defects) && defects.length) {
        lines.push("**Pontos de atenção (descritos com transparência)**");
        lines.push(...defects.map(item => bullet(clean(item))));
        lines.push("");
    }

    lines.push("**Compra segura**");
    lines.push(bullet("Despacho imediato após a confirmação do pagamento."));
    lines.push(bullet("Embalagem reforçada para o produto chegar como anunciado."));
    lines.push(bullet("Dúvidas: envie uma pergunta antes de comprar."));
    lines.push("");

    lines.push("As fotos são do produto anunciado. O que não está descrito ou fotografado não acompanha o produto.");

    return lines.join("\n").slice(0, MAX_DESCRIPTION);
}

/**
 * Confere o que já existe e corrige apenas o que viola regra do Mercado
 * Livre: tamanho, repetição e hashtags.
 */
function reviewTitle(title, { maxLength = DEFAULT_MAX_TITLE, identification = {}, condition = "used" } = {}) {
    const original = clean(title);
    const withoutHashtags = original.replace(/#\S+/g, "").replace(/\s+/g, " ").trim();
    const issues = [];

    if (withHashtags(original)) issues.push("Removidas hashtags do título.");
    if (normalize(withoutHashtags) !== normalize(original) && !withHashtags(original)) {
        issues.push("Espaços normalizados.");
    }

    const limit = Math.max(10, Number(maxLength) || DEFAULT_MAX_TITLE);
    let normalized = withoutHashtags;

    if (normalized.length > limit) {
        issues.push(`Título acima de ${limit} caracteres cortado.`);
        normalized = normalized.slice(0, limit).trim();
    }

    const words = normalized.split(" ").map(normalize).filter(Boolean);
    const duplicated = words.length !== new Set(words).size;

    if (duplicated) {
        issues.push("Palavras repetidas removidas.");
        const seen = new Set();
        normalized = normalized
            .split(" ")
            .filter(word => {
                const key = normalize(word);
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            })
            .join(" ");
    }

    if (normalized.length < 8) {
        normalized = buildTitle({ identification, condition, maxLength: limit });
        issues.push("Título muito curto refeito a partir da identificação.");
    }

    return {
        title: normalized,
        changed: normalized !== original,
        issues
    };
}

function withHashtags(value) {
    return /#\S/.test(String(value || ""));
}

// ======================================================
// APOIO SEM IA: melhoria determinística da descrição
// ======================================================

const SELLER_VOICE = /\b(segundo o vendedor|o vendedor (?:informa|declara|diz|relata)|conforme o vendedor)\b/gi;

/**
 * Usada quando nenhuma IA está disponível (chave recusada ou modelo local
 * fora do ar). NÃO cria fatos novos: apenas organiza o texto do vendedor,
 * remove o que não deve aparecer no anúncio (menções a IA/vendedor,
 * hashtags) e aplica a estrutura comercial do TratoCore.
 */
function improveWithoutAI({
    title = "",
    description = "",
    sellerObservation = "",
    identification = {},
    condition = "",
    working = null,
    accessories = [],
    defects = [],
    features = []
} = {}) {
    const existing = clean(description)
        .replace(SELLER_VOICE, "")
        .replace(/#\S+/g, "")
        .replace(/\b(?:ia|intelig[êe]ncia artificial|an[áa]lise visual)\b/gi, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim();

    const base = buildDescription({
        identification: {
            ...identification,
            brand: identification.brand || "",
            model: identification.model || ""
        },
        condition,
        working,
        accessories,
        defects,
        features
    });

    // O texto do vendedor entra como bloco extra, sem ser reescrito.
    const extra = existing && !base.includes(existing)
        ? `\n\n${existing.slice(0, 1500)}`
        : "";

    const observation = clean(sellerObservation);

    return {
        title: clean(title),
        description: `${base}${extra}`.slice(0, MAX_DESCRIPTION),
        suggested_price: 0,
        improved: true,
        provider: "regras_locais",
        observation_used: Boolean(observation)
    };
}

module.exports = {
    buildTitle,
    buildDescription,
    reviewTitle,
    improveWithoutAI,
    withHashtags,
    conditionLabel,
    DEFAULT_MAX_TITLE
};
