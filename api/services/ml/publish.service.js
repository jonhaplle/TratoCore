console.log("### PUBLISH SERVICE — FLUXO OFICIAL ML ###");

const productService = require("../productService");
const productImageService = require("../productImageService");
const itemService = require("./item.service");
const apiService = require("./api.service");
const mlProductService = require("./mlProduct.service");
const publicationSpecService = require("./publicationSpec.service");
const attributeResolver = require("./attributeResolver.service");
const attributeRequirements = require("./attributeRequirements.service");

function clean(value) {
    if (value === undefined || value === null) return "";
    return String(value).trim();
}

function getConditionalRequired(publicationSpec) {
    return attributeRequirements.getConditionalRequired(publicationSpec);
}

function extractMissingFromValidation(error, publicationSpec) {
    return attributeRequirements.buildMissing(
        publicationSpec,
        attributeRequirements.extractMissingIdsFromValidation(error)
    );
}

function extractValidationCauses(error) {
    return attributeRequirements.extractValidationCauses(error);
}

function isPictureOnlyValidationError(error) {
    const causes = extractValidationCauses(error);
    return Number(error?.response?.status) === 400 &&
        causes.length > 0 &&
        causes.every(cause => String(cause?.code || "").toLowerCase().includes("picture"));
}

function missingError(missing, message = "Informações obrigatórias pendentes para publicar.") {
    const error = new Error(message);
    error.code = "ML_MISSING_ATTRIBUTES";
    error.status = 422;
    error.missing = missing;
    return error;
}


function isOnlyWarnings(error) {
    const causes = extractValidationCauses(error);
    return causes.length > 0 && causes.every(cause =>
        String(cause?.type || "").toLowerCase() === "warning"
    );
}

function chooseShippingMode(userPreferences, categoryPreferences) {
    const userModes = Array.isArray(userPreferences?.modes)
        ? userPreferences.modes.map(String)
        : [];

    const categoryModes = Array.isArray(categoryPreferences?.logistics)
        ? categoryPreferences.logistics
            .map(item => String(item?.mode || "").trim())
            .filter(Boolean)
        : [];

    const allowed = new Set(categoryModes);
    const candidates = ["me2", "me1", "not_specified", "custom"];

    for (const mode of candidates) {
        if (userModes.includes(mode) && allowed.has(mode)) {
            return mode;
        }
    }

    // Se a categoria não retornar logistics, a preferência da conta ainda
    // permite uma escolha segura entre os modos que o vendedor possui.
    if (!categoryModes.length) {
        for (const mode of candidates) {
            if (userModes.includes(mode)) return mode;
        }
    }

    return null;
}

async function resolveShipping(categoryId) {
    try {
        const me = await apiService.getMe();
        const userId = me?.id;
        if (!userId) return null;

        const [userPreferences, categoryPreferences] = await Promise.all([
            apiService.getShippingPreferences(userId),
            apiService.getCategoryShippingPreferences(categoryId)
        ]);

        const mode = chooseShippingMode(userPreferences, categoryPreferences);
        if (!mode) {
            console.log("SHIPPING: nenhum modo comum conta/categoria; publicação seguirá sem shipping explícito.");
            return null;
        }

        console.log("SHIPPING RESOLVIDO:", mode);
        return {
            mode,
            local_pick_up: false,
            free_shipping: false
        };
    } catch (error) {
        console.log("SHIPPING: não foi possível consultar preferências; publicação seguirá sem shipping explícito.");
        console.log(error.response?.data || error.message || error);
        return null;
    }
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
        conditionalAttributes: getConditionalRequired(publicationSpec),
        prediction: publicationSpec.prediction,
        overrides: attributeOverrides
    });

    if (resolved.missing.length) {
        throw missingError(resolved.missing);
    }

    // ======================================================
    // ETAPA 4 — SHIPPING + PAYLOAD + FOTOS
    // ======================================================
    const shipping = await resolveShipping(publicationSpec.category_id);

    // Faça uma validação de atributos sem enviar imagens. Isso também cobre
    // pendências condicionais descobertas pelo ML para imagens locais.
    const attributePreflight = await itemService.build(
        product,
        pictures,
        publicationSpec,
        attributeOverrides,
        shipping,
        { skipPictureUpload: true }
    );
    try {
        await apiService.validateItem(attributePreflight);
    } catch (error) {
        const missing = extractMissingFromValidation(error, publicationSpec);
        if (missing.length) {
            throw missingError(missing, "O Mercado Livre ainda exige estas informações.");
        }
        if (!isPictureOnlyValidationError(error)) throw error;
        // Sem imagens, a API pode reclamar apenas da ausência de fotos. Isso é
        // esperado no preflight; erros de rede ou outras validações bloqueiam.
    }

    const item = await itemService.build(
        product,
        pictures,
        publicationSpec,
        attributeOverrides,
        shipping
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
        if (missing.length) {
            throw missingError(missing, "O Mercado Livre ainda exige estas informações.");
        }

        if (isOnlyWarnings(error)) {
            console.log("VALIDAÇÃO MERCADO LIVRE: somente WARNINGS — não bloqueia publicação.");
            console.dir(extractValidationCauses(error), { depth: null });
            validation = { warnings: extractValidationCauses(error) };
        } else {
            throw error;
        }
    }

    console.log("VALIDAÇÃO MERCADO LIVRE: OK / WARNINGS NÃO BLOQUEANTES");
    console.dir(validation, { depth: null });

    if (item.pictures.some(picture => picture?.source)) {
        item.pictures = await itemService.uploadPictures(pictures);
    }

    // ======================================================
    // ETAPA 6 — PUBLICAÇÃO REAL
    // ======================================================
    const mlResponse = await apiService.publishItem(item);

    // O anúncio já existe no Mercado Livre. Registre o vínculo no banco
    // imediatamente, antes de qualquer etapa opcional (descrição).
    try {
        await mlProductService.savePublication(productId, mlResponse);
    } catch (persistError) {
        persistError.ml = mlResponse;
        throw persistError;
    }

    // A descrição é opcional e não pode desfazer/ocultar a publicação.
    let descriptionSaved = null;
    let descriptionError = null;

    if (product.description && product.description.trim().length > 0) {
        try {
            await apiService.createDescription(mlResponse.id, product.description);
            descriptionSaved = true;
        } catch (descriptionFailure) {
            descriptionSaved = false;
            descriptionError = descriptionFailure.response?.data || descriptionFailure.message;
            console.error("Anúncio criado, mas a descrição falhou:", descriptionError);
        }
    }

    console.log("========================================");
    console.log("ANÚNCIO PUBLICADO COM SUCESSO");
    console.log("ID:", mlResponse.id);
    console.log("STATUS:", mlResponse.status);
    console.log("DESCRIÇÃO:", descriptionSaved === null ? "não informada" : (descriptionSaved ? "ok" : "falhou"));
    console.log("========================================");

    return {
        success: true,
        ml: mlResponse,
        item,
        publication: {
            category_id: publicationSpec.category_id,
            category_name: publicationSpec.category.name,
            listing_type_id: publicationSpec.listing_type.id
        },
        description_saved: descriptionSaved,
        description_error: descriptionError
    };
};
