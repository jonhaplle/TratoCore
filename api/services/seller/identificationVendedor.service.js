// ======================================================
// TRATOCORE — IDENTIFICAÇÃO DO PRODUTO PARA O VENDEDOR
// ======================================================
//
// Recebe todas as fotos do TratoCap + a observação curta do vendedor e
// devolve uma identificação com evidência: marca, modelo, linha, versão,
// estado e características visíveis.
//
// Regra de ouro: o que não tem evidência aparece como HIPÓTESE, nunca como
// fato. Estado de conservação só existe quando o vendedor declara; a IA nunca
// escolhe "usado" ou "novo" sozinha.

const fs = require("fs");
const path = require("path");
const { analisarImagem } = require("../local-ai.service");
const localVision = require("../localVision.service");
const geminiHealth = require("../geminiHealth.service");

// A visão identifica produto e características. Funcionamento, acessórios e
// estado são declarações do vendedor e não podem ser deduzidas do enquadramento.
const LIMITS = {
    maxImages: 6,
    maxFileBytes: 8 * 1024 * 1024,
    maxObservation: 1200
};

/** Estados aceitos pelo Mercado Livre (ITEM_CONDITION). */
const CONDITION_VALUES = {
    new: { id: "2230284", label: "Novo" },
    used: { id: "2230581", label: "Usado" }
};

function clean(value) {
    return String(value ?? "").trim();
}

function normalize(value) {
    return clean(value)
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();
}

function splitList(value) {
    if (Array.isArray(value)) {
        return value.map(clean).filter(Boolean);
    }
    const text = clean(value);
    if (!text) return [];
    return text.split(/\s*(?:,|;|\r?\n|•)\s*/).map(clean).filter(Boolean);
}

/**
 * Extrai do texto do vendedor as declarações explícitas que a IA é PROIBIDA
 * de inventar: estado, funcionamento, acessórios e defeitos.
 */
function parseSellerDeclarations(observation = "") {
    const text = clean(observation).slice(0, LIMITS.maxObservation);
    if (!text) {
        return {
            text: "",
            condition: "",
            condition_evidence: "",
            working: null,
            incomplete: false,
            accessories: [],
            defects: []
        };
    }

    const normalized = normalize(text);

    let condition = "";

    // "lacrado" e "nunca usado" são declarações de produto novo. Elas são
    // checadas antes de "usado" para que "nunca usado" não seja lido como
    // "usado", e "sem uso" fica restrito a expressões completas (mais a
    // frente) porque "sem uso nos últimos meses" é um produto usado.
    if (/\b(novo|novo em folha|lacrado|selado|novinho)\b/.test(normalized)) {
        condition = "new";
    }

    // Declarações de estado negativo são removidas antes da checagem de
    // "usado", de modo que "nunca usado" não vire "usado".
    const withoutNegatedUse = normalized
        .replace(/\bnunca (?:foi )?usad[oa]\b/g, " ")
        .replace(/\bsem uso\b/g, " ");

    if (/\b(usado|usada|semi ?novo|com uso|pouco uso)\b/.test(withoutNegatedUse)) {
        // Se houver as duas coisas, prevalece a declaração mais conservadora.
        condition = "used";
    }
    if (!condition && /\b(sucata|para pecas|para peças|defeito|quebrado|nao liga|não liga|nao funciona|não funciona|para retirada de pecas)\b/.test(normalized)) {
        condition = "used";
    }

    const working = /\b(funciona|funcionando|testado|ligando|liga|em funcionamento|operacional)\b/.test(normalized)
        ? true
        : /\b(nao funciona|nao liga|nao testado|sem testar|para pecas|com defeito)\b/.test(normalized)
            ? false
            : null;

    const incomplete = /\b(falta|faltando|incompleto|sem acessorio|sem fonte|sem cabo|sem controle|sem carregador)\b/.test(normalized);

    const accessories = [];
    const accessoryRules = [
        { label: "Carregador", re: /\b(?:carregador|charger)\b/ },
        { label: "Cabo", re: /\bcabo (?:usb|original|incluso|de dados|tipo)\b|\bcom (?:o )?cabo\b/ },
        { label: "Fonte", re: /\bfonte (?:original|inclusa|de alimentacao|de alimentação)\b|\bcom (?:a )?fonte\b/ },
        { label: "Controle", re: /\bcontrole (?:original|incluso|sem fio)\b|\bcom (?:o )?controle\b/ },
        { label: "Caixa", re: /\bcaixa (?:original|inclusa)\b|\bcom (?:a )?caixa\b|\bcom (?:a )?embalagem\b/ },
        { label: "Película", re: /\bpelicula\b/ },
        { label: "Capinha", re: /\bcapinha\b|\bcapa protetora\b/ }
    ];

    const negativeAccessory = /\bsem\b|\bnao (?:vem|acompanha|possui|tem)\b|\bnao inclui\b|\bfalta\b|\bfaltando\b/;

    for (const rule of accessoryRules) {
        const match = normalized.match(rule.re);
        if (!match) continue;

        // "sem carregador" não é um acessório acompanhando o produto.
        const prefix = normalized.slice(Math.max(0, match.index - 24), match.index);
        if (negativeAccessory.test(prefix)) continue;

        accessories.push(rule.label);
    }

    const defects = [];
    const defectRules = [
        { label: "Tela trincada", re: /\btela (?:trincada|rachada|quebrada)\b/ },
        { label: "Risco", re: /\briscad[oa]s?\b|\brisco/ },
        { label: "Bateria viciada", re: /\bbateria (?:viciada|fraca|ruim)\b/ },
        { label: "Não liga", re: /\bnao liga\b/ },
        { label: "Não funciona", re: /\bnao funciona\b/ },
        { label: "Marca de uso", re: /\bmarcas? de uso\b/ }
    ];

    for (const rule of defectRules) {
        if (rule.re.test(normalized)) defects.push(rule.label);
    }

    return {
        text,
        condition,
        condition_evidence: condition ? text.slice(0, 200) : "",
        working,
        incomplete,
        accessories: [...new Set(accessories)],
        defects: [...new Set(defects)]
    };
}

function readImageAsBase64(source) {
    if (!source) return null;

    const absolute = path.resolve(String(source));
    const stat = fs.statSync(absolute, { throwIfNoEntry: false });

    if (!stat || !stat.isFile()) return null;
    if (stat.size > LIMITS.maxFileBytes) return null;

    const ext = path.extname(absolute).toLowerCase();
    const mime = ext === ".png"
        ? "image/png"
        : ext === ".webp"
            ? "image/webp"
            : "image/jpeg";

    return {
        absolute,
        mime,
        base64: fs.readFileSync(absolute, "base64"),
        bytes: stat.size
    };
}

function normalizeLocalPath(url) {
    const text = clean(url);
    if (!text) return null;

    // Caminho absoluto do Windows já aponta para o arquivo.
    if (/^[A-Za-z]:[\\/]/.test(text) || text.startsWith("\\\\")) {
        return text;
    }

    if (/^https?:\/\//i.test(text)) {
        const stripped = text.replace(/^https?:\/\/[^/]+/i, "");
        return stripped ? path.join(__dirname, "../../", stripped.replace(/^\/+/, "")) : null;
    }

    return path.join(__dirname, "../../", text.replace(/^\/+/, ""));
}

/**
 * @param {object} params
 * @param {object[]} [params.images]  fotos já salvas: { original_url, drive_file_id, file_name }
 * @param {string}   [params.imageUrl] foto avulsa (fluxo antigo)
 * @param {string}   [params.sellerObservation]
 */
async function identify({ images = [], imageUrl = "", sellerObservation = "" } = {}) {
    const declarations = parseSellerDeclarations(sellerObservation);

    const sources = [];
    for (const image of Array.isArray(images) ? images : []) {
        const candidate = normalizeLocalPath(image?.original_url || image?.path || image?.source);
        if (candidate) sources.push(candidate);
        if (sources.length >= LIMITS.maxImages) break;
    }
    if (!sources.length && imageUrl) {
        const candidate = normalizeLocalPath(imageUrl);
        if (candidate) sources.push(candidate);
    }

    const readable = sources
        .map(readImageAsBase64)
        .filter(Boolean)
        .slice(0, LIMITS.maxImages);

    const warnings = [];

    if (!readable.length) {
        warnings.push(
            "Não recebi as fotos como arquivos do servidor; a identificação usará apenas a observação do vendedor."
        );
    }

    if (sources.length > LIMITS.maxImages) {
        warnings.push(`Apenas as ${LIMITS.maxImages} primeiras fotos foram analisadas.`);
    }

    // A análise visual tenta primeiro o Gemini (nuvem) e, se a chave estiver
    // inválida ou a rede falhar, usa o modelo de visão local (Ollama). Sem
    // nenhum dos dois, devolvemos a identificação declarada pelo vendedor.
    let analysis = null;
    let analysisError = null;
    let aiProvider = null;

    // Chave recusada pelo Google não deve custar uma chamada por análise.
    const geminiUsable = readable.length ? await geminiHealth.isAvailable() : false;

    if (readable.length && geminiUsable) {
        try {
            analysis = await analisarImagem(
                readable[0].absolute,
                null,
                declarations.text
            );
            aiProvider = "gemini";
        } catch (error) {
            analysisError = error.message || "IA em nuvem indisponível.";
        }
    } else if (readable.length && !geminiUsable) {
        analysisError = "chave do Gemini não aceita pelo Google";
    }

    const localEnabled = typeof localVision?.isEnabled === "function"
        ? localVision.isEnabled()
        : true;

    if (!analysis && readable.length && localVision && localEnabled) {
        // Fallback local: mesmo contrato de saída, só sem a nuvem.
        try {
            const local = await localVision.analyzeImage(
                readable[0].absolute,
                declarations.text
            );

            if (local) {
                analysis = toGeminiShape(local);
                aiProvider = `local:${local.model_used}`;
                analysisError = null;
            }
        } catch (localError) {
            analysisError = `${analysisError || ""} | visão local: ${localError.message}`;
        }
    }

    if (!analysis && (readable.length || declarations.text)) {
        warnings.push(`A IA não respondeu (${analysisError || "indisponível"}). Siga com a revisão manual.`);
    } else if (analysis && aiProvider?.startsWith("local:")) {
        warnings.push(
            "A IA em nuvem não respondeu; a identificação foi feita pelo modelo local " +
            "(qualidade menor). Confira marca e modelo."
        );
    }

    const fromAnalysis = analysis ? identificationFromAnalysis(analysis) : emptyIdentification();

    const sellerPowered = sellerOnlyIdentification(declarations);

    const identification = {
        category_guess: fromAnalysis.category_guess || "",
        brand: fromAnalysis.brand || sellerPowered.brand,
        line: fromAnalysis.line || sellerPowered.line,
        model: fromAnalysis.model || sellerPowered.model,
        version: fromAnalysis.version || sellerPowered.version,
        capacity: fromAnalysis.capacity || sellerPowered.capacity,
        color: fromAnalysis.color || sellerPowered.color,
        product_type: fromAnalysis.product_type || sellerPowered.product_type,
        features: mergeFeatures(fromAnalysis.features, sellerPowered.features)
    };

    const evidence = [];

    for (const item of fromAnalysis.evidence) {
        evidence.push({ ...item, source: item.source || "Fotos e IA" });
    }

    if (declarations.text) {
        evidence.push({
            field: "observacao",
            value: declarations.text,
            source: "Observação do vendedor",
            strength: "confirmed"
        });
    }

    const hypotheses = [...fromAnalysis.hypotheses];

    for (const field of ["brand", "model", "version", "capacity", "color"]) {
        const value = clean(identification[field]);
        if (!value) continue;

        // Só dados vindos da análise visual entram como hipótese; valores
        // declarados pelo vendedor já estão em evidence.
        const fromVisual = fromAnalysis[field] && clean(fromAnalysis[field]) === value;
        if (!fromVisual) continue;

        const confirmed = fromAnalysis.evidence.some(item => item.field === field && item.strength === "confirmed");
        if (!confirmed) {
            hypotheses.push({
                field,
                value,
                reason: "Identificado pelas fotos; confirme antes de publicar."
            });
        }
    }

    if (!identification.capacity && fromAnalysis.capacity_hypothesis) {
        hypotheses.push({
            field: "capacity",
            value: fromAnalysis.capacity_hypothesis,
            reason: "Variante comum da mesma linha; não foi possível confirmar nas fotos."
        });
    }

    // ------------------------------------------------------------------
    // Estimativas estatísticas comuns da linha, SEMPRE como hipótese.
    // É isto que permite montar um anúncio de celular sem perguntar tudo:
    // o vendedor confirma ou corrige cada valor antes de publicar.
    // ------------------------------------------------------------------
    const { getCatalogEntry } = require("./productCatalog.service");
    const catalogEntry = getCatalogEntry(identification);
    const missingFields = [];

    for (const [field, value] of Object.entries(catalogEntry || {})) {
        if (field === "label" || field === "product_type" || field.startsWith("_")) continue;
        if (clean(identification[field])) continue;
        // `reference_price` é um objeto com faixa de preço; virar hipótese
        // de atributo só poluía a revisão.
        if (value === null || value === undefined || typeof value === "object") continue;
        if (!clean(value)) continue;

        const alreadyAsked = hypotheses.some(
            item => item.field === field && normalize(item.value) === normalize(value)
        );

        if (!alreadyAsked) {
            hypotheses.push({
                field,
                value: clean(value),
                reason: catalogEntry._reason
                    || "Padrão comum desta linha; confirme se corresponde ao seu produto."
            });
        }

        missingFields.push(field);
    }

    if (catalogEntry?.product_type && !identification.product_type) {
        identification.product_type = catalogEntry.product_type;
    }

    return {
        identification,
        seller: {
            observation: declarations.text,
            condition: declarations.condition,
            condition_label: declarations.condition ? CONDITION_VALUES[declarations.condition].label : "",
            condition_evidence: declarations.condition_evidence,
            working: declarations.working,
            incomplete: declarations.incomplete,
            accessories: declarations.accessories,
            defects: declarations.defects
        },
        evidence,
        hypotheses,
        questions: buildQuestions(identification, declarations, hypotheses),
        confidence: analysis?.confidence
            ? { score: Number(analysis.confidence.score || 0), level: String(analysis.confidence.level || "LOW") }
            : { score: 0, level: "LOW" },
        images: {
            supplied: sources.length,
            analyzed: readable.length
        },
        ai: {
            ok: Boolean(analysis),
            provider: aiProvider,
            error: analysisError
        },
        warnings
    };
}

/**
 * Converte a análise do modelo local para o formato esperado por
 * identificationFromAnalysis (o mesmo do Gemini), mantendo as regras de
 * verdade (sem estado inventado).
 */
function toGeminiShape(local) {
    const identification = local.identification || {};

    return {
        product_type: local.product_type || "",
        brand: local.brand || "",
        line: local.line || "",
        model: local.model || "",
        generation: local.generation || "",
        version: local.version || "",
        color: local.color || "",
        condition: "",
        identification: {
            ...identification,
            condition: ""
        },
        facts: Array.isArray(local.facts) ? local.facts : [],
        hypotheses: Array.isArray(local.hypotheses) ? local.hypotheses : [],
        evidence: [],
        confidence: local.confidence || { score: 0, level: "LOW" },
        provider: local.provider || "local_vision"
    };
}

function emptyIdentification() {
    return {
        category_guess: "",
        brand: "",
        line: "",
        model: "",
        version: "",
        capacity: "",
        color: "",
        product_type: "",
        features: [],
        evidence: [],
        hypotheses: [],
        capacity_hypothesis: ""
    };
}

/** Converte a resposta do motor de IA para o formato do vendedor. */
function identificationFromAnalysis(result = {}) {
    const identification = result.identification || {};
    const output = emptyIdentification();

    output.product_type = clean(result.product_type || identification.product_type);
    output.brand = clean(result.brand || identification.brand);
    output.line = clean(result.line || identification.line);
    output.model = clean(result.model || identification.model);
    output.version = clean(result.version || identification.version);
    output.category_guess = clean(result.category);

    const facts = [
        ...(Array.isArray(result.facts) ? result.facts : []),
        ...splitList(result.visible_characteristics),
        ...splitList(result.caracteristicas_visiveis)
    ]
        .map(item => typeof item === "string" ? item : clean(item?.text || item?.value))
        .filter(Boolean);

    output.features = [...new Set(facts)].slice(0, 12);

    // A cor vem do campo explícito da IA. Adivinhar cor a partir de adjetivos
    // de fatos ("tampa marrom") já gerou cor errada em anúncio, então não é
    // mais feita automaticamente: fica para o vendedor confirmar.
    output.color = clean(identification.color);

    const capacityMatch = `${facts.join(" ")} ${result.title || ""}`.match(/\b(\d{1,4})\s?(GB|TB|ml|mL|L)\b/);
    if (capacityMatch) {
        output.capacity = `${capacityMatch[1]} ${capacityMatch[2].toUpperCase()}`;
    } else {
        output.capacity_hypothesis = "";
    }

    const evidence = [];
    for (const item of Array.isArray(result.evidence) ? result.evidence : []) {
        if (!item) continue;
        evidence.push({
            field: clean(item.field || item.attribute || "produto"),
            value: clean(item.value || item.text),
            source: clean(item.source || "Fotos e IA"),
            strength: clean(item.strength) === "confirmed" ? "confirmed" : "inferred"
        });
    }

    output.evidence = evidence;
    output.hypotheses = (Array.isArray(result.hypotheses) ? result.hypotheses : [])
        .map(item => ({
            field: clean(typeof item === "string" ? "produto" : item.field),
            value: clean(typeof item === "string" ? item : item.value),
            reason: clean(typeof item === "string" ? "" : item.reason)
        }))
        .filter(item => item.value);

    return output;
}

/**
 * Quando não há IA (ou ela não respondeu), só é possível usar o que o
 * vendedor declarou por escrito. Nada aqui é inferido.
 */
function sellerOnlyIdentification(declarations) {
    const output = emptyIdentification();
    const text = declarations.text;
    if (!text) return output;

    const brandMatch = text.match(/\b(?:marca|brand)\s*[:=-]\s*([^,;\n]+)/i);
    if (brandMatch) output.brand = clean(brandMatch[1]);

    const modelMatch = text.match(/\b(?:modelo|model)\s*[:=-]\s*([^,;\n]+)/i);
    if (modelMatch) output.model = clean(modelMatch[1]);

    const capacityMatch = text.match(/\b(\d{1,4})\s?(GB|TB)\b/i);
    if (capacityMatch) output.capacity = `${capacityMatch[1]}${capacityMatch[2].toUpperCase()}`;

    // Registro de marca + modelo já no início da observação
    // ("Samsung Galaxy A15, usado, funciona..."): é declaração do vendedor,
    // portanto entra como identificação confirmada.
    if (!output.brand && !output.model) {
        const knownBrands = /^(Samsung|Apple|iPhone|Xiaomi|Redmi|Poco|Motorola|Moto|LG|Sony|Philips|JBL|Nintendo|Microsoft|Dell|Lenovo|Acer|Asus|Acer|Positivo|Canon|Nikon|Bose|Electrolux|Brastemp|Consul|Arno|Mondial|Britânia|Philco)\b/i;
        const firstClause = clean(text.split(/[,;\n.]/)[0]);
        const brandAndModel = firstClause.match(/^((?:[A-Za-zÀ-ÿ0-9&]+)(?:\s+(?:[A-Za-zÀ-ÿ0-9&]+|A\d+|S\d+|M\d+)){0,2})/);

        if (brandAndModel && knownBrands.test(firstClause)) {
            const words = brandAndModel[1].split(/\s+/).filter(Boolean);
            output.brand = words[0];

            const rest = words.slice(1);
            if (rest.length) {
                output.line = rest.length > 1 ? rest[0] : "";
                output.model = rest.length > 1 ? rest.slice(1).join(" ") : rest[0];
            }
        }
    }

    output.features = [
        ...declarations.accessories.map(item => `Acompanha ${item.toLowerCase()}`),
        ...declarations.defects
    ];

    return output;
}

function mergeFeatures(left, right) {
    return [...new Set([...(left || []), ...(right || [])].map(clean).filter(Boolean))].slice(0, 16);
}

/** Perguntas objetivas que a revisão deve fazer ao vendedor. */
function buildQuestions(identification, declarations, hypotheses) {
    const questions = [];

    if (!declarations.condition) {
        questions.push({
            field: "condition",
            question: "O produto é novo ou usado? Não consigo determinar pelo anúncio.",
            options: [
                { value: "new", label: "Novo" },
                { value: "used", label: "Usado" }
            ]
        });
    }

    if (!identification.capacity && hypotheses.some(item => item.field === "capacity")) {
        questions.push({
            field: "capacity",
            question: "Qual é a capacidade da variante?",
            options: hypotheses
                .filter(item => item.field === "capacity")
                .map(item => ({ value: item.value, label: item.value }))
        });
    }

    if (!identification.brand) {
        questions.push({
            field: "brand",
            question: "Qual é a marca do produto?",
            options: []
        });
    }

    if (declarations.working === null) {
        questions.push({
            field: "working",
            question: "O produto liga e está funcionando?",
            options: [
                { value: true, label: "Sim, funcionando" },
                { value: false, label: "Não / não testado" }
            ]
        });
    }

    return questions;
}

module.exports = {
    identify,
    parseSellerDeclarations,
    identificationFromAnalysis,
    CONDITION_VALUES,
    LIMITS
};
