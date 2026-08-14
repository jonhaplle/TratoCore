const pictureService = require("./picture.service");
const attributeResolver = require("./attributeResolver.service");

exports.build = async (product, pictures, publicationSpec) => {
    if (!publicationSpec?.category_id) {
        throw new Error("Ficha de publicação do Mercado Livre não informada.");
    }

    const uploadedPictures = await pictureService.upload(
        pictures.map(p => ({
            source: p.original_url || p.source || p.path,
            path: p.path
        }))
    );

    if (!uploadedPictures.length) {
        throw new Error("Nenhuma imagem válida foi enviada.");
    }

    if (!product.title || !product.title.trim()) {
        throw new Error("Produto sem título.");
    }

    const price = Number(product.sale_price);
    if (isNaN(price) || price <= 0) throw new Error("Preço inválido.");

    const quantity = Math.max(1, Number(product.quantity || 1));
    const condition =
        String(product.condition || "used").toLowerCase() === "new"
            ? "new"
            : "used";

    const resolved = attributeResolver.build({
        product,
        categoryAttributes: publicationSpec.attributes,
        prediction: publicationSpec.prediction
    });

    if (resolved.missing.length) {
        const missing = resolved.missing.map(item => item.id).join(", ");
        throw new Error(
            `A categoria ${publicationSpec.category_id} exige atributos que o produto ainda não possui: ${missing}. ` +
            "Preencha os atributos antes de publicar."
        );
    }

    const familyName = String(product.title || "")
        .trim()
        .substring(0, Number(publicationSpec.category.settings?.max_title_length || 60));

    return {
        family_name: familyName,
        category_id: publicationSpec.category_id,
        price,
        currency_id: "BRL",
        available_quantity: quantity,
        buying_mode: "buy_it_now",
        listing_type_id: publicationSpec.listing_type.id,
        condition,
        pictures: uploadedPictures,
        shipping: {
            mode: "me2",
            local_pick_up: false,
            free_shipping: false,
            free_methods: []
        },
        attributes: resolved.attributes
    };
};
