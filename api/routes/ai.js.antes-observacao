const express = require("express");
const path = require("path");

const router = express.Router();

const { analisarImagem } = require("../services/ai.service");

router.post("/analyze", async (req, res) => {

    try {

        const { imageUrl } = req.body;

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

        const resultado = await analisarImagem(caminhoImagem);

        res.json({

            sucesso: true,
            resultado

        });

    }

    catch (err) {

        console.error("======================================");
        console.error("ERRO IA");
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