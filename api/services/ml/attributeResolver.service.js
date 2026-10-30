function clean(value) {
    if (value === undefined || value === null) return "";
    return String(value).trim();
}

function normalize(value) {
    return clean(value)
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();
}

function addUnique(list, item) {
    if (!item || !item.id) return;
    if (!list.some(existing => existing.id === item.id)) list.push(item);
}

function predictorMap(prediction) {
    const map = {};
    for (const item of prediction?.attributes || []) {
        if (item?.id) map[item.id] = {
            id: item.id,
            value_id: item.value_id,
            value_name: item.value_name
        };
    }
    return map;
}

function productAttributeMap(product) {
    const raw = product?.ml_attributes || product?.attributes || {};
    const map = {};

    if (Array.isArray(raw)) {
        for (const item of raw) {
            if (item?.id) map[item.id] = item;
        }
    } else if (raw && typeof raw === "object") {
        for (const [id, value] of Object.entries(raw)) {
            if (value && typeof value === "object" && !Array.isArray(value)) {
                map[id] = { id, ...value };
            } else {
                map[id] = { id, value_name: value };
            }
        }
    }

    return map;
}

function knownProductValue(product, id) {
    const ai = product?.attributes || product?.ml_attributes || {};
    const aiMap = { MUSIC_ARTIST_NAME: ai.artist, ALBUM_NAME: ai.album, MANUFACTURER: ai.manufacturer, SALE_FORMAT: ai.sale_format, UNITS_PER_PACK: ai.units_per_pack };
    if (aiMap[id] !== undefined && aiMap[id] !== null && String(aiMap[id]).trim()) return aiMap[id];
    const map = {
        BRAND: product?.brand,
        MODEL: product?.model,
        LINE: product?.line,
        COLOR: product?.color,
        GTIN: product?.gtin,
        SALE_FORMAT: product?.sale_format,
        UNITS_PER_PACK: product?.units_per_pack,
        MATERIAL: product?.material,
        DISH_PLATE_TYPE: product?.dish_plate_type,
        VOLTAGE: product?.voltage || product?.voltagem || product?.tensao,
        POWER: product?.power || product?.potencia,
        CAPACITY: product?.capacity || product?.capacidade,
        HEIGHT: product?.height || product?.altura,
        WIDTH: product?.width || product?.largura,
        DEPTH: product?.depth || product?.profundidade,
        SIZE: product?.size || product?.tamanho
    };

    return map[id];
}

function overrideMap(overrides) {
    const map = {};
    if (!overrides) return map;

    if (Array.isArray(overrides)) {
        for (const item of overrides) {
            if (item?.id) map[item.id] = item;
        }
    } else if (typeof overrides === "object") {
        for (const [id, value] of Object.entries(overrides)) {
            if (value && typeof value === "object" && !Array.isArray(value)) {
                map[id] = { id, ...value };
            } else {
                map[id] = { id, value_name: value };
            }
        }
    }

    return map;
}

function valueFromAllowedList(definition, rawValue) {
    const raw = clean(rawValue);
    if (!raw) return null;

    if (!Array.isArray(definition?.values) || !definition.values.length) {
        return { value_name: raw };
    }

    const wanted = normalize(raw);

    const exact = definition.values.find(v =>
        normalize(v.name) === wanted || String(v.id) === raw
    );
    if (exact) return { value_id: String(exact.id) };

    const partial = definition.values.find(v => {
        const candidate = normalize(v.name);
        return candidate.includes(wanted) || wanted.includes(candidate);
    });
    if (partial) return { value_id: String(partial.id) };

    const valueType = normalize(definition?.value_type);
    if (["string", "number", "number_unit"].includes(valueType)) {
        return { value_name: raw };
    }

    return null;
}

function descriptionText(product) {
    return clean(product?.description || product?.description_plain_text || "");
}

function titleText(product) {
    return clean(product?.title || "");
}

function extractLabeledValue(text, labels) {
    if (!text) return "";
    const escaped = labels.map(label => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
    const re = new RegExp(`(?:^|[\\n\\r.;|])\\s*(?:${escaped})\\s*[:=-]\\s*([^\\n\\r.;|]+)`, "i");
    const match = text.match(re);
    return match ? clean(match[1]) : "";
}

function extractDescriptionValue(product, definition) {
    const text = descriptionText(product);
    if (!text) return "";

    const id = normalize(definition?.id);
    const name = normalize(definition?.name);
    const key = `${id} ${name}`;

    if (id === 'units_per_pack') {
        const quantity = text.match(/(?:inclui|cont[eé]m|contendo|com|possui|composto por|formado por)\s+(\d+|um|uma|dois|duas|tr[eê]s|quatro|cinco|seis|sete|oito|nove|dez)\s+(?:garrafas?|unidades?|pe[cç]as?|itens?)/i);
        if (quantity) {
            const numbers = {um:1, uma:1, dois:2, duas:2, 'três':3, quatro:4, cinco:5, seis:6, sete:7, oito:8, nove:9, dez:10};
            const raw = quantity[1].toLowerCase();
            return numbers[raw] || raw;
        }
    }
    const groups = [
        { labels: ["album", "Ã¡lbum"], keys: /album|Ã¡lbum/ },
        { labels: ["artista", "artist", "intÃ©rprete", "interprete"], keys: /artist|artista|interprete|intÃ©rprete/ },
        { labels: ["marca", "brand"], keys: /brand|marca/ },
        { labels: ["modelo", "model"], keys: /model|modelo/ },
        { labels: ["linha", "line"], keys: /line|linha/ },
        { labels: ["cor", "color"], keys: /color|cor/ },
        { labels: ["material"], keys: /material/ },
        { labels: ["voltagem", "voltage", "tensÃ£o", "tensao"], keys: /voltag|tensao|tensÃ£o|voltage/ },
        { labels: ["potÃªncia", "potencia", "power"], keys: /potenc|power/ },
        { labels: ["capacidade", "capacity"], keys: /capacid|capacity/ },
        { labels: ["tamanho", "size"], keys: /tamanho|size/ }
    ];

    for (const group of groups) {
        if (group.keys.test(key)) {
            const value = extractLabeledValue(text, group.labels);
            if (value) return value;
        }
    }

    return "";
}

function resolveOne(definition, product, predictorValues, overrides, options = {}) {
    const id = definition.id;
    const productMap = productAttributeMap(product);
    // MATERIAL is not inferred from AI/predictor attributes: its value must
    // come from a direct manual field/override or an explicitly labelled detail.
    const explicit = id === "MATERIAL" ? null : productMap[id];
    const override = overrides[id];
    const required = options.required === true;
    const isNumberUnit = normalize(definition.value_type) === "number_unit";

    const directSources = [override, explicit];

    // Atributos number_unit não aceitam value_id como valor final.
    // Primeiro aproveita uma estrutura numérica/unidade já validada.
    if (isNumberUnit) {
        for (const source of directSources) {
            if (source?.value_struct?.number != null && source?.value_struct?.unit) {
                return {
                    id,
                    value_struct: {
                        number: Number(source.value_struct.number),
                        unit: String(source.value_struct.unit)
                    }
                };
            }

            if (source?.value_name !== undefined) {
                const parsed = parseNumberUnit(source.value_name, definition);
                if (parsed) return { id, ...parsed };
            }
        }

        // Busca a capacidade explicitamente informada no campo do produto,
        // título ou descrição. Não converte IDs de lista em capacidade.
        const known = id === "MATERIAL" ? product?.material : knownProductValue(product, id);
        const fromKnown = parseNumberUnit(known, definition);
        if (fromKnown) return { id, ...fromKnown };

        const text = `${titleText(product)} ${descriptionText(product)}`;
        const fromText = parseNumberUnit(text, definition);
        if (fromText) return { id, ...fromText };
    } else {
        for (const source of directSources) {
            if (!source) continue;
            if (source.value_id) return { id, value_id: String(source.value_id) };
            if (source.value_name !== undefined) {
                const value = valueFromAllowedList(definition, source.value_name);
                if (value) return { id, ...value };
            }
        }

        const known = id === "MATERIAL" ? product?.material : knownProductValue(product, id);
        if (known !== undefined && clean(known)) {
            const value = valueFromAllowedList(definition, known);
            if (value) return { id, ...value };
        }

        const fromDescription = extractDescriptionValue(product, definition);
        if (fromDescription) {
            const value = valueFromAllowedList(definition, fromDescription);
            if (value) return { id, ...value };
        }
    }

    // O predictor é auxiliar e só completa atributos obrigatórios.
    if (required && id !== "MATERIAL") {
        const predicted = predictorValues[id];
        if (predicted) {
            if (isNumberUnit) {
                if (predicted.value_struct?.number != null && predicted.value_struct?.unit) {
                    return {
                        id,
                        value_struct: {
                            number: Number(predicted.value_struct.number),
                            unit: String(predicted.value_struct.unit)
                        }
                    };
                }
                const parsed = parseNumberUnit(predicted.value_name, definition);
                if (parsed) return { id, ...parsed };
            } else {
                if (predicted.value_id) return { id, value_id: String(predicted.value_id) };
                if (predicted.value_name !== undefined) {
                    const value = valueFromAllowedList(definition, predicted.value_name);
                    if (value) return { id, ...value };
                }
            }
        }
    }


    return null;
}

function parseNumberUnit(rawValue, definition) {
    const raw = clean(rawValue);
    if (!raw) return null;

    const allowedUnits = (definition?.allowed_units || [])
        .map(unit => clean(unit.id || unit.name).toUpperCase())
        .filter(Boolean);
    const defaultUnit = clean(definition?.default_unit).toUpperCase();
    const units = [...new Set([...allowedUnits, defaultUnit, "TB", "GB", "MB", "CM", "MM", "M", "KG", "G", "W", "V"])]
        .filter(Boolean)
        .sort((a, b) => b.length - a.length)
        .join("|");

    // Aceita formatos como "1 TB", "1TB" ou "1000 GB".
    const match = raw.match(new RegExp(`(?:^|\\b)(\\d+(?:[.,]\\d+)?)\\s*(${units})(?:\\b|$)`, "i"));
    if (match) {
        const number = Number(match[1].replace(",", "."));
        const unit = match[2].toUpperCase();
        if (!Number.isFinite(number)) return null;
        if (allowedUnits.length && !allowedUnits.includes(unit)) return null;
        return { value_struct: { number, unit } };
    }

    // Se veio apenas um número, usa a unidade padrão definida pela categoria.
    if (/^\d+(?:[.,]\d+)?$/.test(raw) && defaultUnit) {
        const number = Number(raw.replace(",", "."));
        if (Number.isFinite(number)) {
            return { value_struct: { number, unit: defaultUnit } };
        }
    }

    return null;
}

function normalizeDefinition(definition) {
    if (!definition?.id) return null;
    return {
        ...definition,
        tags: definition.tags || {},
        values: Array.isArray(definition.values) ? definition.values : []
    };
}

function mergeDefinitions(categoryAttributes, conditionalAttributes) {
    const map = new Map();

    for (const raw of categoryAttributes || []) {
        const definition = normalizeDefinition(raw);
        if (definition) map.set(definition.id, definition);
    }

    const required = Array.isArray(conditionalAttributes)
        ? conditionalAttributes
        : [];

    for (const raw of required) {
        const definition = normalizeDefinition(raw);
        if (!definition) continue;

        const current = map.get(definition.id);
        if (current) {
            map.set(definition.id, {
                ...current,
                ...definition,
                tags: { ...(current.tags || {}), ...(definition.tags || {}), required: true }
            });
        } else {
            map.set(definition.id, {
                ...definition,
                tags: { ...(definition.tags || {}), required: true }
            });
        }
    }

    return [...map.values()];
}

exports.build = ({
    product,
    categoryAttributes,
    conditionalAttributes = [],
    prediction,
    overrides = {}
}) => {
    const attributes = [];
    const predictorValues = predictorMap(prediction);
    const overrideValues = overrideMap(overrides);
    const missing = [];
    const definitions = mergeDefinitions(categoryAttributes, conditionalAttributes);

    for (const definition of definitions) {
        const tags = definition.tags || {};

        if (tags.hidden || tags.read_only || tags.fixed) continue;

        const required = tags.required === true;
        const resolved = resolveOne(
            definition,
            product,
            predictorValues,
            overrideValues,
            { required }
        );

        if (resolved) {
            addUnique(attributes, resolved);
        } else if (required) {
            missing.push({
                id: definition.id,
                name: definition.name,
                value_type: definition.value_type,
                value_max_length: definition.value_max_length,
                values: definition.values || []
            });
        }
    }

    if (String(product?.condition || "used").toLowerCase() === "used" &&
        !attributes.some(a => a.id === "ITEM_CONDITION")) {
        attributes.push({ id: "ITEM_CONDITION", value_id: "2230581" });
    }

    return { attributes, missing };
};
