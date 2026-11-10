const path = require("path");
const fs = require("fs");
const ProductService = require("./productService");
const ProductImageService = require("./productImageService");
const localAI = require("./local-ai.service");
const { findCatalogMatch } = require("./catalog.service");
const mlApi = require("./ml/api.service");
const publicationSpecService = require("./ml/publicationSpec.service");
const attributeResolver = require("./ml/attributeResolver.service");
const shippingService = require("./ml/shipping.service");

function median(values) {
    const sorted = values.filter(value => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
    if (!sorted.length) return 0;
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function localImagePath(image) {
    const value = String(image?.original_url || "").trim();
    if (!value || /^https?:\/\//i.test(value)) return null;
    const relative = value.replace(/^\/+/, "");
    const full = path.resolve(__dirname, "../../", relative);
    const storageRoot = path.resolve(__dirname, "../../storage") + path.sep;
    if (!full.startsWith(storageRoot) || !fs.existsSync(full)) return null;
    return full;
}

async function researchUsedPrice(title, sellerId) {
    if (!title) return { price: 0, comparable_count: 0, basis: "missing_title" };
    try {
        const result = await mlApi.searchSiteItems(title, { condition: "used", limit: 30 });
        const rows = (Array.isArray(result?.results) ? result.results : [])
            .filter(item => item && item.condition === "used")
            .filter(item => Number(item.price) > 0)
            .filter(item => !sellerId || String(item.seller?.id || "") !== String(sellerId));
        const price = rows.length >= 3 ? median(rows.map(item => Number(item.price))) : 0;
        return {
            price: Math.round(price * 100) / 100,
            comparable_count: rows.length,
            basis: rows.length >= 3 ? "median_active_used_listings" : "insufficient_comparables"
        };
    } catch (error) {
        console.warn("[ListingPreparation] Pesquisa de preços indisponível:", error.message);
        return { price: 0, comparable_count: 0, basis: "search_unavailable" };
    }
}

async function prepare(productId, sellerObservation = "") {
    const product = await ProductService.getById(productId);
    if (!product) throw new Error("Produto não encontrado para preparação do anúncio.");
    const images = await ProductImageService.getByProductId(productId);
    const selected = (images || []).filter(image => image.selected_for_ml !== false)
        .sort((a, b) => Number(b.is_main) - Number(a.is_main) || Number(a.sort_order || 0) - Number(b.sort_order || 0));
    if (!selected.length) throw new Error("Produto sem fotos para análise.");
    const imagePath = localImagePath(selected[0]);
    if (!imagePath) throw new Error("A foto principal não está disponível em armazenamento local para análise automática.");

    const analysis = await localAI.analisarImagem(imagePath, null, sellerObservation);
    const identification = analysis.identification || {};
    let catalogMatch = null;
    try {
        catalogMatch = await findCatalogMatch({
            ...(analysis.catalog_input || {}),
            product_type: analysis.product_type || "",
            brand: analysis.brand || "",
            line: analysis.line || "",
            model: analysis.model || "",
            generation: analysis.generation || ""
        });
    } catch (error) {
        console.warn("[ListingPreparation] Catálogo auxiliar indisponível:", error.message);
    }

    const draft = await localAI.buildListing({
        identification,
        facts: analysis.facts || [],
        cross_check: analysis.cross_check || {},
        catalogMatch,
        sellerObservation
    });

    const title = String(draft.title || analysis.title || product.title || "").trim();
    const description = String(draft.description || analysis.description || sellerObservation || "").trim();
    const me = await mlApi.getMe();
    const priceResearch = await researchUsedPrice(title, me?.id);
    const suggestedPrice = priceResearch.price;

    let category = null;
    let categoryAttributes = [];
    let publicationSpec = null;
    let shipping = null;
    const effectivePrice = Number(suggestedPrice || product.sale_price || 0);
    const currentDraft = {
        ...product, title, description, sale_price: effectivePrice,
        condition: "used"
    };

    if (effectivePrice > 0) {
        try {
            // A preparação usa a mesma especificação oficial da publicação:
            // categoria folha, atributos e exigências condicionais do Mercado Livre.
            publicationSpec = await publicationSpecService.resolve(currentDraft);
            category = publicationSpec.category;
            categoryAttributes = publicationSpec.attributes || [];
            shipping = await shippingService.resolveShipping(mlApi, category.id);
        } catch (error) {
            console.warn("[ListingPreparation] Especificação oficial ainda pendente:", error.message);
        }
    }

    const attributes = {
        ...(product.ml_attributes && !Array.isArray(product.ml_attributes) ? product.ml_attributes : {}),
        ...(analysis.attributes || {}),
        _preparation: {
            condition: "used",
            category_id: category?.id || null,
            category_name: category?.name || null,
            price_research: priceResearch,
            analyzed_at: new Date().toISOString()
        }
    };
    let requiredMissing = [];
    if (category && publicationSpec) {
        try {
            const productForResolution = {
                ...currentDraft, ml_category_id: category.id, ml_attributes: attributes
            };
            const conditionalAttributes = publicationSpec.conditionalAttributes?.required_attributes || [];
            const requirePackageDimensions = shipping?.mode === "me2";
            const resolved = attributeResolver.build({
                product: productForResolution,
                categoryAttributes,
                conditionalAttributes,
                prediction: publicationSpec.prediction,
                requirePackageDimensions
            });
            requiredMissing = resolved.missing;
            for (const attribute of resolved.attributes) {
                attributes[attribute.id] = { value_id: attribute.value_id, value_name: attribute.value_name, value_struct: attribute.value_struct };
            }
        } catch (error) {
            console.warn("[ListingPreparation] Atributos condicionais aguardam revisão:", error.message);
        }
    }

    const updated = await ProductService.update(productId, {
        ...product,
        title,
        description,
        sale_price: suggestedPrice || product.sale_price || 0,
        product_type: analysis.product_type || product.product_type || "",
        brand: analysis.brand || product.brand || "",
        line: analysis.line || product.line || "",
        model: analysis.model || product.model || "",
        generation: analysis.generation || product.generation || "",
        version: analysis.version || product.version || "",
        color: analysis.color || product.color || "",
        condition: "used",
        ai_confidence: Number(analysis.confidence || 0),
        ml_attributes: attributes,
        ml_category_id: category?.id || product.ml_category_id || null
    });

    return {
        success: true,
        product: updated,
        preparation: {
            status: title && description ? "ready_for_review" : "needs_review",
            condition: "used",
            category_id: category?.id || null,
            category_name: category?.name || null,
            category_attributes_loaded: categoryAttributes.length,
            required_attributes_pending: requiredMissing,
            price_research: priceResearch,
            price_requires_manual_review: !suggestedPrice,
            publication_is_manual: true
        },
        analysis: {
            confidence: analysis.confidence || 0,
            facts: analysis.facts || [],
            hypotheses: analysis.hypotheses || [],
            unresolved: analysis.cross_check?.unresolved || [],
            contradictions: analysis.cross_check?.contradictions || []
        }
    };
}

module.exports = { prepare };
