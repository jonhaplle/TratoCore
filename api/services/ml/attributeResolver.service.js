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
        DISH_PLATE_TYPE: product.dish_plate_type
    };

    return map[id];
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

    return null;
}

function resolveOne(definition, product, prediction, predictorValues) {
    const id = definition.id;

    if (id === "EMPTY_GTIN_REASON" && !clean(product.gtin)) {
        const value = valueFromAllowedList(definition, "17055160");
        return value ? { id, ...value } : { id, value_id: "17055160" };
    }

    const productMap = productAttributeMap(product);
    const explicit = productMap[id];

    if (explicit) {
        if (explicit.value_id) return { id, value_id: String(explicit.value_id) };
        if (explicit.value_name !== undefined) {
            const value = valueFromAllowedList(definition, explicit.value_name);
            return value ? { id, ...value } : { id, value_name: clean(explicit.value_name) };
        }
    }

    const predicted = predictorValues[id];
    if (predicted?.value_id || predicted?.value_name) {
        if (predicted.value_id) return { id, value_id: String(predicted.value_id) };
        const value = valueFromAllowedList(definition, predicted.value_name);
        return value ? { id, ...value } : { id, value_name: clean(predicted.value_name) };
    }

    const known = knownProductValue(product, id);
    if (known !== undefined && clean(known)) {
        const value = valueFromAllowedList(definition, known);
        return value ? { id, ...value } : { id, value_name: clean(known) };
    }

    return null;
}

exports.build = ({ product, categoryAttributes, prediction }) => {
    const attributes = [];
    const predictorValues = predictorMap(prediction);
    const missing = [];

    for (const definition of categoryAttributes || []) {
        const tags = definition.tags || {};

        if (tags.hidden || tags.read_only || tags.fixed) continue;

        const required = tags.required === true;
        const resolved = resolveOne(
            definition,
            product,
            prediction,
            predictorValues
        );

        if (resolved) {
            addUnique(attributes, resolved);
        } else if (required) {
            missing.push({
                id: definition.id,
                name: definition.name,
                value_type: definition.value_type,
                values: definition.values || []
            });
        }
    }

    if (!clean(product.gtin)) {
        const gtinDefinition = (categoryAttributes || []).find(a => a.id === "EMPTY_GTIN_REASON");
        if (gtinDefinition && !attributes.some(a => a.id === "EMPTY_GTIN_REASON")) {
            attributes.push({ id: "EMPTY_GTIN_REASON", value_id: "17055160" });
        }
    }

    return { attributes, missing };
};
