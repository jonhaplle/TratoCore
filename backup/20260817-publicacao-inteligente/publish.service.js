console.log("### PUBLISH SERVICE — FLUXO OFICIAL ML ###");

const productService = require("../productService");
const productImageService = require("../productImageService");
const itemService = require("./item.service");
const apiService = require("./api.service");
const mlProductService = require("./mlProduct.service");
const publicationSpecService = require("./publicationSpec.service");
const attributeResolver = require("./attributeResolver.service");

function clean(value) {
    if (value === undefined || value === null) return "";
    return String(value).trim();
}

function findDefinition(publicationSpec, id) {
    return (publicationSpec.attributes || []).find(item => item.id === id) || {
        id,
        name: id,
        value_type: "string",
        values: []
    };
}

function buildMissing(publicationSpec, ids) {
    const unique = [];
    for (const id of ids || []) {
        if (!id || unique.some(item => item.id === id)) continue;
        const definition = findDefinition(publicationSpec, id);
        unique.push({
            id: definition.id,
            name: definition.name || definition.id,
            value_type: definition.value_type || "string",
            value_max_length: definition.value_max_length,
            values: Array.isArray(definition.values) ? definition.values : []
        });
    }
    return unique;
}

function getConditionalRequired(publicationSpec) {
    return Array.isArray(publicationSpec?.conditionalAttributes?.required_attributes)
        ? publicationSpec.conditionalAttributes.required_attributes
        : [];
}

function extractValidationCauses(error) {
    const data = error?.response?.data || error?.data || error;
    return Array.isArray(data?.cause) ? data.cause : [];
}

function extractMissingFromValidation(error, publicationSpec) {
    const ids = [];
    for (const cause of extractValidationCauses(error)) {
        const code = clean(cause?.code);
        const message = clean(cause?.message);
        if (!code.includes("missing_required") && !code.includes("missing_conditional_required")) {
            continue;
        }

        const matches = message.match(/attributes?\s*\[([^\]]+)\]/i);
        if (matches) {
            for (const id of matches[1].split(",")) {
                const cleanId = id.trim();
                if (cleanId) ids.push(cleanId);
            }
        }
    }
    return buildMissing(publicationSpec, ids);
}

function missingError(missing, message = "Informações obrigatórias pendentes para publicar.") {
    const error = new Error(message);
    error.code = "ML_MISSING_ATTRIBUTES";
    error.status = 422;
    error.missing = missing;
    return error;
}

module.exports.publish = async (productId, attributeOverrides = {}) => {
    console.log("========================================");
    console.log("PUBLICANDO PRODUTO NO MERCADO LIVRE");
    console.log("Produto ID:", productId);
    console.log("========================================");

    const product = await productService.getById(productId);
    if (!product) throw new Error("Produto não encontrado.");

    const pictures = await productImageService.getByProductId(productId);
    if (!pictures || pictures.length === 0) throw new Error("O produto não possui imagens.");

    await apiService.getAccessToken();

    // ======================================================
    // ETAPA 1 — CATEGORIA + REGRAS OFICIAIS DO ML
    // ======================================================
    const publicationSpec = await publicationSpecService.resolve(product);

    console.log("========== CATEGORIA RESOLVIDA ==========");
    console.log("Categoria:", publicationSpec.category_id);
    console.log("Nome:", publicationSpec.category.name);
    console.log("Listing type:", publicationSpec.listing_type.id);
    console.log("==========================================");

    // ======================================================
    // ETAPA 2 — RESOLVER ATRIBUTOS ANTES DE FAZER UPLOAD
    // ======================================================
    const resolved = attributeResolver.build({
        product,
        categoryAttributes: publicationSpec.attributes,
        prediction: publicationSpec.prediction,
        overrides: attributeOverrides
    });

    if (resolved.missing.length) {
        throw missingError(resolved.missing);
    }

    // ======================================================
    // ETAPA 3 — CONDICIONAIS REAIS DO ML
    // ======================================================
    const conditionalRequired = getConditionalRequired(publicationSpec);
    const present = new Set(resolved.attributes.map(attribute => attribute.id));
    const conditionalMissing = conditionalRequired
        .map(attribute => attribute.id)
        .filter(id => !present.has(id));

    if (conditionalMissing.length) {
        throw missingError(
            buildMissing(publicationSpec, conditionalMissing),
            "O Mercado Livre exige informações adicionais para esta publicação."
        );
    }

    // ======================================================
    // ETAPA 4 — PAYLOAD + FOTOS
    // ======================================================
    const item = await itemService.build(
        product,
        pictures,
        publicationSpec,
        attributeOverrides
    );

    console.log("========== PAYLOAD MERCADO LIVRE ==========");
    console.log(JSON.stringify(item, null, 2));
    console.log("===========================================");

    // ======================================================
    // ETAPA 5 — VALIDADOR OFICIAL
    // ======================================================
    console.log("VALIDANDO PAYLOAD NO MERCADO LIVRE...");

    let validation;
    try {
        validation = await apiService.validateItem(item);
    } catch (error) {
        const missing = extractMissingFromValidation(error, publicationSpec);
        if (missing.length) throw missingError(missing, "O Mercado Livre ainda exige estas informações.");
        throw error;
    }

    console.log("VALIDAÇÃO MERCADO LIVRE: OK");
    console.dir(validation, { depth: null });

    // ======================================================
    // ETAPA 6 — PUBLICAÇÃO REAL
    // ======================================================
    const mlResponse = await apiService.publishItem(item);

    if (product.description && product.description.trim().length > 0) {
        await apiService.createDescription(mlResponse.id, product.description);
    }

    await mlProductService.savePublication(productId, mlResponse);

    console.log("========================================");
    console.log("ANÚNCIO PUBLICADO COM SUCESSO");
    console.log("ID:", mlResponse.id);
    console.log("STATUS:", mlResponse.status);
    console.log("========================================");

    return {
        success: true,
        ml: mlResponse,
        item,
        publication: {
            category_id: publicationSpec.category_id,
            category_name: publicationSpec.category.name,
            listing_type_id: publicationSpec.listing_type.id
        }
    };
};
