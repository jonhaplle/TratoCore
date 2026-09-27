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
    const raw = product.ml_attributes || product.attributes || {};
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
    const map = {
        BRAND: product.brand,
        MODEL: product.model,
        LINE: product.line,
        COLOR: product.color,
        GTIN: product.gtin,
        SALE_FORMAT: product.sale_format,
        UNITS_PER_PACK: product.units_per_pack,
        MATERIAL: product.material,
        DISH_PLATE_TYPE: product.dish_plate_type,
        VOLTAGE: product.voltage || product.voltagem || product.tensao,
        POWER: product.power || product.potencia,
        CAPACITY: product.capacity || product.capacidade,
        HEIGHT: product.height || product.altura,
        WIDTH: product.width || product.largura,
        DEPTH: product.depth || product.profundidade,
        SIZE: product.size || product.tamanho
    };

    return map[id];
}

function isVoltageDefinition(definition) {
    const id = normalize(definition?.id);
    const name = normalize(definition?.name);
    return /voltagem|tensao|voltage|voltaje/.test(`${id} ${name}`);
}

function overrideMap(overrides) {
    const map = {};
    if (!overrides) return map;

    if (Array.isArray(overrides)) {
        for (const item of overrides) {
            if (item?.id) map[item.id] = item;
        }
    } else if (typeof overrides === 'object') {
        for (const [id, value] of Object.entries(overrides)) {
            if (value && typeof value === 'object' && !Array.isArray(value)) {
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

    if (!Array.isArray(definition.values) || !definition.values.length) {
        return { value_name: raw };
    }

    const wanted = normalize(raw);

    const exact = definition.values.find(v =>
        normalize(v.name) === wanted || String(v.id) === raw
    );

    if (exact) return { value_id: exact.id };

    const partial = definition.values.find(v => {
        const candidate = normalize(v.name);
        return candidate.includes(wanted) || wanted.includes(candidate);
    });

    if (partial) return { value_id: partial.id };

    // O ML diferencia atributos de lista de atributos string com valores
    // sugeridos. Para atributos string, um valor novo pode ser enviado por
    // value_name mesmo que nÃ£o apareÃ§a na lista retornada pela categoria.
    // Isso Ã© importante para marcas/modelos de produtos usados e antigos.
    const valueType = normalize(definition?.value_type);
    if (valueType === "string" || valueType === "number" || valueType === "number_unit") {
        return { value_name: raw };
    }

    return null;
}

function resolveOne(definition, product, prediction, predictorValues, overrides) {
    const id = definition.id;
    const productMap = productAttributeMap(product);
    const explicit = productMap[id];
    const override = overrides[id];

    if (id === "EMPTY_GTIN_REASON" && !clean(product.gtin)) {
        const value = valueFromAllowedList(definition, "17055160");
        return value ? { id, ...value } : null;
    }

    const candidates = [override, explicit, predictorValues[id]];

    for (const source of candidates) {
        if (!source) continue;
        if (source.value_id) return { id, value_id: String(source.value_id) };
        if (source.value_name !== undefined) {
            const value = valueFromAllowedList(definition, source.value_name);
            if (value) return { id, ...value };
            if (!Array.isArray(definition.values) || !definition.values.length) {
                return { id, value_name: clean(source.value_name) };
            }
        }
    }

    const known = knownProductValue(product, id);
    if (known !== undefined && clean(known)) {
        const value = valueFromAllowedList(definition, known);
        return value ? { id, ...value } : { id, value_name: clean(known) };
    }

    // Regra operacional do TratoCore: quando a categoria exige voltagem
    // e o vendedor nÃ£o informou, usar Bivolt somente se o prÃ³prio ML
    // oferecer esse valor oficialmente para a categoria.
    if (isVoltageDefinition(definition)) {
        const bivolt = valueFromAllowedList(definition, "Bivolt");
        if (bivolt) return { id, ...bivolt };
    }

    return null;
}

exports.build = ({ product, categoryAttributes, prediction, overrides = {} }) => {
    const attributes = [];
    const predictorValues = predictorMap(prediction);
    const overrideValues = overrideMap(overrides);
    const missing = [];

    for (const definition of categoryAttributes || []) {
        const tags = definition.tags || {};

        if (tags.hidden || tags.read_only || tags.fixed) continue;

        const required = tags.required === true;
        const resolved = resolveOne(
            definition,
            product,
            prediction,
            predictorValues,
            overrideValues
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

    // Mercado Livre: produtos usados devem declarar explicitamente a condicao do item.
    // Usado = 2230581. Nunca tratar usado como recondicionado.
    if (normalize(product.condition) === 'used' && !attributes.some(a => a.id === 'ITEM_CONDITION')) {
        attributes.push({ id: 'ITEM_CONDITION', value_id: '2230581' });
    }

    if (!clean(product.gtin)) {
        const gtinDefinition = (categoryAttributes || []).find(a => a.id === "EMPTY_GTIN_REASON");
        if (gtinDefinition && !attributes.some(a => a.id === "EMPTY_GTIN_REASON")) {
            const value = valueFromAllowedList(gtinDefinition, "17055160");
            if (value) attributes.push({ id: "EMPTY_GTIN_REASON", ...value });
        }
    }

    return { attributes, missing };
};

exports.isVoltageDefinition = isVoltageDefinition;

