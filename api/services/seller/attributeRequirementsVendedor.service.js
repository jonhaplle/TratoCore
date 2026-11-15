// ======================================================
// TRATOCORE â€” REQUISITOS DE ATRIBUTOS PARA A REVISÃƒO
// ======================================================
//
// Preenche os atributos que o Mercado Livre realmente exige na categoria,
// usando evidÃªncia (fotos, observaÃ§Ã£o, identificaÃ§Ã£o) e, quando falta algo
// que Ã© padrÃ£o do prÃ³prio fabricante, uma HIPÃ“TESE explÃ­cita que o vendedor
// confirma na revisÃ£o.
//
// Nada Ã© publicado sem passar pela revisÃ£o: este mÃ³dulo sÃ³ monta sugestÃµes.

const { commercialHintFor } = require("../ml/attributeResolver.service");
const { getCatalogEntry, getReferencePrice } = require("./productCatalog.service");

// O Mercado Livre passou a exigir as dimensÃµes/peso da embalagem no
// /items/validate, mesmo sem marcar o atributo como required na categoria
// (eles vÃªm com tags.hidden). Este conjunto garante que eles entram na
// revisÃ£o em vez de derrubar a publicaÃ§Ã£o em silÃªncio.
const PACKAGE_ATTRIBUTES = [
    "SELLER_PACKAGE_HEIGHT",
    "SELLER_PACKAGE_WIDTH",
    "SELLER_PACKAGE_LENGTH",
    "SELLER_PACKAGE_WEIGHT"
];

function clean(value) {
    return String(value ?? "").trim();
}

function normalize(value) {
    return clean(value)
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();
}

/** Atalhos para atributos que a identificaÃ§Ã£o jÃ¡ resolve. */
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
    const match = text.match(/(\d+(?:[.,]\d+)?)\s*([A-Za-zÃ‡ÃƒÃÃ‰ÃÃ“Ãš]{1,6})?/);
    if (!match) return null;

    const allowed = (definition.allowed_units || []).map(unit => clean(unit.id || unit.name).toUpperCase());
    const given = (match[2] || "").toUpperCase();

    // O Mercado Livre espera a unidade exatamente como declarada na
    // categoria ("g" e nÃ£o "G", "cm" e nÃ£o "CM").
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
 * Quando o vendedor escolhe uma opÃ§Ã£o da lista, priorizamos value_id; para
 * number_unit sÃ³ existe value_struct.
 */
function overrideValue(definition, override) {
    const type = normalize(definition.value_type);

    if (typeof override !== "object" || override === null) {
        // Texto puro (ex.: "Branco"): resolve contra as opÃ§Ãµes aceitas.
        const values = Array.isArray(definition.values) ? definition.values : [];
        const text = clean(override);

        if (values.length) {
            const exact = values.find(item => normalize(item.name) === normalize(text));
            return exact ? { value_id: String(exact.id) } : null;
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
        const valueId = clean(override.value_id);
        const values = Array.isArray(definition.values) ? definition.values : [];
        if (values.length && !values.some(item => String(item.id) === valueId)) return null;
        return { value_id: valueId };
    }

    if (override.value_name !== undefined) {
        // A tela envia o nome exibido. Para listas usamos a opÃ§Ã£o
        // correspondente; para texto livre mantemos o nome.
        const values = Array.isArray(definition.values) ? definition.values : [];
        if (values.length) {
            const match = values.find(item => normalize(item.name) === normalize(override.value_name));
            if (match) return { value_id: String(match.id) };
        }

        const partial = values.find(item => normalize(item.name).includes(normalize(override.value_name)));
        if (partial) return { value_id: String(partial.id) };

        // Se a categoria oferece uma lista fechada, nunca enviar valor livre.
        if (values.length) return null;
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
        const match = values.find(item => normalize(item.name) === normalize(value === true ? "sim" : "nÃ£o"));

        return match ? { value_id: String(match.id) } : { value_name: value === true ? "Sim" : "NÃ£o" };
    }

    if (type === "number") {
        // NÃºmero da Anatel nÃ£o pode ser inventado: sÃ³ aceita o que o
        // vendedor digitar (11 dÃ­gitos) e o Mercado Livre validar.
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
    // Um valor sem value_id nem value_name Ã© descartado silenciosamente
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
 * @param {object}   params.overrides     valores jÃ¡ confirmados pelo vendedor
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

    // A embalagem Ã© exigida pela API do Mercado Livre na validaÃ§Ã£o (ME2),
    // mesmo vindo com tags.hidden na categoria. Ela precisa aparecer SEMPRE
    // na revisÃ£o como campo preenchÃ­vel â¬ senÃ£o o botÃ£o Publicar habilita
    // sem as medidas e a publicaÃ§Ã£o Ã© recusada (missing.seller.package.dimensions).
    const PACKAGE_DEFINICOES = {
        SELLER_PACKAGE_HEIGHT: { name: "Altura da embalagem (cm)", unidade: "cm" },
        SELLER_PACKAGE_WIDTH: { name: "Largura da embalagem (cm)", unidade: "cm" },
        SELLER_PACKAGE_LENGTH: { name: "Comprimento da embalagem (cm)", unidade: "cm" },
        SELLER_PACKAGE_WEIGHT: { name: "Peso da embalagem (g)", unidade: "g" }
    };

    const packageDefinitions = PACKAGE_ATTRIBUTES.map(id => {
        const existente = (definitions || []).find(item => item.id === id);
        const meta = PACKAGE_DEFINICOES[id];

        return {
            ...(existente || {}),
            id,
            name: existente?.name || meta.name,
            value_type: existente?.value_type || "number_unit",
            allowed_units: (existente?.allowed_units?.length ? existente.allowed_units : [{ id: meta.unidade }]),
            default_unit: existente?.default_unit || meta.unidade,
            values: [],
            tags: { ...(existente?.tags || {}), hidden: false },
            requirement: "conditional_required"
        };
    });

    const withPackages = [
        ...(definitions || []).filter(item => !PACKAGE_ATTRIBUTES.includes(item.id)),
        ...packageDefinitions
    ];

    const required = withPackages.filter(item => item.requirement === "required" || item.requirement === "conditional_required");
    const optional = withPackages.filter(item => item.requirement === "optional");

    const filled = [];
    const pending = [];
    const hypotheses = [];
    const requiredList = [];

    const resolveDefinition = definition => {
        // 1) O vendedor jÃ¡ confirmou o valor na revisÃ£o.
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

        // 2) Medidas da embalagem: nunca estimar. O vendedor precisa
        // informar as dimensões/peso reais do pacote já preparado para envio.
        if (PACKAGE_ATTRIBUTES.includes(definition.id)) {
            return null;
        }

        // 3) EvidÃªncia da identificaÃ§Ã£o (fotos + observaÃ§Ã£o).
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

        // 5) PadrÃµes do fabricante para o modelo (hipÃ³tese explÃ­cita).
        const catalogValue = catalog[definition.id] ?? catalog[normalize(definition.id).replace(/_/g, "")]
            ?? (definition.id === "IS_DUAL_SIM" ? catalog.is_dual_sim : undefined)
            ?? (definition.id === "MANUFACTURER" ? catalog.manufacturer : undefined);

        if (catalogValue !== undefined && catalogValue !== null && clean(catalogValue) !== "") {
            const described = describe(definition, catalogValue, "catalog_hypothesis", {
                confidence: "hypothesis",
                note: catalog._reason || "PadrÃ£o desta linha; confirme se corresponde ao seu produto."
            });
            if (described) {
                hypotheses.push(described);
                return described;
            }
        }

        // 6) Dica comercial aceita pelo ML (ex.: marca "NÃ£o especificada").
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
                    note: "Marca nÃ£o identificada. Se o produto realmente nÃ£o tem marca, confirme esta opÃ§Ã£o."
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

    // Opcionais sÃ³ entram quando hÃ¡ evidÃªncia ou padrÃ£o do catÃ¡logo; nunca
    // sÃ£o exigidos do vendedor.
    const optionalFilled = [];
    for (const definition of optional) {
        const override = overrides[definition.id];
        const fromIdentification = identificationValue(definition.id, identification, seller);
        const catalogValue = catalog[definition.id];

        const raw = override ?? fromIdentification ?? catalogValue;
        if (raw === undefined || raw === null || clean(raw) === "") continue;

        const origin = override !== undefined ? "seller" : fromIdentification ? "identification" : "catalog_hypothesis";

        // Opcionais vindos sÃ³ do catÃ¡logo nÃ£o sÃ£o hipÃ³teses obrigatÃ³rias:
        // entram como preenchidos para enriquecer o anÃºncio.
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
