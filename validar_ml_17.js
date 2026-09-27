require("dotenv").config();

const axios = require("axios");
const pool = require("./api/db");

const itemService = require("./api/services/ml/item.service");
const productService = require("./api/services/productService");
const productImageService = require("./api/services/productImageService");

async function main() {
    try {
        console.log("========================================");
        console.log("VALIDAÇÃO OFICIAL MERCADO LIVRE");
        console.log("PRODUTO 17");
        console.log("========================================");

        const product = await productService.getById(17);

        if (!product) {
            throw new Error("Produto 17 não encontrado.");
        }

        const pictures =
            await productImageService.getByProductId(17);

        if (!pictures.length) {
            throw new Error("Produto 17 não possui imagens.");
        }

        // Monta exatamente o mesmo payload
        // utilizado pelo fluxo de publicação.
        const item = await itemService.build(
            product,
            pictures
        );

        console.log("");
        console.log("PAYLOAD QUE SERÁ VALIDADO:");
        console.dir(item, {
            depth: null
        });

        const tokenResult = await pool.query(`
            SELECT access_token
            FROM ml_tokens
            ORDER BY created_at DESC
            LIMIT 1
        `);

        if (!tokenResult.rows.length) {
            throw new Error(
                "Token Mercado Livre não encontrado."
            );
        }

        const token =
            tokenResult.rows[0].access_token;

        console.log("");
        console.log("========================================");
        console.log("ENVIANDO PARA /items/validate");
        console.log("========================================");

        const response = await axios.post(
            "https://api.mercadolibre.com/items/validate",
            item,
            {
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json",
                    Accept: "application/json"
                },

                // IMPORTANTE:
                // permite capturar também respostas 4xx/5xx
                // sem o Axios interromper a execução.
                validateStatus: () => true,

                timeout: 60000
            }
        );

        console.log("");
        console.log("========================================");
        console.log("RESPOSTA DO MERCADO LIVRE");
        console.log("========================================");

        console.log("");
        console.log("HTTP STATUS:");
        console.log(response.status);

        console.log("");
        console.log("HEADERS:");
        console.dir(
            response.headers,
            {
                depth: null
            }
        );

        console.log("");
        console.log("BODY:");
        console.dir(
            response.data,
            {
                depth: null
            }
        );

        console.log("");
        console.log("========================================");

        if (
            response.status >= 200 &&
            response.status < 300
        ) {
            console.log("");
            console.log("✅ PAYLOAD ACEITO PELO VALIDADOR");
            console.log("");
            console.log("NÃO FOI PUBLICADO.");
            console.log("");
        } else {
            console.log("");
            console.log("❌ PAYLOAD REJEITADO PELO VALIDADOR");
            console.log("");
            console.log("NÃO FOI PUBLICADO.");
            console.log("");
        }

    } catch (error) {

        console.log("");
        console.log("========================================");
        console.log("ERRO NO TESTE");
        console.log("========================================");

        console.log("");

        if (error.response) {

            console.log("HTTP STATUS:");
            console.log(error.response.status);

            console.log("");
            console.log("BODY DO ERRO:");

            console.dir(
                error.response.data,
                {
                    depth: null
                }
            );

        } else {

            console.error(
                error.message || error
            );
        }

    } finally {

        await pool.end();
    }
}

main();