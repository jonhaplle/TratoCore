// ======================================================
// TRATOCORE — PUBLICAÇÃO DO ANÚNCIO PELO VENDEDOR
// ======================================================
//
// Executa a publicação de um produto JÁ APROVADO na tela de revisão:
//
//   1. resolve a categoria oficial e os atributos exigidos;
//   2. monta o payload do anúncio;
//   3. valida no Mercado Livre (/items/validate) quando o vendedor pede;
//   4. envia as fotos (somente nesse passo, depois da validação);
//   5. cria o anúncio (/items) e grava o vínculo no banco;
//   6. grava a descrição (opcional, não desfaz a publicação).
//
// Apoio ao desenvolvimento: dryRun faz os passos 1 a 2 sem enviar fotos e
// sem criar anúncio. Nunca publica nada em dryRun.

const productService = require("../productService");
const productImageService = require("../productImageService");
const itemService = require("../ml/item.service");
const apiService = require("../ml/api.service");
const tokenService = require("../ml/token.service");
const mlProductService = require("../ml/mlProduct.service");
const attributeRequirements = require("../ml/attributeRequirements.service");

function clean(value) {
    return String(value ?? "").trim();
}

function isPictureOnlyValidationError(error) {
    const causes = attributeRequirements.extractValidationCauses(error);
    return Number(error?.response?.status) === 400 &&
        causes.length > 0 &&
        causes.every(cause => String(cause?.code || "").toLowerCase().includes("picture"));
}

function isOnlyWarnings(error) {
    const causes = attributeRequirements.extractValidationCauses(error);
    return causes.length > 0 && causes.every(cause =>
        String(cause?.type || "").toLowerCase() === "warning"
    );
}

function missingError(missing, message, suggestions = []) {
    const error = new Error(message || "Informações obrigatórias pendentes para publicar.");
    error.code = "ML_MISSING_ATTRIBUTES";
    error.status = 422;
    error.missing = missing;
    error.suggestions = suggestions;
    return error;
}

/**
 * Converte a decisão da revisão (attributeOverrides) para a lista de
 * sobreposições que o item.service espera: [{ id, value_id | value_name | value_struct }].
 */
function normalizeOverrides(attributeOverrides) {
    const list = [];

    if (Array.isArray(attributeOverrides)) {
        for (const item of attributeOverrides) {
            if (!item?.id) continue;
            const entry = { id: clean(item.id) };
            if (item.value_id !== undefined && item.value_id !== null && clean(item.value_id)) {
                entry.value_id = clean(item.value_id);
            }
            if (item.value_struct?.number != null && item.value_struct?.unit) {
                entry.value_struct = {
                    number: Number(item.value_struct.number),
                    unit: clean(item.value_struct.unit)
                };
            } else if (item.value_name !== undefined) {
                entry.value_name = clean(item.value_name);
            }
            if (entry.value_id || entry.value_name || entry.value_struct) list.push(entry);
        }
        return list;
    }

    if (attributeOverrides && typeof attributeOverrides === "object") {
        for (const [id, value] of Object.entries(attributeOverrides)) {
            if (value === undefined || value === null || clean(value) === "") continue;

            if (typeof value === "object") {
                const entry = { id: clean(id) };
                if (value.value_id) entry.value_id = clean(value.value_id);
                if (value.value_struct?.number != null && value.value_struct?.unit) {
                    entry.value_struct = {
                        number: Number(value.value_struct.number),
                        unit: clean(value.value_struct.unit)
                    };
                } else if (value.value_name !== undefined) {
                    entry.value_name = clean(value.value_name);
                }
                if (entry.value_id || entry.value_name || entry.value_struct) list.push(entry);
            } else {
                list.push({ id: clean(id), value_name: clean(value) });
            }
        }
    }

    return list;
}

/**
 * @param {object} params
 * @param {string|number} params.productId
 * @param {object[]|object} [params.attributeOverrides] valores confirmados na revisão
 * @param {boolean} [params.dryRun]                      não envia fotos nem cria anúncio
 * @param {object} [params.publicationSpec]              ficha já resolvida (evita consultar de novo)
 * @param {boolean} [params.skipValidation]              pula /items/validate
 */
async function publishSellerListing({
    productId,
    attributeOverrides = [],
    dryRun = false,
    publicationSpec = null,
    skipValidation = false
} = {}) {
    const product = await productService.getById(productId);
    if (!product) {
        const error = new Error("Produto não encontrado.");
        error.status = 404;
        throw error;
    }

    if (product.ml_item_id) {
        const error = new Error(
            `Este produto já está publicado no Mercado Livre (${product.ml_item_id}).`
        );
        error.status = 409;
        error.ml = {
            id: product.ml_item_id,
            permalink: product.ml_permalink,
            status: product.ml_status
        };
        throw error;
    }

    const pictures = await productImageService.getByProductId(productId);
    if (!pictures || !pictures.length) {
        const error = new Error("O produto não possui fotos. Envie as fotos antes de publicar.");
        error.status = 422;
        error.code = "ML_MISSING_PICTURES";
        throw error;
    }

    await apiService.getAccessToken();

    const spec = publicationSpec || await require("../ml/publicationSpec.service").resolve(product);
    const overrides = normalizeOverrides(attributeOverrides);

    // Monta o payload sem enviar fotos. O item.service já lança
    // ML_MISSING_ATTRIBUTES quando falta algo que o ML exige.
    const item = await itemService.build(
        product,
        pictures,
        spec,
        overrides,
        null,
        { skipPictureUpload: true }
    );

    if (dryRun) {
        return {
            success: true,
            dryRun: true,
            published: false,
            item,
            product_id: product.id,
            category: {
                id: spec.category_id,
                name: spec.category?.name || ""
            },
            listing_type_id: spec.listing_type?.id || null,
            attribute_count: (item.attributes || []).length,
            picture_count: pictures.length
        };
    }

    // Validação oficial antes de qualquer upload.
    let validation = null;

    if (!skipValidation) {
        try {
            validation = await apiService.validateItem(item);
        } catch (error) {
            const missing = attributeRequirements.buildMissing(
                spec.attributes,
                attributeRequirements.extractMissingIdsFromValidation(error)
            );

            if (missing.length) {
                throw missingError(missing, "O Mercado Livre ainda exige estas informações.");
            }

            if (isOnlyWarnings(error)) {
                validation = { warnings: attributeRequirements.extractValidationCauses(error) };
            } else if (isPictureOnlyValidationError(error)) {
                // Sem fotos no payload, o ML reclama apenas da ausência delas.
                validation = { notes: "Validação sem fotos: o Mercado Livre exige ao menos uma imagem." };
            } else {
                throw error;
            }
        }
    }

    // Envia as fotos agora (a validação de atributos já passou).
    item.pictures = await itemService.uploadPictures(pictures);

    const mlResponse = await apiService.publishItem(item);

    try {
        await mlProductService.savePublication(productId, mlResponse);
    } catch (persistError) {
        persistError.ml = mlResponse;
        throw persistError;
    }

    let descriptionSaved = null;
    let descriptionError = null;

    if (clean(product.description)) {
        try {
            await apiService.createDescription(mlResponse.id, product.description);
            descriptionSaved = true;
        } catch (error) {
            descriptionSaved = false;
            descriptionError = error.response?.data || error.message;
        }
    }

    return {
        success: true,
        dryRun: false,
        published: true,
        product_id: product.id,
        ml: mlResponse,
        validation,
        category: {
            id: spec.category_id,
            name: spec.category?.name || ""
        },
        listing_type_id: spec.listing_type?.id || null,
        description_saved: descriptionSaved,
        description_error: descriptionError,
        attributes_sent: (item.attributes || []).map(attribute => attribute.id)
    };
}

module.exports = {
    publishSellerListing,
    normalizeOverrides
};
