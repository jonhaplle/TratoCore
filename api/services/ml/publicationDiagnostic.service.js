const PRODUCT_ID = "10";
const CATEGORY_ID = "MLB193633";
const MAX_SEARCH_RESULTS = 1000;
const SEARCH_PAGE_SIZE = 100;
const BULK_SIZE = 20;

function normalizeText(value) {
    return String(value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
}

function compactAttribute(attribute) {
    if (typeof attribute === "string") return { id: attribute };
    return {
        id: attribute?.id,
        name: attribute?.name,
        required: attribute?.tags?.required === true,
        conditional_required: attribute?.tags?.conditional_required === true,
        value_type: attribute?.value_type,
        values: (attribute?.values || [])
            .filter(value => value && (value.id || value.name))
            .map(value => ({ id: value.id, name: value.name }))
    };
}

function compactConditionalResult(result) {
    const attributes = Array.isArray(result)
        ? result
        : result?.required_attributes || result?.conditional_attributes || result?.attributes || [];

    return {
        required_attributes: Array.isArray(attributes) ? attributes.map(compactAttribute) : [],
        response_keys: result && !Array.isArray(result) ? Object.keys(result) : []
    };
}

function safeStageError(stage, error) {
    return {
        stage,
        http_status: error?.response?.status || null,
        code: typeof error?.code === "string" ? error.code : null
    };
}

function buildConditionalPayload(product, listingTypeId) {
    const title = String(product.title || "").trim();
    const price = Number(product.sale_price);
    if (!title) throw new Error("Produto 10 está sem título.");
    if (!Number.isFinite(price) || price <= 0) throw new Error("Preço do produto 10 inválido.");

    return {
        title,
        category_id: CATEGORY_ID,
        price,
        currency_id: "BRL",
        available_quantity: Math.max(1, Number(product.quantity || 1)),
        buying_mode: "buy_it_now",
        condition: String(product.condition || "used").toLowerCase() === "new" ? "new" : "used",
        listing_type_id: listingTypeId,
        description: { plain_text: String(product.description || title).trim() },
        // Candidate for diagnosis only; GTIN and its absence reason are deliberately omitted.
        attributes: [
            { id: "BRAND", value_name: "Genérico" },
            { id: "MODEL", value_name: "Saca-rolhas manual vintage" }
        ]
    };
}

async function searchPossibleMatches(apiService, userId, title) {
    const ids = [];
    let total = null;
    let offset = 0;

    while (offset < MAX_SEARCH_RESULTS && (total === null || offset < total)) {
        const page = await apiService.searchUserItems(userId, {
            limit: SEARCH_PAGE_SIZE,
            offset
        });
        const pageIds = (page?.results || [])
            .map(result => typeof result === "string" ? result : result?.id)
            .filter(Boolean);

        ids.push(...pageIds);
        const reportedTotal = page?.paging?.total;
        total = reportedTotal !== undefined && reportedTotal !== null && Number.isFinite(Number(reportedTotal))
            ? Number(reportedTotal)
            : ids.length;
        if (!pageIds.length) break;
        offset += pageIds.length;
    }

    const uniqueIds = [...new Set(ids)].slice(0, MAX_SEARCH_RESULTS);
    const detailRows = [];
    for (let index = 0; index < uniqueIds.length; index += BULK_SIZE) {
        const batch = await apiService.getItemsBulk(uniqueIds.slice(index, index + BULK_SIZE));
        detailRows.push(...(Array.isArray(batch) ? batch : []));
    }

    const searchTokens = normalizeText(title).split(" ").filter(token => token.length > 2);
    const requiredMatches = Math.min(2, searchTokens.length);
    const candidates = detailRows
        .map(row => row?.body || row)
        .filter(item => item && item.id && item.title)
        .map(item => {
            const itemTitle = normalizeText(item.title);
            const matchingTokens = searchTokens.filter(token => itemTitle.includes(token));
            return {
                id: item.id,
                title: item.title,
                category_id: item.category_id,
                status: item.status,
                matching_title_terms: matchingTokens.length
            };
        })
        .filter(item => requiredMatches > 0 && item.matching_title_terms >= requiredMatches);

    return {
        scope: "active_seller_listings",
        results_scanned: uniqueIds.length,
        truncated: Number(total) > MAX_SEARCH_RESULTS,
        possible_matches: candidates
    };
}

function createPublicationDiagnostic({ productService, apiService }) {
    if (!productService || !apiService) throw new Error("Dependências do diagnóstico não informadas.");

    return async function runProduct10Diagnostic() {
        const product = await productService.getById(PRODUCT_ID);
        if (!product) {
            const error = new Error("Produto 10 não encontrado.");
            error.status = 404;
            throw error;
        }

        const result = {
            success: true,
            product_id: PRODUCT_ID,
            category_id: CATEGORY_ID,
            errors: []
        };

        let account = null;
        try {
            account = await apiService.getMe();
            result.account_authenticated = Boolean(account?.id);
        } catch (error) {
            result.account_authenticated = false;
            result.errors.push(safeStageError("account", error));
        }

        try {
            const definitions = await apiService.getCategoryAttributes(CATEGORY_ID);
            result.category_attributes = (definitions || [])
                .filter(attribute => attribute?.tags?.required || attribute?.tags?.conditional_required)
                .map(compactAttribute);
        } catch (error) {
            result.errors.push(safeStageError("category_attributes", error));
        }

        let listingTypes = [];
        let preferredListingType = product.ml_listing_type || process.env.ML_DEFAULT_LISTING_TYPE || "gold_pro";
        if (account?.id) {
            try {
                const available = await apiService.getAvailableListingTypes(account.id, CATEGORY_ID);
                listingTypes = (available?.available || []).map(item => ({
                    id: item.id,
                    name: item.name,
                    remaining_listings: item.remaining_listings
                }));
            } catch (error) {
                result.errors.push(safeStageError("listing_types", error));
            }
        }

        const preferredAvailable = listingTypes.some(item => item.id === preferredListingType);
        result.listing_types = {
            preferred: preferredListingType,
            preferred_available: preferredAvailable,
            available: listingTypes
        };

        const conditionalType = listingTypes.find(item => item.id === preferredListingType) || listingTypes[0] || null;
        if (conditionalType) {
            result.conditional_validation = {
                listing_type_tested: conditionalType.id,
                preferred_type_tested: conditionalType.id === preferredListingType,
                input_summary: {
                    title: String(product.title || "").trim(),
                    price: Number(product.sale_price),
                    currency_id: "BRL",
                    available_quantity: Math.max(1, Number(product.quantity || 1)),
                    condition: String(product.condition || "used").toLowerCase() === "new" ? "new" : "used"
                },
                candidate_attributes: [
                    { id: "BRAND", value_name: "Genérico" },
                    { id: "MODEL", value_name: "Saca-rolhas manual vintage" }
                ],
                gtin_sent: false,
                empty_gtin_reason_sent: false
            };
            try {
                const payload = buildConditionalPayload(product, conditionalType.id);
                const validation = await apiService.getConditionalAttributes(CATEGORY_ID, payload);
                result.conditional_validation.result = compactConditionalResult(validation);
            } catch (error) {
                result.conditional_validation.error = safeStageError("conditional_attributes", error);
                result.errors.push(safeStageError("conditional_attributes", error));
            }
        } else {
            result.conditional_validation = {
                skipped: true,
                reason: "No hay listing type disponible para formar el payload de validación."
            };
        }

        if (account?.id) {
            try {
                result.duplicate_check = await searchPossibleMatches(apiService, account.id, product.title);
            } catch (error) {
                result.errors.push(safeStageError("seller_items_search", error));
                result.duplicate_check = { available: false };
            }
        } else {
            result.duplicate_check = { available: false };
        }

        return result;
    };
}

module.exports = {
    CATEGORY_ID,
    PRODUCT_ID,
    buildConditionalPayload,
    compactAttribute,
    createPublicationDiagnostic
};
