console.log("### PUBLISH SERVICE — FLUXO OFICIAL ML ###");

const productService = require("../productService");
const productImageService = require("../productImageService");
const itemService = require("./item.service");
const apiService = require("./api.service");
const mlProductService = require("./mlProduct.service");
const publicationSpecService = require("./publicationSpec.service");
const attributeResolver = require("./attributeResolver.service");
const attributeRequirements = require("./attributeRequirements.service");
const similarPackageReference = require("./similarPackageReference.service");
const shippingService = require("./shipping.service");

function clean(value) {
    if (value === undefined || value === null) return "";
    return String(value).trim();
}

function getConditionalRequired(publicationSpec) {
    return attributeRequirements.getConditionalRequired(publicationSpec);
}

function isUsedProduct(product) {
    return String(product?.condition || "used").toLowerCase() !== "new";
}

function emptyGtinReasonDefinition(publicationSpec) {
    return (publicationSpec?.attributes || []).find(attribute =>
        attribute?.id === "EMPTY_GTIN_REASON" &&
        Array.isArray(attribute.values) &&
        attribute.values.length > 0
    ) || null;
}

function shouldOfferEmptyGtinReason(product, publicationSpec) {
    if (!isUsedProduct(product)) return false;

    const gtin = (publicationSpec?.attributes || []).find(attribute => attribute?.id === "GTIN");
    if (!gtin || gtin.tags?.required === true) return false;

    const isConditional = gtin.tags?.conditional_required === true ||
        getConditionalRequired(publicationSpec).some(attribute =>
            (typeof attribute === "string" ? attribute : attribute?.id) === "GTIN"
        );

    return isConditional && Boolean(emptyGtinReasonDefinition(publicationSpec));
}

function mapMissingIdsForUsedProduct(ids, product, publicationSpec) {
    if (!ids.includes("GTIN") || !shouldOfferEmptyGtinReason(product, publicationSpec)) {
        return ids;
    }

    return [...new Set(ids.map(id => id === "GTIN" ? "EMPTY_GTIN_REASON" : id))];
}

function publicationSpecForOverrides(publicationSpec, product, overrides) {
    const hasReason = Boolean(overrides?.EMPTY_GTIN_REASON?.value_id ||
        clean(overrides?.EMPTY_GTIN_REASON?.value_name));

    if (!hasReason || !shouldOfferEmptyGtinReason(product, publicationSpec)) {
        return publicationSpec;
    }

    const conditional = publicationSpec.conditionalAttributes || {};
    const required = getConditionalRequired(publicationSpec).filter(attribute =>
        (typeof attribute === "string" ? attribute : attribute?.id) !== "GTIN"
    );

    return {
        ...publicationSpec,
        conditionalAttributes: {
            ...(Array.isArray(conditional) ? {} : conditional),
            required_attributes: required
        }
    };
}

function extractMissingFromValidation(error, publicationSpec, product) {
    const ids = attributeRequirements.extractMissingIdsFromValidation(error);
    return attributeRequirements.buildMissing(
        publicationSpec,
        mapMissingIdsForUsedProduct(ids, product, publicationSpec)
    );
}

function extractValidationCauses(error) {
    return attributeRequirements.extractValidationCauses(error);
}

function isPictureOnlyValidationError(error) {
    const causes = extractValidationCauses(error);
    // Warnings from unrelated departments (for example, shipping) do not
    // invalidate the expected preflight response about missing pictures.
    const blockingCauses = causes.filter(cause =>
        String(cause?.type || "").toLowerCase() !== "warning"
    );
    return Number(error?.response?.status) === 400 &&
        blockingCauses.length > 0 &&
        blockingCauses.every(cause => String(cause?.code || "").toLowerCase().includes("picture"));
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


module.exports.publish = async (productId, attributeOverrides = {}) => {
    console.log("========================================");
    console.log("PUBLICANDO PRODUTO NO MERCADO LIVRE");
    console.log("Produto ID:", productId);
    console.log("========================================");

    const product = await productService.getById(productId);
    if (!product) throw new Error("Produto não encontrado.");

    // Valores informados manualmente têm prioridade sobre qualquer referência.
    const effectiveAttributeOverrides = { ...(attributeOverrides || {}) };

    const allPictures = await productImageService.getByProductId(productId);
    const pictures = (allPictures || [])
        .filter(picture => picture.selected_for_ml !== false)
        .sort((a, b) => Number(b.is_main) - Number(a.is_main) || Number(a.sort_order || 0) - Number(b.sort_order || 0));
    if (!pictures.length) throw new Error("Selecione ao menos uma imagem para publicar no Mercado Livre.");
    if (pictures.length > 10) throw new Error("O Mercado Livre permite no máximo 10 imagens por anúncio.");
    console.log(`[PublishPictures] Produto ${productId}: ${pictures.length} registro(s) de imagem.`);
    console.log("[PublishPictures] Origem dos registros:", pictures.map((picture, index) => ({
        index: index + 1,
        drive_file_id: Boolean(picture.drive_file_id),
        original_url: Boolean(picture.original_url),
        path: Boolean(picture.path),
        file_name: picture.file_name || null
    })));

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

    // Resolve a modalidade antes dos atributos: dimensões da embalagem
    // só entram como obrigatórias quando a logística escolhida for ME2.
    const shipping = await shippingService.resolveShipping(apiService, publicationSpec.category_id);
    const requirePackageDimensions = shipping?.mode === "me2";

    // ======================================================
    // REFERÊNCIA LOGÍSTICA — "VENDER UM IGUAL"
    // ======================================================
    try {
        const packageReference = await similarPackageReference.findPackageReference(
            product,
            publicationSpec.category_id
        );

        if (packageReference.found) {
            for (const [id, value] of Object.entries(packageReference.attributes)) {
                if (!effectiveAttributeOverrides[id]) {
                    effectiveAttributeOverrides[id] = value;
                }
            }
            console.log("[PackageReference] Dimensões encontradas em anúncio similar:", {
                source_item_id: packageReference.source_item_id,
                candidates_checked: packageReference.candidates_checked,
                references_found: packageReference.references_found
            });
        } else {
            console.log("[PackageReference] Sem referência logística confiável; usando estimativa de fallback quando disponível:", packageReference.reason);
        }
    } catch (referenceError) {
        // A pesquisa de referência é auxiliar: falha nela não interrompe
        // a publicação nem substitui as regras de validação do Mercado Livre.
        console.warn("[PackageReference] Falha não bloqueante:", referenceError.message);
    }

    // Para usados sem GTIN, a categoria pode permitir EMPTY_GTIN_REASON.
    // Nesse caso, o motivo oficial substitui a pendência condicional de GTIN.
    const buildSpec = publicationSpecForOverrides(
        publicationSpec,
        product,
        effectiveAttributeOverrides
    );

    // ======================================================
    // ETAPA 2 — RESOLVER ATRIBUTOS ANTES DE FAZER UPLOAD
    // ======================================================
    const resolved = attributeResolver.build({
        product,
        categoryAttributes: buildSpec.attributes,
        conditionalAttributes: getConditionalRequired(buildSpec),
        prediction: publicationSpec.prediction,
        overrides: effectiveAttributeOverrides,
        requirePackageDimensions
    });

    if (resolved.missing.length) {
        const missing = attributeRequirements.buildMissing(
            buildSpec,
            mapMissingIdsForUsedProduct(
                resolved.missing.map(attribute => attribute.id),
                product,
                publicationSpec
            )
        );
        throw missingError(missing);
    }

    // ======================================================
    // ETAPA 4 — PAYLOAD + FOTOS
    // ======================================================

    // Faça uma validação de atributos sem enviar imagens. Isso também cobre
    // pendências condicionais descobertas pelo ML para imagens locais.
    const attributePreflight = await itemService.build(
        product,
        pictures,
        buildSpec,
        effectiveAttributeOverrides,
        shipping,
        { skipPictureUpload: true, requirePackageDimensions }
    );
    try {
        await apiService.validateItem(attributePreflight);
    } catch (error) {
        const missing = extractMissingFromValidation(error, publicationSpec, product);
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
        buildSpec,
        effectiveAttributeOverrides,
        shipping,
        { requirePackageDimensions }
    );

    // O validador do Mercado Livre exige IDs reais de imagens, não URLs
    // temporárias em pictures[]. Faça o upload antes da validação final.
    const needsPictureUpload = item.pictures.some(picture => picture?.source);
    console.log(`[PublishPictures] Antes do upload final: ${item.pictures.length} entrada(s); upload necessário=${needsPictureUpload}.`);
    if (needsPictureUpload) {
        item.pictures = await itemService.uploadPictures(pictures);
    }
    if (!Array.isArray(item.pictures) || item.pictures.length === 0 || item.pictures.some(picture => !picture?.id)) {
        throw new Error(`Upload de fotos não produziu IDs válidos do Mercado Livre. Quantidade final: ${Array.isArray(item.pictures) ? item.pictures.length : 0}.`);
    }
    console.log(`[PublishPictures] Payload pronto: ${item.pictures.length} ID(s) de imagem do Mercado Livre.`);

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
        const missing = extractMissingFromValidation(error, publicationSpec, product);
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
