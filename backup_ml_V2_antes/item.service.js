const pictureService = require("./picture.service");
const attributeResolver = require("./attributeResolver.service");

exports.build = async (product, pictures, publicationSpec, attributeOverrides = {}, shipping = null) => {
    if (!publicationSpec?.category_id) {
        throw new Error("Ficha de publicação do Mercado Livre não informada.");
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

    // Resolve todos os atributos ANTES de enviar fotos ao ML.
    const resolved = attributeResolver.build({
        product,
        categoryAttributes: publicationSpec.attributes,
        prediction: publicationSpec.prediction,
        overrides: attributeOverrides
    });

    if (resolved.missing.length) {
        const error = new Error("Informações obrigatórias pendentes para publicar.");
        error.code = "ML_MISSING_ATTRIBUTES";
        error.status = 422;
        error.missing = resolved.missing;
        error.attributes = resolved.attributes;
        throw error;
    }

    if (!pictures?.length) {
        throw new Error("O produto não possui imagens.");
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

    const familyName = String(product.title || "")
        .trim()
        .substring(0, Number(publicationSpec.category.settings?.max_title_length || 60));

    const item = {
        family_name: familyName,
        category_id: publicationSpec.category_id,
        price,
        currency_id: "BRL",
        available_quantity: quantity,
        buying_mode: "buy_it_now",
        listing_type_id: publicationSpec.listing_type.id,
        condition,
        pictures: uploadedPictures,
        attributes: resolved.attributes
    };

    if (shipping && shipping.mode) {
        item.shipping = {
            mode: shipping.mode,
            local_pick_up: Boolean(shipping.local_pick_up),
            free_shipping: Boolean(shipping.free_shipping)
        };
    }

    return item;
};
