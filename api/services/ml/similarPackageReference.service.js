const apiService = require("./api.service");

const PACKAGE_IDS = [
    "SELLER_PACKAGE_HEIGHT",
    "SELLER_PACKAGE_WIDTH",
    "SELLER_PACKAGE_LENGTH",
    "SELLER_PACKAGE_WEIGHT"
];

function clean(value) {
    return value === undefined || value === null ? "" : String(value).trim();
}

function normalize(value) {
    return clean(value)
        .normalize("NFD")
        .replace(/[\\u0300-\\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
}

function tokens(value) {
    return normalize(value).split(/\\s+/).filter(token => token.length >= 2);
}

function getAttribute(item, id) {
    return (item?.attributes || []).find(attribute => attribute?.id === id) || null;
}

function readPackageValue(attribute, expectedUnit) {
    if (!attribute) return null;

    const struct = attribute.value_struct;
    if (struct?.number !== undefined && struct?.unit) {
        const number = Number(struct.number);
        const unit = normalize(struct.unit);
        if (Number.isFinite(number) && number > 0 && unit === expectedUnit) {
            return `${number} ${expectedUnit}`;
        }
        return null;
    }

    const raw = clean(attribute.value_name);
    const match = raw.match(/^(\\d+(?:[.,]\\d+)?)\\s*(cm|g)$/i);
    if (!match) return null;

    const number = Number(match[1].replace(",", "."));
    const unit = match[2].toLowerCase();
    if (!Number.isFinite(number) || number <= 0 || unit !== expectedUnit) return null;
    return `${number} ${expectedUnit}`;
}

function packageFromItem(item) {
    const units = {
        SELLER_PACKAGE_HEIGHT: "cm",
        SELLER_PACKAGE_WIDTH: "cm",
        SELLER_PACKAGE_LENGTH: "cm",
        SELLER_PACKAGE_WEIGHT: "g"
    };
    const result = {};
    for (const id of PACKAGE_IDS) {
        const value = readPackageValue(getAttribute(item, id), units[id]);
        if (!value) return null;
        result[id] = { value_name: value };
    }
    return result;
}

function isSameProduct(item, product, categoryId) {
    if (!item || item.status !== "active") return false;
    if (categoryId && item.category_id && item.category_id !== categoryId) return false;

    const brand = clean(product.brand);
    const model = clean(product.model);
    const line = clean(product.line);
    if (!brand || !model) return false;

    const identityTokens = [...new Set([...tokens(brand), ...tokens(model)])];
    if (!identityTokens.length) return false;

    const itemText = normalize([
        item.title,
        ...(item.attributes || []).map(attribute => attribute?.value_name)
    ].join(" "));
    if (!identityTokens.every(token => itemText.includes(token))) return false;

    if (line) {
        const lineTokens = tokens(line);
        if (lineTokens.length && !lineTokens.every(token => itemText.includes(token))) return false;
    }
    return true;
}

exports.findPackageReference = async (product, categoryId) => {
    const brand = clean(product?.brand);
    const model = clean(product?.model);
    if (!brand || !model) {
        return { found: false, reason: "brand_model_missing" };
    }

    const query = [brand, clean(product.line), model].filter(Boolean).join(" ");
    try {
        const search = await apiService.searchSiteItems(query, { limit: 30 });
        const ids = (search?.results || [])
            .map(result => typeof result === "string" ? result : result?.id)
            .filter(Boolean)
            .slice(0, 30);

        if (!ids.length) return { found: false, reason: "no_similar_listings" };

        const bulk = await apiService.getItemsBulk(ids);
        const items = (bulk || [])
            .filter(entry => !entry?.code || Number(entry.code) === 200)
            .map(entry => entry?.body || entry)
            .filter(item => isSameProduct(item, product, categoryId));

        const references = items
            .map(item => ({ item, attributes: packageFromItem(item) }))
            .filter(reference => reference.attributes);

        if (!references.length) {
            return { found: false, reason: "no_verified_package_dimensions", candidates_checked: items.length };
        }

        // Usa a referência com maior aderência textual entre anúncios do mesmo
        // modelo/categoria. Só aceita um anúncio que contenha os quatro valores.
        references.sort((a, b) => {
            const aTitle = normalize(a.item.title);
            const bTitle = normalize(b.item.title);
            const target = normalize([brand, model, line].join(" "));
            const aScore = tokens(target).filter(token => aTitle.includes(token)).length;
            const bScore = tokens(target).filter(token => bTitle.includes(token)).length;
            return bScore - aScore;
        });

        const best = references[0];
        return {
            found: true,
            source_item_id: best.item.id,
            source_title: best.item.title,
            attributes: best.attributes,
            candidates_checked: items.length,
            references_found: references.length
        };
    } catch (error) {
        console.warn("[PackageReference] Busca de anúncios similares indisponível:", error.response?.status || error.message);
        return { found: false, reason: "search_failed" };
    }
};
