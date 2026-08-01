console.log("### NOVO PUBLISH SERVICE EXECUTADO ###");

const productService = require("../productService");
const productImageService = require("../productImageService");
const itemService = require("./item.service");

module.exports.publish = async (productId) => {

    const product = await productService.getById(productId);

    if (!product) {
        throw new Error("Produto não encontrado.");
    }

    const pictures = await productImageService.getByProductId(productId);

    const item = await itemService.build(product, pictures);

    return {

        success: true,

        product,

        pictures,

        item

    };

};