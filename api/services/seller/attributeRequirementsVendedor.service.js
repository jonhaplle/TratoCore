// ======================================================
// TRATOCORE — REQUISITOS DE ATRIBUTOS PARA A REVISÃO
// ======================================================
//
// Preenche os atributos que o Mercado Livre realmente exige na categoria,
// usando evidência (fotos, observação, identificação) e, quando falta algo
// que é padrão do próprio fabricante, uma HIPÓTESE explícita que o vendedor
// confirma na revisão.
//
// Nada é publicado sem passar pela revisão: este módulo só monta sugestões.

const { commercialHintFor } = require("../ml/attributeResolver.service");
const { getCatalogEntry, getReferencePrice } = require("./productCatalog.service");

// O Mercado Livre passou a exigir as dimensões/peso da embalagem no
// /items/validate, mesmo sem marcar o atributo como required na categoria
// (eles vêm com tags.hidden). Este conjunto garante que eles entram na
// revisão em vez de derrubar a publicação em silêncio.
const PACKAGE_ATTRIBUTES = [
    "SELLER_PACKAGE_HEIGHT",
    "SELLER_PACKAGE_WIDTH",
    "SELLER_PACKAGE_LENGTH",
    "SELLER_PACKAGE_WEIGHT"
];

// Medidas padrão de embalagem de celular (aproximadas). NÃO são enviadas
// automaticamente: entram como sugestão explícita que o vendedor confirma.
const PACKAGE_SUGGESTIONS = {
    SELLER_PACKAGE_HEIGHT: { number: 5, unit: "cm" },
    SELLER_PACKAGE_WIDTH: { number: 15, unit: "cm" },
    SELLER_PACKAGE_LENGTH: { number: 20, unit: "cm" },
    SELLER_PACKAGE_WEIGHT: { number: 400, unit: "g" }
};

const PACKAGE_LABELS = {
    SELLER_PACKAGE_HEIGHT: "Altura da embalagem (cm)",
    SELLER_PACKAGE_WIDTH: "Largura da embalagem (cm)",
    SELLER_PACKAGE_LENGTH: "Comprimento da embalagem (cm)",
    SELLER_PACKAGE_WEIGHT: "Peso da embalagem (g)"
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

/** Atalhos para atributos que a identificação já resolve. */
function identificationValue(id, identification, seller) {
    const map = {
        BRAND: identification.brand,
        MODEL: identification.model,
        LINE: identification.line,
        COLOR: identification.color,
        MANUFACTURER: identification.manufacturer || identification.brand,
        INTERNAL_MEMORY: identification.capacity,
        CAPACITY: identification.capacity,
        ITEM_CONDITION: seller?.condition
    };

    return clean(map[id]);
}

function findAllowedValue(definition, raw) {
    const wanted = normalize(raw);
    if (!wanted) return null;

    const values = Array.isArray(definition.values) ? definition.values : [];

    if (!values.length) {
        return { value_name: clean(raw) };
    }

    const exact = values.find(value => normalize(value.name) === wanted);
    if (exact) return { value_id: String(exact.id) };

    const partial = values.find(value => {
        const candidate = normalize(value.name);
        return candidate.includes(wanted) || wanted.includes(candidate);
    });

    if (partial) return { value_id: String(partial.id) };

    return null;
}

function numberUnitValue(definition, raw) {
    const text = clean(raw);
    const match = text.match(/(\d+(?:[.,]\d+)?)\s*([A-Za-zÇÃÁÉÍÓÚ]{1,6})?/);
    if (!match) return null;

    const allowed = (definition.allowed_units || []).map(unit => clean(unit.id || unit.name).toUpperCase());
    const given = (match[2] || "").toUpperCase();

    // O Mercado Livre espera a unidade exatamente como declarada na
    // categoria ("g" e não "G", "cm" e não "CM").
    const unit = normalizeUnit(given, definition);

    if (!unit) return null;
    if (allowed.length && !allowed.map(item => item.toUpperCase()).includes(unit.toUpperCase())) return null;

    return { value_struct: { number: Number(match[1].replace(",", ".")), unit } };
}

/** Devolve a unidade com a grafia oficial da categoria. */
function normalizeUnit(raw, definition) {
    const text = clean(raw).toUpperCase();
    if (!text) return "";

    const candidates = [
        ...(definition.allowed_units || []).map(unit => clean(unit.id || unit.name)),
        clean(definition.default_unit)
    ].filter(Boolean);

    const match = candidates.find(unit => unit.toUpperCase() === text);
    return match || text.toLowerCase();
}

/**
 * Converte o valor confirmado pelo vendedor no formato aceito pelo ML.
 * Quando o vendedor escolhe uma opção da lista, priorizamos value_id; para
 * number_unit só existe value_struct.
 */
function overrideValue(definition, override) {
    const type = normalize(definition.value_type);

    if (typeof override !== "object" || override === null) {
        // Texto puro (ex.: "Branco"): resolve contra as opções aceitas.
        const values = Array.isArray(definition.values) ? definition.values : [];
        const text = clean(override);

        if (values.length) {
            const exact = values.find(item => normalize(item.name) === normalize(text));
            if (exact) return { value_id: String(exact.id) };
            return { value_name: text };
        }

        if (type === "boolean") {
            return valueFor(definition, text);
        }

        if (type === "number_unit") {
            return numberUnitValue(definition, text);
        }

        if (type === "number") {
            return /^\d{8,15}$/.test(text) ? { value_name: text } : null;
        }

        return { value_name: text };
    }

    if (override.value_struct?.number != null && override.value_struct?.unit) {
        return {
            value_struct: {
                number: Number(override.value_struct.number),
                unit: normalizeUnit(override.value_struct.unit, definition)
            }
        };
    }

    if (type === "number_unit") {
        const parsed = numberUnitValue(definition, override.value_name || override.value_id);
        return parsed || null;
    }

    if (type === "number") {
        const digits = clean(override.value_name || override.value_id);
        return /^\d{8,15}$/.test(digits) ? { value_name: digits } : null;
    }

    if (override.value_id !== undefined && override.value_id !== null && clean(override.value_id)) {
        return { value_id: clean(override.value_id) };
    }

    if (override.value_name !== undefined) {
        // A tela envia o nome exibido. Para listas usamos a opção
        // correspondente; para texto livre mantemos o nome.
        const values = Array.isArray(definition.values) ? definition.values : [];
        if (values.length) {
            const match = values.find(item => normalize(item.name) === normalize(override.value_name));
            if (match) return { value_id: String(match.id) };
        }

        const partial = values.find(item => normalize(item.name).includes(normalize(override.value_name)));
        if (partial) return { value_id: String(partial.id) };

        return { value_name: clean(override.value_name) };
    }

    return null;
}

function valueFor(definition, raw, { booleans = {} } = {}) {
    const text = clean(raw);
    if (!text) return null;

    const type = normalize(definition.value_type);
    const wanted = normalize(text);

    if (type === "number_unit") {
        return numberUnitValue(definition, text);
    }

    if (type === "boolean") {
        const map = {
            sim: true, true: true, "1": true, yes: true,
            nao: false, false: false, "0": false, no: false
        };
        const value = booleans[definition.id] ?? map[wanted];
        if (value === undefined || value === null) return null;

        const values = Array.isArray(definition.values) ? definition.values : [];
        const match = values.find(item => normalize(item.name) === normalize(value === true ? "sim" : "não"));

        return match ? { value_id: String(match.id) } : { value_name: value === true ? "Sim" : "Não" };
    }

    if (type === "number") {
        // Número da Anatel não pode ser inventado: só aceita o que o
        // vendedor digitar (11 dígitos) e o Mercado Livre validar.
        return /^\d{8,15}$/.test(text) ? { value_name: text } : null;
    }

    return findAllowedValue(definition, text);
}

function labelForValue(definition, value) {
    if (value?.value_id) {
        const match = (definition.values || []).find(item => String(item.id) === String(value.value_id));
        return match?.name || String(value.value_id);
    }

    if (value?.value_struct?.number != null) {
        return `${value.value_struct.number} ${value.value_struct.unit}`.trim();
    }

    return clean(value?.value_name);
}

function describe(definition, raw, origin, extra = {}) {
    // Um valor sem value_id nem value_name é descartado silenciosamente
    // pelo Mercado Livre ("attribute was dropped"). Nunca enviamos isso.
    const value = extra.value_struct
        ? { value_struct: extra.value_struct }
        : valueFor(definition, raw, extra);

    if (!value) return null;

    const hasValue =
        (value.value_id !== undefined && value.value_id !== null && clean(value.value_id) !== "") ||
        (value.value_name !== undefined && clean(value.value_name) !== "") ||
        (value.value_struct?.number != null && clean(value.value_struct.unit));

    if (!hasValue) return null;

    // number_unit aceita apenas value_struct; mandar os dois invalida.
    const finalValue = value.value_struct
        ? { value_struct: value.value_struct }
        : value;

    return {
        id: definition.id,
        name: definition.name || definition.id,
        value_name: extra.value_name || clean(raw),
        ...finalValue,
        origin,
        confidence: extra.confidence || "inferred",
        note: extra.note || ""
    };
}

/**
 * @param {object} params
 * @param {object[]} params.definitions  atributos classificados da categoria
 * @param {object}   params.identification
 * @param {object}   params.seller        condition, working, accessories, defects
 * @param {object}   params.overrides     valores já confirmados pelo vendedor
 * @param {object}   params.booleans      respostas booleanas do vendedor
 */
function buildRequirements({
    definitions = [],
    identification = {},
    seller = {},
    overrides = {},
    booleans = {}
} = {}) {
    const defined = new Map(definitions.map(item => [item.id, item]));
    const catalog = getCatalogEntry(identification) || {};

    // Atributos ocultos da categoria só entram quando o Mercado Livre os
    // exige de fato (dimensões/peso da embalagem).
    const hiddenPackages = (definitions || [])
        .filter(item => item.tags?.hidden && PACKAGE_ATTRIBUTES.includes(item.id))
        .map(item => ({ ...item, requirement: item.requirement === "optional" ? "conditional_required" : item.requirement }));

    const withPackages = [
        ...definitions,
        ...hiddenPackages.filter(item => !defined.has(item.id))
    ];

    const required = withPackages.filter(item => item.requirement === "required" || item.requirement === "conditional_required");
    const optional = withPackages.filter(item => item.requirement === "optional");

    const filled = [];
    const pending = [];
    const hypotheses = [];
    const requiredList = [];

    const resolveDefinition = definition => {
        // 1) O vendedor já confirmou o valor na revisão.
        const override = overrides[definition.id];
        if (override !== undefined && override !== null && clean(override) !== "") {
            const converted = overrideValue(definition, override);

            if (converted) {
                const isObject = typeof override === "object";
                const label = isObject
                    ? clean(override.value_name) || labelForValue(definition, converted)
                    : clean(override);

                return {
                    id: definition.id,
                    name: definition.name || definition.id,
                    value_name: label || labelForValue(definition, converted),
                    ...converted,
                    origin: "seller",
                    confidence: "confirmed",
                    note: ""
                };
            }
        }

        // 2) Medidas de embalagem: sugestão explícita, nunca automática.
        if (PACKAGE_ATTRIBUTES.includes(definition.id)) {
            const suggestion = PACKAGE_SUGGESTIONS[definition.id];
            if (!suggestion) return null;

            const described = describe(definition, "", "package_suggestion", {
                confidence: "hypothesis",
                value_name: `${suggestion.number} ${suggestion.unit}`,
                value_struct: suggestion,
                note: `${PACKAGE_LABELS[definition.id]} — medida padrão sugerida. Ajuste se sua embalagem for diferente.`
            });
            if (described) {
                hypotheses.push(described);
                return described;
            }
            return null;
        }

        // 3) Evidência da identificação (fotos + observação).
        const fromIdentification = identificationValue(definition.id, identification, seller);
        if (fromIdentification) {
            const described = describe(definition, fromIdentification, "identification", {
                confidence: seller?.condition && definition.id === "ITEM_CONDITION" ? "confirmed" : "inferred",
                note: `Identificado como "${fromIdentification}".`
            });
            if (described) return described;
        }

        // 4) Estado do produto: nunca inventado.
        if (definition.id === "ITEM_CONDITION") {
            return null;
        }

        // 5) Padrões do fabricante para o modelo (hipótese explícita).
        const catalogValue = catalog[definition.id] ?? catalog[normalize(definition.id).replace(/_/g, "")]
            ?? (definition.id === "IS_DUAL_SIM" ? catalog.is_dual_sim : undefined)
            ?? (definition.id === "MANUFACTURER" ? catalog.manufacturer : undefined);

        if (catalogValue !== undefined && catalogValue !== null && clean(catalogValue) !== "") {
            const described = describe(definition, catalogValue, "catalog_hypothesis", {
                confidence: "hypothesis",
                note: catalog._reason || "Padrão desta linha; confirme se corresponde ao seu produto."
            });
            if (described) {
                hypotheses.push(described);
                return described;
            }
        }

        // 6) Dica comercial aceita pelo ML (ex.: marca "Não especificada").
        if (definition.id === "BRAND" || definition.id === "MANUFACTURER") {
            const hints = commercialHintFor({
                ...definition,
                values: definition.values?.length ? definition.values : []
            });

            if (Array.isArray(hints) && hints.length) {
                const described = {
                    id: definition.id,
                    name: definition.name,
                    value_id: hints[0].value_id,
                    value_name: hints[0].value_name,
                    origin: "commercial_hint",
                    confidence: "hypothesis",
                    note: "Marca não identificada. Se o produto realmente não tem marca, confirme esta opção."
                };
                hypotheses.push(described);
                return described;
            }
        }

        return null;
    };

    for (const definition of required) {
        const value = resolveDefinition(definition);

        if (value) {
            filled.push(value);
            requiredList.push({ id: definition.id, name: definition.name, status: "filled", value: value.value_name });
        } else {
            pending.push({
                id: definition.id,
                name: definition.name,
                value_type: definition.value_type,
                value_max_length: definition.value_max_length,
                allowed_units: definition.allowed_units || [],
                values: definition.values || [],
                requirement: definition.requirement
            });
            requiredList.push({ id: definition.id, name: definition.name, status: "pending" });
        }
    }

    // Opcionais só entram quando há evidência ou padrão do catálogo; nunca
    // são exigidos do vendedor.
    const optionalFilled = [];
    for (const definition of optional) {
        const override = overrides[definition.id];
        const fromIdentification = identificationValue(definition.id, identification, seller);
        const catalogValue = catalog[definition.id];

        const raw = override ?? fromIdentification ?? catalogValue;
        if (raw === undefined || raw === null || clean(raw) === "") continue;

        const origin = override !== undefined ? "seller" : fromIdentification ? "identification" : "catalog_hypothesis";

        // Opcionais vindos só do catálogo não são hipóteses obrigatórias:
        // entram como preenchidos para enriquecer o anúncio.
        const described = describe(definition, raw, origin, {
            confidence: origin === "catalog_hypothesis" ? "hypothesis" : "inferred",
            note: origin === "catalog_hypothesis" ? (catalog._reason || "") : ""
        });

        if (described) optionalFilled.push(described);
    }

    return {
        required: requiredList,
        pending,
        hypotheses,
        attributes: [...filled, ...optionalFilled],
        ready: pending.length === 0
    };
}

module.exports = {
    buildRequirements,
    identificationValue,
    findAllowedValue
};
