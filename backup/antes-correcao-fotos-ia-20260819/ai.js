const express = require("express");
const path = require("path");

const router = express.Router();

const { analisarImagem } = require("../services/ai.service");
const { pesquisarImagem } = require("../services/lens.service");
const { findCatalogMatch } = require("../services/catalog.service");
const { buildListing } = require("../services/listing.service");

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
        // ==================================================

        const pesquisaVisual = await pesquisarImagem(caminhoImagem);

        // ==================================================
        // 2. IDENTIFICAÇÃO
        // Foto + Lens + observação do vendedor
        // ==================================================

        const resultado = await analisarImagem(
            caminhoImagem,
            pesquisaVisual,
            observacaoVendedor
        );

        // ==================================================
        // 3. CATALOG MATCHER
        // Usa a identificação consolidada pelo passo anterior.
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

            console.error("======================================");
            console.error("ERRO NO CATALOG MATCHER");
            console.error("======================================");
            console.error(err);
            console.error("======================================");

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
        // Só agora gera título, descrição, categoria e preço.
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

            console.error("======================================");
            console.error("ERRO NO COPYWRITER");
            console.error("======================================");
            console.error(err);
            console.error("======================================");

            listing = {
                title: "",
                description: "",
                suggested_price: 0,
                category: "",
                error: err.message
            };
        }

        // ==================================================
        // 5. RESPOSTA FINAL
        // ==================================================

        res.json({

            sucesso: true,

            pesquisaVisual: {
                provider: pesquisaVisual.provider,
                search_url: pesquisaVisual.search_url,
                links: pesquisaVisual.links
            },

            resultado,

            catalogMatch,

            listing

        });

    } catch (err) {

        console.error("======================================");
        console.error("ERRO IDENTIFICAÇÃO + LENS + CATÁLOGO");
        console.error("======================================");
        console.error(err);
        console.error("======================================");

        res.status(500).json({
            sucesso: false,
            erro: err.message
        });
    }

});

module.exports = router;