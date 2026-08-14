console.log("### PUBLISH SERVICE — FLUXO OFICIAL ML ###");

const productService = require("../productService");
const productImageService = require("../productImageService");
const itemService = require("./item.service");
const apiService = require("./api.service");
const mlProductService = require("./mlProduct.service");
const publicationSpecService = require("./publicationSpec.service");

function assertConditionalAttributes(item, conditional) {
    const required = Array.isArray(conditional?.required_attributes)
        ? conditional.required_attributes
        : [];

    if (!required.length) return;

    const present = new Set((item.attributes || []).map(attribute => attribute.id));
    const missing = required.filter(attribute => !present.has(attribute.id));

    if (missing.length) {
        throw new Error(
            "Mercado Livre marcou atributos condicionais como obrigatórios e eles não foram preenchidos: " +
            missing.map(attribute => `${attribute.id} (${attribute.name || "sem nome"})`).join(", ")
        );
    }
}

module.exports.publish = async (productId) => {

    console.log("========================================");
    console.log("PUBLICANDO PRODUTO NO MERCADO LIVRE");
    console.log("Produto ID:", productId);
    console.log("========================================");

    const product = await productService.getById(productId);

    if (!product) throw new Error("Produto não encontrado.");

    const pictures = await productImageService.getByProductId(productId);

    if (!pictures || pictures.length === 0) {
        throw new Error("O produto não possui imagens.");
    }

    console.log(`Produto: ${product.title}`);
    console.log(`Fotos encontradas: ${pictures.length}`);

    await apiService.getAccessToken();

    // ======================================================
    // ETAPA 1 — CATEGORIZAÇÃO OFICIAL
    // ======================================================

    const publicationSpec = await publicationSpecService.resolve(product);

    console.log("========== CATEGORIA RESOLVIDA ==========");
    console.log("Categoria:", publicationSpec.category_id);
    console.log("Nome:", publicationSpec.category.name);
    console.log("Listing type:", publicationSpec.listing_type.id);
    console.log("==========================================");

    // ======================================================
    // ETAPA 2 — PAYLOAD BASE + ATRIBUTOS DINÂMICOS
    // ======================================================

    const item = await itemService.build(
        product,
        pictures,
        publicationSpec
    );

    console.log("========== PAYLOAD MERCADO LIVRE ==========");
    console.log(JSON.stringify(item, null, 2));
    console.log("===========================================");

    // ======================================================
    // ETAPA 3 — ATRIBUTOS CONDICIONAIS
    // ======================================================

    const conditional = await apiService.getConditionalAttributes(
        publicationSpec.category_id,
        item
    );

    assertConditionalAttributes(item, conditional);

    // ======================================================
    // ETAPA 4 — VALIDADOR OFICIAL
    // ======================================================

    console.log("VALIDANDO PAYLOAD NO MERCADO LIVRE...");

    const validation = await apiService.validateItem(item);

    console.log("VALIDAÇÃO MERCADO LIVRE: OK");
    console.dir(validation, { depth: null });

    // ======================================================
    // ETAPA 5 — PUBLICAÇÃO REAL
    // ======================================================

    const mlResponse = await apiService.publishItem(item);

    if (
        product.description &&
        product.description.trim().length > 0
    ) {
        await apiService.createDescription(
            mlResponse.id,
            product.description
        );
    }

    await mlProductService.savePublication(
        productId,
        mlResponse
    );

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
