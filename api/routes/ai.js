
const express = require("express");
const path = require("path");

const router = express.Router();

const localAI = require("../services/local-ai.service");
const { analisarImagem } = localAI;
const { pesquisarImagem } = require("../services/lens.service");
const { findCatalogMatch } = require("../services/catalog.service");
const { buildListing, improveListing } = localAI;

router.post("/analyze", async (req, res) => {
    try {
        const {
            imageUrl,
            observacaoVendedor = ""
        } = req.body;

        if (!imageUrl) {
            return res.status(400).json({
                sucesso: false,
                erro: "imageUrl não informado."
            });
        }

        let caminhoImagem = imageUrl;

        caminhoImagem = caminhoImagem.replace(/^https?:\/\/[^/]+/i, "");
        caminhoImagem = caminhoImagem.replace(/^\/+/, "");
        caminhoImagem = path.join(__dirname, "../../", caminhoImagem);

        // ==================================================
        // 1. PESQUISA VISUAL
        // O Google Lens é opcional: sua falha não deve impedir
        // a tentativa de análise da imagem.
        // ==================================================

        let pesquisaVisual = {
            provider: "unavailable",
            search_url: "",
            links: [],
            erro: null
        };

        try {
            const pesquisa = await pesquisarImagem(caminhoImagem);

            if (pesquisa && typeof pesquisa === "object") {
                pesquisaVisual = {
                    ...pesquisaVisual,
                    ...pesquisa,
                    links: Array.isArray(pesquisa.links)
                        ? pesquisa.links
                        : []
                };
            }
        } catch (err) {
            console.error(
                "Google Lens indisponível; continuando análise:",
                err.message
            );

            pesquisaVisual.erro = err.message || "Pesquisa visual indisponível.";
        }

        // ==================================================
        // 2. IDENTIFICAÇÃO
        // Foto + resultados do Lens, quando disponíveis,
        // + observação do vendedor.
        // ==================================================

        const resultado = await analisarImagem(
            caminhoImagem,
            pesquisaVisual,
            observacaoVendedor
        );

        if (!resultado || typeof resultado !== "object") {
            throw new Error(
                "A análise da imagem não retornou uma identificação válida."
            );
        }

        // ==================================================
        // 3. CATALOG MATCHER
        // ==================================================

        const catalogIdentification = {
            ...(resultado.catalog_input || {}),
            product_type: resultado.product_type || "",
            brand: resultado.brand || "",
            line: resultado.line || "",
            model: resultado.model || "",
            generation: resultado.generation || ""
        };

        let catalogMatch = null;

        try {
            catalogMatch = await findCatalogMatch(
                catalogIdentification
            );
        } catch (err) {
            console.error("ERRO NO CATALOG MATCHER:", err);

            catalogMatch = {
                found: false,
                confidence: "LOW",
                best: null,
                ranked: [],
                candidates_received: 0,
                error: err.message
            };
        }

        // ==================================================
        // 4. COPYWRITER
        // ==================================================

        let listing = null;

        try {
            listing = await buildListing({
                identification: resultado.identification || {},
                facts: resultado.facts || [],
                cross_check: resultado.cross_check || {},
                catalogMatch,
                sellerObservation: observacaoVendedor
            });
        } catch (err) {
            console.error("ERRO NO COPYWRITER:", err);

            listing = {
                title: "",
                description: "",
                suggested_price: 0,
                category: "",
                error: err.message
            };
        }

        // ==================================================
        // 5. COMPATIBILIDADE COM O FRONTEND EXISTENTE
        // ==================================================

        const listingCompat = listing || {};

        const resultadoCompat = {
            ...resultado,
            title: String(
                listingCompat.title || resultado.title || ""
            ).trim(),
            description: String(
                listingCompat.description || resultado.description || ""
            ).trim(),
            suggested_price: Number.isFinite(
                Number(listingCompat.suggested_price)
            )
                ? Number(listingCompat.suggested_price)
                : Number(resultado.suggested_price || 0),
            category: String(
                listingCompat.category || resultado.category || ""
            ).trim(),
            listing_draft: {
                title: String(
                    listingCompat.title || resultado.title || ""
                ).trim(),
                description: String(
                    listingCompat.description || resultado.description || ""
                ).trim(),
                suggested_price: Number.isFinite(
                    Number(listingCompat.suggested_price)
                )
                    ? Number(listingCompat.suggested_price)
                    : Number(resultado.suggested_price || 0),
                category: String(
                    listingCompat.category || resultado.category || ""
                ).trim()
            }
        };

        // ==================================================
        // 6. RESPOSTA FINAL
        // ==================================================

        return res.json({
            sucesso: true,

            pesquisaVisual: {
                provider: pesquisaVisual.provider || "unavailable",
                search_url: pesquisaVisual.search_url || "",
                links: Array.isArray(pesquisaVisual.links)
                    ? pesquisaVisual.links
                    : [],
                erro: pesquisaVisual.erro || null
            },

            resultado: resultadoCompat,
            catalogMatch,
            listing
        });

    } catch (err) {
        console.error("ERRO NA ANÁLISE DO PRODUTO:", err);

        return res.status(500).json({
            sucesso: false,
            erro: err.message || "Erro ao analisar o produto."
        });
    }
});


// ======================================================
// CORRIGIR RASCUNHO + ESTIMAR PREÇO
// ======================================================

router.post("/improve-draft", async (req, res) => {
    try {
        const resultado = await improveListing(req.body || {});

        return res.json({
            sucesso: true,
            resultado
        });
    } catch (err) {
        console.error("ERRO AO CORRIGIR RASCUNHO:", err);

        return res.status(500).json({
            sucesso: false,
            erro: err.message || "Erro ao corrigir o rascunho."
        });
    }
});


// ======================================================
// STATUS DA IA LOCAL
// ======================================================

router.get("/local-status", async (req, res) => {
    try {
        return res.json({
            sucesso: true,
            ...await localAI.status()
        });
    } catch (err) {
        return res.status(500).json({
            sucesso: false,
            erro: err.message
        });
    }
});

module.exports = router;
