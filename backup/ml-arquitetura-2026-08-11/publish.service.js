console.log("### NOVO PUBLISH SERVICE EXECUTADO ###");

const productService = require("../productService");
const productImageService = require("../productImageService");
const itemService = require("./item.service");
const apiService = require("./api.service");
const mlProductService = require("./mlProduct.service");

module.exports.publish = async (productId) => {

    console.log("========================================");
    console.log("PUBLICANDO PRODUTO NO MERCADO LIVRE");
    console.log("Produto ID:", productId);
    console.log("========================================");

    const product = await productService.getById(productId);

    if (!product) {
        throw new Error("Produto não encontrado.");
    }

    const pictures = await productImageService.getByProductId(productId);

    if (!pictures || pictures.length === 0) {
        throw new Error("O produto não possui imagens.");
    }

    console.log(`Produto: ${product.title}`);
    console.log(`Fotos encontradas: ${pictures.length}`);

    // Apenas valida se existe token
    await apiService.getAccessToken();

    // Monta o payload do anúncio
    const item = await itemService.build(
        product,
        pictures
    );

    console.log("========== PAYLOAD MERCADO LIVRE ==========");
    console.log(JSON.stringify(item, null, 2));
    console.log("===========================================");

    let mlResponse;

    try {

        mlResponse = await apiService.publishItem(item);

    } catch (err) {

        console.log("========================================");
        console.log("FALHA AO PUBLICAR");
        console.log("========================================");

        throw err;

    }

    if (
        product.description &&
        product.description.trim().length > 0
    ) {

        console.log("Criando descrição...");

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
        item
    };

};