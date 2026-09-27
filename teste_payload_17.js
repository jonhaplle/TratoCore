require("dotenv").config();

const productService = require("./api/services/productService");
const productImageService = require("./api/services/productImageService");
const itemService = require("./api/services/ml/item.service");

async function main() {
    try {
        console.log("========================================");
        console.log("TESTE DE PAYLOAD - PRODUTO 17");
        console.log("========================================");

        const product = await productService.getById(17);

        if (!product) {
            throw new Error("Produto 17 não encontrado.");
        }

        console.log("Produto encontrado:");
        console.log({
            id: product.id,
            title: product.title,
            brand: product.brand,
            model: product.model,
            category: product.category,
            condition: product.condition,
            color: product.color,
            ml_category_id: product.ml_category_id,
            ml_listing_type: product.ml_listing_type
        });

        const pictures =
            await productImageService.getByProductId(17);

        console.log("");
        console.log("Quantidade de imagens:", pictures.length);

        if (!pictures.length) {
            throw new Error("Produto 17 não possui imagens.");
        }

        const item = await itemService.build(
            product,
            pictures
        );

        console.log("");
        console.log("========================================");
        console.log("PAYLOAD FINAL");
        console.log("========================================");

        console.dir(item, {
            depth: null
        });

        console.log("");
        console.log("========================================");
        console.log("ATRIBUTOS");
        console.log("========================================");

        console.table(item.attributes);

        console.log("");
        console.log("========================================");
        console.log("TESTE CONCLUÍDO - NÃO PUBLICADO");
        console.log("========================================");

    } catch (error) {

        console.log("");
        console.log("========================================");
        console.log("ERRO NO TESTE");
        console.log("========================================");

        console.error(
            error.response?.data ||
            error.message ||
            error
        );

        process.exitCode = 1;
    }
}

main();