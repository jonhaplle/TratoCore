const express = require("express");
const path = require("path");

const router = express.Router();

const { analisarImagem } = require("../services/ai.service");
const { pesquisarImagem } = require("../services/lens.service");

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

        // 1. Pesquisa visual primeiro.
        const pesquisaVisual = await pesquisarImagem(caminhoImagem);

        // 2. GPT cruza a foto com as evidências do Lens.
        const resultado = await analisarImagem(
            caminhoImagem,
            pesquisaVisual,
            observacaoVendedor
        );

        res.json({
            sucesso: true,
            pesquisaVisual: {
                provider: pesquisaVisual.provider,
                search_url: pesquisaVisual.search_url,
                links: pesquisaVisual.links
            },
            resultado
        });

    } catch (err) {

        console.error("======================================");
        console.error("ERRO IDENTIFICAÇÃO + LENS");
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
