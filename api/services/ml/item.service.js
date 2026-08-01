const pictureService = require("./picture.service");

exports.build = async (product, pictures) => {

    const uploadedPictures = await pictureService.upload(
        pictures.map(p => ({
            source: p.original_url
        }))
    );

    return {

        title: product.title,

        category_id: product.category || "MLB1055",

        price: Number(product.sale_price),

        currency_id: "BRL",

        available_quantity: Number(product.quantity),

        buying_mode: "buy_it_now",

        listing_type_id: "gold_special",

        condition: "used",

        description: {
            plain_text: product.description
        },

        pictures: uploadedPictures

    };

};