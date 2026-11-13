// ======================================================
// TRATOCORE — FLUXO DE ANÚNCIO DO VENDEDOR
// ======================================================
//
// Orquestra o caminho completo:
//
//   fotos + observação -> identificação -> pesquisa técnica -> atributos
//   -> preço -> título -> descrição -> revisão -> publicação
//
// `buildReview` nunca publica nada: apenas monta o pacote que a tela única
// apresenta ao vendedor. `publish` só roda depois da aprovação explícita.

const productService = require("../productService");
const productImageService = require("../productImageService");
const apiService = require("../ml/api.service");
const publicationSpecService = require("../ml/publicationSpec.service");
const attributeRequirements = require("../ml/attributeRequirements.service");
const priceReference = require("../ml/priceReference.service");

const identificationVendedor = require("./identificationVendedor.service");
const listingCopy = require("./listingCopy.service");
const attributeRequirementsVendedor = require("./attributeRequirementsVendedor.service");
const { getCatalogEntry, getReferencePrice } = require("./productCatalog.service");
const { publishSellerListing, normalizeOverrides } = require("./publishVendedor.service");

const DEFAULT_MAX_TITLE = 60;
const DEFAULT_QUANTITY = 1;

function clean(value) {
    return String(value ?? "").trim();
}

function toMoney(value) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return null;
    return Math.round(number * 100) / 100;
}

function conditionFrom(input) {
    const text = clean(input).toLowerCase();
    if (text === "new" || text === "novo") return "new";
    if (text === "used" || text === "usado") return "used";
    return "";
}

/**
 * Converte erro (string, Error ou resposta do Mercado Livre) em texto curto
 * para exibir ao vendedor.
 */
function normalizeErrorMessage(error) {
    if (!error) return "";

    if (typeof error === "string") return error;

    if (error instanceof Error) return error.message;

    if (typeof error === "object") {
        if (typeof error.message === "string") return error.message;

        if (Array.isArray(error.cause) && error.cause.length) {
            return error.cause
                .map(cause => clean(cause?.message || cause?.code || ""))
                .filter(Boolean)
                .join("; ");
        }

        try {
            return JSON.stringify(error).slice(0, 280);
        } catch (_) {
            return "Erro ao resolver a categoria.";
        }
    }

    return String(error);
}

// ======================================================
// DESEMPATE DE CATEGORIA
// ======================================================

const ACCESSORY_CATEGORY = /bateria|acess[oó]rio|pe[cç]a|capa|pel[ií]cula|carregador|suporte|reparo|adaptador|fonte|cabo|controle/i;

// Quando o PRÓPRIO produto é um acessório, a categoria de acessório está certa.
const ACCESSORY_PRODUCT = /bateria|carregador|acess[oó]rio|pe[cç]a|capa|pel[ií]cula|suporte|reparo|cabo|fonte|adaptador|protetor|compat[ií]vel/i;

/**
 * O preditor do Mercado Livre já devolveu categoria de bateria para um
 * celular. Quando a primeira previsão é de acessório/peça e o produto não
 * é um acessório, usamos a próxima previsão que descreva o produto.
 */
function pickCategoryPrediction(predictions = [], productInfo = {}) {
    if (!Array.isArray(predictions) || !predictions.length) return null;

    const first = predictions[0];
    const firstName = `${first.category_name || ""} ${first.domain_name || ""}`;

    if (!ACCESSORY_CATEGORY.test(firstName)) return first;

    const productText = `${productInfo.product_type || ""} ${productInfo.model || ""} ${productInfo.title || ""}`;
    if (ACCESSORY_PRODUCT.test(productText)) return first;

    const alternative = predictions.find(candidate =>
        candidate && !ACCESSORY_PRODUCT.test(`${candidate.category_name || ""} ${candidate.domain_name || ""}`)
    );

    if (alternative) {
        alternative._replaced_from = first.category_id;
        alternative._replaced_reason =
            `A previsão inicial era categoria de acessório/peça (${first.category_name}); ` +
            `paremos na categoria do produto (${alternative.category_name}). Confira na revisão.`;
        return alternative;
    }

    first._warning =
        `O Mercado Livre sugeriu a categoria "${first.category_name}", que é de acessório/peça. ` +
        "Confira se a categoria corresponde ao produto.";
    return first;
}

/**
 * Junta o que vem da identificação com o que o vendedor confirmou/ajustou.
 * O vendedor sempre vence.
 */
function mergeIdentification(identification = {}, overrides = {}) {
    const merged = { ...identification };

    for (const field of ["brand", "line", "model", "version", "capacity", "color", "manufacturer", "product_type", "gtin"]) {
        const value = clean(overrides[field]);
        if (value) merged[field] = value;
    }

    return merged;
}

/**
 * Nome do produto declarado pelo vendedor na primeira oração da observação
 * ("Dados RPG Kit com 7 dados verdes, usados..." -> "Dados RPG Kit com 7
 * dados verdes"). Só é usado para LOCALIZAR a categoria; não vira título.
 */
function extractDeclaredName(observation) {
    const text = clean(observation);
    if (!text) return "";

    const firstClause = text.split(/[,;\n.]/)[0];
    const cleanedText = firstClause
        .replace(/^(?:marca|brand|modelo|model)\s*[:=-]\s*/i, "")
        .replace(/\b(?:usado|usada|novo|nova|seminovo|lacrado)\b/gi, "")
        .replace(/\s+/g, " ")
        .trim();

    return cleanedText.length >= 8 ? cleanedText.slice(0, 80) : "";
}

/**
 * Decide qual preço entra no payload, deixando claro de onde ele veio.
 */
function resolvePrice({ identification, condition, overrides, reference }) {
    const explicit = toMoney(overrides.sale_price || overrides.price);

    if (explicit) {
        return {
            value: explicit,
            origin: "seller",
            explanation: ["Preço informado pelo vendedor."]
        };
    }

    if (reference?.suggested) {
        return {
            value: reference.suggested,
            origin: reference.is_estimate ? "estimate" : "market",
            explanation: reference.explanation || []
        };
    }

    const curated = getReferencePrice(identification);
    if (curated) {
        return {
            value: Math.round(((curated.min + curated.max) / 2) * 100) / 100,
            origin: "curated_range",
            min: curated.min,
            max: curated.max,
            explanation: [
                `Sem busca de concorrência disponível para este produto. ` +
                `Faixa de mercado cadastrada para ${curated.label}: R$ ${curated.min.toFixed(2)} a R$ ${curated.max.toFixed(2)}.`,
                "Valor sugerido é o meio da faixa — ajuste conforme conservação, acessórios e urgência de venda."
            ]
        };
    }

    return {
        value: null,
        origin: "none",
        explanation: ["Informe o preço de venda."]
    };
}

async function loadProductInputs(productId) {
    const product = await productService.getById(productId);
    if (!product) {
        const error = new Error("Produto não encontrado.");
        error.status = 404;
        throw error;
    }

    const pictures = await productImageService.getByProductId(productId);

    return { product, pictures };
}

/**
 * Monta o pacote completo de revisão do anúncio.
 *
 * @param {object} params
 * @param {string|number} [params.productId]  produto já fotografado
 * @param {object}   [params.identification]  identificação manual/confirmada
 * @param {string}   [params.sellerObservation]
 * @param {object}   [params.overrides]       { title, description, sale_price, condition, brand, model, ... }
 * @param {object}   [params.attributeOverrides] atributos confirmados
 * @param {boolean}  [params.skipAi]
 * @param {boolean}  [params.skipPrice]
 */
async function buildReview({
    productId = null,
    identification = {},
    sellerObservation = "",
    overrides = {},
    attributeOverrides = {},
    images = null,
    skipAi = false,
    skipPrice = false
} = {}) {
    const context = productId ? await loadProductInputs(productId) : { product: null, pictures: [] };
    const { product } = context;

    const pictures = Array.isArray(images) && images.length
        ? images
        : context.pictures;

    const observation = clean(sellerObservation || overrides.seller_observation || product?.seller_observation || "");

    // ------------------------------------------------------------------
    // 1. IDENTIFICAÇÃO
    // ------------------------------------------------------------------
    let identified;

    if (skipAi) {
        identified = {
            identification: {},
            seller: identificationVendedor.parseSellerDeclarations(observation),
            evidence: [],
            hypotheses: [],
            questions: [],
            confidence: { score: 0, level: "LOW" },
            images: { supplied: pictures.length, analyzed: 0 },
            ai: { ok: false, error: "análise visual desativada nesta chamada" },
            warnings: []
        };
    } else {
        identified = await identificationVendedor.identify({
            images: pictures,
            imageUrl: overrides.imageUrl || "",
            sellerObservation: observation
        });
    }

    const identificationMerged = mergeIdentification(
        {
            ...(product ? {
                brand: product.brand,
                model: product.model,
                line: product.line,
                version: product.version,
                color: product.color,
                product_type: product.product_type
            } : {}),
            ...identified.identification
        },
        {
            // Campos vazios do vendedor/produto não sobrescrevem a identificação.
            brand: clean(overrides.brand),
            model: clean(overrides.model),
            capacity: clean(overrides.capacity),
            color: clean(overrides.color),
            line: clean(overrides.line),
            version: clean(overrides.version)
        }
    );

    // ------------------------------------------------------------------
    // 2. PESQUISA TÉCNICA (catálogo curado) — hipóteses explícitas
    // ------------------------------------------------------------------
    const catalogEntry = getCatalogEntry(identificationMerged);
    const research = catalogEntry ? {
        matched: true,
        label: catalogEntry.label,
        source: "Base interna de modelos (padrões de linha)",
        note: catalogEntry._reason,
        observations: ["Confirme no aparelho, na caixa ou na nota fiscal antes de publicar."]
    } : {
        matched: false,
        label: "",
        source: "",
        note: "Modelo não encontrado na base interna. Os atributos serão preenchidos apenas com evidência.",
        observations: []
    };

    // ------------------------------------------------------------------
    // 3. PREÇO (antes da categoria: o Mercado Livre recusa anúncio sem preço
    //    e o preço muda a resposta condicional de atributos)
    // ------------------------------------------------------------------
    const condition = conditionFrom(overrides.condition)
        || identified.seller.condition
        || conditionFrom(product?.condition)
        || "";

    const validSalePrice = toMoney(overrides.sale_price) || toMoney(product?.sale_price);

    // O estado é obrigatório para comparar preços de forma honesta: sem
    // "novo" ou "usado" a referência mistura as duas coisas.
    let reference = null;

    if (!skipPrice && condition) {
        try {
            reference = await priceReference.reference({
                identification: {
                    ...identificationMerged,
                    title: clean(overrides.title) || clean(product?.title) || listingCopy.buildTitle({
                        identification: identificationMerged,
                        condition
                    })
                },
                condition,
                query: overrides.price_query || "",
                categoryId: ""
            });
        } catch (error) {
            reference = {
                suggested: null,
                warning: `Falha ao consultar referências de preço: ${error.message}`,
                explanation: [],
                sources: []
            };
        }
    }

    const price = resolvePrice({
        identification: identificationMerged,
        condition,
        overrides: { ...overrides, sale_price: validSalePrice },
        reference
    });

    // ------------------------------------------------------------------
    // 4. CATEGORIA + ATRIBUTOS OFICIAIS
    // ------------------------------------------------------------------
    // A descrição NÃO vem do cadastro. A descrição gravada no produto pode ter
    // sido escrita em outra época (ou por uma IA anterior) e afirmar
    // características que o vendedor não confirmou agora. O Vendedor
    // Automático só aceita:
    //   1) o texto que o vendedor escreveu explicitamente nesta revisão, ou
    //   2) a descrição montada a partir de evidências verificadas (abaixo).
    const descriptionFromReview = clean(overrides.description);

    const draftProduct = {
        title: clean(overrides.title) || clean(product?.title) || listingCopy.buildTitle({
            identification: identificationMerged,
            condition: condition || "used"
        }),
        description: descriptionFromReview,
        sale_price: validSalePrice || price.value || 0,
        quantity: Math.max(1, Number(overrides.quantity || product?.quantity || DEFAULT_QUANTITY)),
        condition: condition || "used",
        brand: identificationMerged.brand,
        model: identificationMerged.model,
        line: identificationMerged.line,
        color: identificationMerged.color,
        gtin: identificationMerged.gtin,
        ml_listing_type: overrides.listing_type_id || product?.ml_listing_type || undefined
    };

    let spec = null;
    let specError = null;
    let categoryNote = null;

    // A categoria é resolvida com um título DESCRITIVO (marca + modelo +
    // variante), nunca com o título de uso interno ("TESTE ..."), que o
    // preditor do Mercado Livre não reconhece. Sem marca/modelo, usamos o
    // nome do produto declarado pelo vendedor na observação.
    const descriptiveTitle = listingCopy.buildTitle({
        identification: identificationMerged,
        condition: condition || "used",
        maxLength: DEFAULT_MAX_TITLE,
        fallback: `${identificationMerged.product_type || ""} ${identificationMerged.model || ""}`.trim()
    });

    // O vendedor pode já ter um título comercial no cadastro. Ele só entra
    // como termo de categorização quando é descritivo (tem marca/modelo ou
    // não parece um nome interno de teste).
    const registerTitle = clean(product?.title);
    const registerTitleUsable = registerTitle.length >= 8 &&
        !/\bteste\b|\bnao apagar\b|\bteste e2e\b/i.test(registerTitle);

    const sellerDeclaredName = extractDeclaredName(observation);

    const categoryTitle = clean(overrides.category_query) ||
        sellerDeclaredName ||
        (registerTitleUsable ? registerTitle : "") ||
        descriptiveTitle ||
        draftProduct.title;

    const categoryProduct = {
        ...draftProduct,
        // Categoria escolhida na revisão tem prioridade (correção manual).
        category_id: clean(overrides.ml_category_id) || undefined,
        title: categoryTitle
    };

    const requestedCategoryId = clean(overrides.ml_category_id);

    if (draftProduct.sale_price > 0) {
        try {
            spec = await publicationSpecService.resolve(categoryProduct);
            // Desempate de categoria: o preditor pode cair em acessório/peça.
            const chosen = pickCategoryPrediction(spec.predictions || [], identificationMerged);
            let finalSpec = spec;

            if (chosen && chosen.category_id && chosen.category_id !== spec.category_id && chosen.requested_by_review) {
                finalSpec = await publicationSpecService.resolve({
                    ...draftProduct,
                    category_id: chosen.category_id,
                    ml_category_id: chosen.category_id
                });
            }

            // Pergunta limpa para o preditor: título descritivo sem palavras
            // que confundem a classificação ("teste", "promoção", etc.).
            if (ACCESSORY_CATEGORY.test(`${finalSpec.category?.name || ""}`)) {
                const cleanTitle = listingCopy.buildTitle({
                    identification: identificationMerged,
                    condition: condition || "used",
                    maxLength: Number(finalSpec.category?.settings?.max_title_length) || DEFAULT_MAX_TITLE,
                    fallback: draftProduct.title
                });

                if (cleanTitle && cleanTitle !== draftProduct.title) {
                    try {
                        const cleanSpec = await publicationSpecService.resolve({
                            ...draftProduct,
                            title: cleanTitle
                        });

                        if (!ACCESSORY_CATEGORY.test(`${cleanSpec.category?.name || ""}`)) {
                            finalSpec = cleanSpec;
                            categoryNote =
                                `"${draftProduct.title}" levou o Mercado Livre a uma categoria de acessório; ` +
                                `usando "${cleanTitle}" a categoria correta é ${cleanSpec.category?.name}. ` +
                                "Revise o título.";
                        }
                    } catch (_) {
                        // Mantém a categoria encontrada.
                    }
                }
            }

            spec = finalSpec;
            categoryNote = categoryNote || chosen?._replaced_reason || chosen?._warning || null;
        } catch (error) {
            specError = error.response?.data || error.message;
        }

        // Categoria digitada/escolhida pelo vendedor que não pôde ser usada:
        // ele precisa saber disso, mesmo que o preditor tenha encontrado outra.
        if (requestedCategoryId && (!spec || spec.category_id !== requestedCategoryId)) {
            categoryNote = `Não foi possível usar a categoria ${requestedCategoryId}. ` +
                (spec
                    ? `Mantida a categoria sugerida: ${spec.category_id} - ${spec.category?.name || ""}.`
                    : "Escolha outra categoria na lista.");
        }
    } else {
        specError = "Informe o preço para consultar a categoria oficial e os atributos do Mercado Livre.";
    }

    const maxTitleLength = Number(spec?.category?.settings?.max_title_length) || DEFAULT_MAX_TITLE;

    // ------------------------------------------------------------------
    // 5. TÍTULO E DESCRIÇÃO
    // ------------------------------------------------------------------
    const titleReview = listingCopy.reviewTitle(
        draftProduct.title,
        { maxLength: maxTitleLength, identification: identificationMerged, condition: condition || "used" }
    );

    // A descrição comercial é montada SOMENTE com o que foi verificado:
    // identificação visual, observação do vendedor e características
    // comprovadas. O cadastro não é fonte (ver bloco 4).
    const description = descriptionFromReview
        || listingCopy.buildDescription({
            identification: identificationMerged,
            condition,
            working: identified.seller.working,
            accessories: identified.seller.accessories,
            defects: identified.seller.defects,
            features: identified.identification.features
        });

    // Texto antigo do cadastro é apenas informado ao vendedor — nunca usado.
    const legadoIgnorado = clean(product?.description) && clean(product?.description) !== description;

    // ------------------------------------------------------------------
    // 6. ATRIBUTOS EXIGIDOS
    // ------------------------------------------------------------------
    let requirements = null;

    if (spec) {
        const definitions = attributeRequirements.classifyDefinitions(
            spec.attributes,
            spec.conditionalAttributes
        );

        requirements = attributeRequirementsVendedor.buildRequirements({
            definitions,
            identification: identificationMerged,
            seller: identified.seller,
            overrides: {
                ...attributeOverrides,
                ITEM_CONDITION: condition ? (condition === "new" ? "Novo" : "Usado") : attributeOverrides.ITEM_CONDITION
            }
        });
    }

    // ------------------------------------------------------------------
    // 7. QUESTÕES PENDENTES
    // ------------------------------------------------------------------
    const questions = [...identified.questions];

    if (!condition) {
        questions.push({
            field: "condition",
            question: "O produto é novo ou usado?",
            options: [{ value: "new", label: "Novo" }, { value: "used", label: "Usado" }]
        });
    }

    for (const pending of requirements?.pending || []) {
        questions.push({
            field: `attribute:${pending.id}`,
            question: `Informe ${pending.name} (exigido pelo Mercado Livre).`,
            options: (pending.values || []).map(value => ({ value: value.id, label: value.name })),
            attribute_id: pending.id
        });
    }

    if (!price.value) {
        questions.push({ field: "sale_price", question: "Qual é o preço de venda?", options: [] });
    }

    if (!pictures.length) {
        questions.push({ field: "photos", question: "Envie pelo menos uma foto do produto.", options: [] });
    }

    // ------------------------------------------------------------------
    // 8. PRONTO PARA PUBLICAR?
    // ------------------------------------------------------------------
    const blocking = [];

    // Texto pronto do erro de categoria (a tela só mostra texto).
    const specErrorText = normalizeErrorMessage(specError);

    if (!spec) blocking.push(specErrorText || "Categoria do Mercado Livre não resolvida.");
    if (!condition) blocking.push("Informe se o produto é novo ou usado.");
    if (!price.value) blocking.push("Informe o preço de venda.");
    if (!pictures.length) blocking.push("O produto precisa de ao menos uma foto.");
    if (requirements && !requirements.ready) {
        blocking.push(`Faltam ${requirements.pending.length} atributo(s) exigido(s) pelo Mercado Livre.`);
    }
    const hasAutoBrand = requirements?.hypotheses?.some(item => item.origin === "commercial_hint");
    if (hasAutoBrand) {
        blocking.push("Confirme a marca do produto (foi sugerida uma marca genérica).");
    }

    // Só texto para a tela nunca quebrar em String(...).
    const blockingTexts = blocking
        .map(item => (typeof item === "string" ? item : normalizeErrorMessage(item)))
        .filter(Boolean);

    return {
        success: true,
        product_id: product?.id || null,
        category: spec ? {
            id: spec.category_id,
            name: spec.category?.name || "",
            path: spec.category?.path_from_root || [],
            max_title_length: maxTitleLength,
            listing_type_id: spec.listing_type?.id || null
        } : { id: null, name: "", max_title_length: maxTitleLength, listing_type_id: null },
        category_suggestions: (spec?.predictions || [])
            .filter(candidate => candidate?.category_id)
            .slice(0, 3)
            .map(candidate => ({ id: candidate.category_id, name: candidate.category_name || candidate.category_id })),
        category_error: specError,
        // Erros do Mercado Livre podem vir como objeto; a tela só sabe
        // mostrar texto, então normalizamos aqui.
        category_error_text: normalizeErrorMessage(specError),
        category_note: categoryNote,
        identification: identificationMerged,
        seller: {
            observation,
            condition,
            working: identified.seller.working,
            accessories: identified.seller.accessories,
            defects: identified.seller.defects
        },
        evidence: identified.evidence,
        hypotheses: [
            ...identified.hypotheses,
            ...(requirements?.hypotheses || [])
        ],
        research,
        title: {
            value: titleReview.title,
            length: titleReview.title.length,
            max_length: maxTitleLength,
            issues: titleReview.issues
        },
        description: {
            value: description,
            length: description.length
        },
        price: {
            value: price.value,
            origin: price.origin,
            min: price.min ?? reference?.suggested_min ?? null,
            max: price.max ?? reference?.suggested_max ?? null,
            explanation: price.explanation,
            reference: reference ? {
                query: reference.query,
                confidence: reference.confidence,
                is_estimate: reference.is_estimate,
                comparison: reference.comparison,
                sources: reference.sources,
                references: reference.references,
                warning: reference.warning
            } : null
        },
        quantity: draftProduct.quantity,
        pictures: pictures.map((picture, index) => ({
            id: picture.id || null,
            url: picture.drive_file_id
                ? `/api/product-images/drive/${encodeURIComponent(picture.drive_file_id)}`
                : picture.original_url || picture.thumb_url || "",
            is_main: Boolean(picture.is_main) || index === 0
        })),
        attributes: requirements ? {
            filled: requirements.attributes,
            required: requirements.required,
            pending: requirements.pending,
            hypotheses: requirements.hypotheses,
            ready: requirements.ready
        } : null,
        questions,
        ready_to_publish: blockingTexts.length === 0,
        blocked_by: blockingTexts,
        // Informa (sem uso na descrição) que o cadastro tinha um texto antigo.
        description_source: descriptionFromReview ? "revisao" : "evidencias",
        legacy_description_ignored: Boolean(legadoIgnorado),
        ai: identified.ai,
        warnings: identified.warnings
    };
}

/**
 * Publica o anúncio aprovado. Só deve ser chamado depois que o vendedor
 * clicar em Publicar.
 */
async function publish({
    productId,
    identification = {},
    overrides = {},
    attributeOverrides = {},
    approve = false,
    dryRun = false,
    skipValidation = false
} = {}) {
    if (!approve) {
        const error = new Error("Publicação bloqueada: a aprovação do vendedor é obrigatória.");
        error.status = 428;
        error.code = "ML_APPROVAL_REQUIRED";
        throw error;
    }

    const { product } = await loadProductInputs(productId);
    const condition = conditionFrom(overrides.condition) || conditionFrom(product.condition) || "used";

    // O que o vendedor aprovou na revisão. Nada é gravado ainda: o cadastro só
    // é atualizado DEPOIS que a publicação der certo (ou nunca, em dry-run).
    // A descrição só substitui a do cadastro quando o vendedor a escreveu
    // nesta revisão; caso contrário o texto antigo permanece intocado e NÃO é
    // enviado ao anúncio.
    const descriptionFromReview = clean(overrides.description);

    const updates = {
        title: clean(overrides.title) || product.title,
        description: descriptionFromReview || product.description,
        sale_price: toMoney(overrides.sale_price) || Number(product.sale_price || 0),
        quantity: Math.max(1, Number(overrides.quantity || product.quantity || 1)),
        condition,
        brand: clean(identification.brand) || product.brand,
        model: clean(identification.model) || product.model,
        line: clean(identification.line) || product.line,
        color: clean(identification.color) || product.color
    };

    // Publica (ou simula). Toda validação — atributos, embalagem, aprovação e
    // resposta do Mercado Livre — acontece aqui. Se algo falhar, exceção sobe
    // e o cadastro permanece exatamente como estava.
    const result = await publishSellerListing({
        productId,
        attributeOverrides: attributeOverrides || overrides.attributeOverrides || [],
        descriptionOverride: descriptionFromReview,
        dryRun,
        skipValidation
    });

    // 1) Só agora, com a publicação confirmada, persistimos o que foi aprovado.
    // Em dry-run o resultado é apenas uma simulação: o banco não é tocado.
    if (!dryRun && result?.published === true) {
        await productService.update(productId, updates);
    }

    return {
        ...result,
        persisted: !dryRun && result?.published === true,
        permalink: result.ml?.permalink || null,
        item_id: result.ml?.id || null
    };
}

module.exports = {
    buildReview,
    publish,
    mergeIdentification,
    resolvePrice,
    normalizeOverrides
};
