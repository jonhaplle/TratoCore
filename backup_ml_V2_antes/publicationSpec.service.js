const apiService = require("./api.service");
const catalogMatcher = require("./catalogMatcher.service");
const attributeResolver = require("./attributeResolver.service");

const DEFAULT_SITE_ID = process.env.ML_SITE_ID || "MLB";
const DEFAULT_LISTING_TYPE =
    process.env.ML_DEFAULT_LISTING_TYPE || "gold_pro";

function clean(value) {
    if (value === undefined || value === null) return "";
    return String(value).trim();
}

function isLeaf(category) {
    return (
        !Array.isArray(category.children_categories) ||
        category.children_categories.length === 0
    );
}

function findListingType(available, preferred) {
    const list = Array.isArray(available?.available)
        ? available.available
        : [];

    return list.find(item => item.id === preferred) || null;
}

function buildConditionalPayload(product, categoryId, listingType) {
    const price = Number(product.sale_price);

    if (!Number.isFinite(price) || price <= 0) {
        throw new Error(
            "Preço inválido para consulta de atributos condicionais."
        );
    }

    const quantity = Math.max(1, Number(product.quantity || 1));

    const condition =
        String(product.condition || "used").toLowerCase() === "new"
            ? "new"
            : "used";

    return {
        title: clean(product.title),
        category_id: categoryId,
        price,
        currency_id: "BRL",
        available_quantity: quantity,
        buying_mode: "buy_it_now",
        condition,
        listing_type_id: listingType.id,
        description: {
            plain_text: clean(product.description || product.title)
        }
    };
}

exports.resolve = async (product) => {
    const title = clean(product.title);

    if (!title) {
        throw new Error("Produto sem título para categorização.");
    }

    const predictions = await apiService.predictCategory(title);

    let prediction = null;
    let category = null;

    for (const candidate of predictions) {
        if (!candidate?.category_id) continue;

        const candidateCategory = await apiService.getCategory(
            candidate.category_id
        );

        if (isLeaf(candidateCategory)) {
            prediction = candidate;
            category = candidateCategory;
            break;
        }
    }

    if (!prediction || !category) {
        throw new Error(
            "O preditor do Mercado Livre não retornou uma categoria folha utilizável."
        );
    }

    const attributes = await apiService.getCategoryAttributes(
        category.id
    );

    const me = await apiService.getMe();

    const availableListingTypes =
        await apiService.getAvailableListingTypes(
            me.id,
            category.id
        );

    const preferredListingType =
        product.ml_listing_type || DEFAULT_LISTING_TYPE;

    const listingType = findListingType(
        availableListingTypes,
        preferredListingType
    );

    if (!listingType) {
        const available = (availableListingTypes.available || [])
            .map(item => item.id)
            .join(", ") || "nenhum";

        throw new Error(
            `O listing_type '${preferredListingType}' não está disponível para ` +
            `${category.id}. Disponíveis: ${available}. ` +
            "Por regra do TratoCore, não fazer downgrade automático."
        );
    }

    // Envia também os atributos já resolvidos. A documentação do ML informa
    // que o endpoint condicional deve receber as informações do item para
    // determinar quais atributos são realmente obrigatórios.
    const preliminary = attributeResolver.build({
        product,
        categoryAttributes: attributes,
        prediction
    });

    const conditionalPayload = buildConditionalPayload(
        product,
        category.id,
        listingType
    );
    conditionalPayload.attributes = preliminary.attributes;

    const conditionalAttributes =
        await apiService.getConditionalAttributes(
            category.id,
            conditionalPayload
        );

    return {
        site_id: DEFAULT_SITE_ID,
        prediction,
        predictions,
        category,
        attributes,
        conditionalAttributes,
        conditionalPayload,
        listing_type: listingType,
        category_id: category.id
    };
};