const fs = require("fs");
const path = require("path");
const OpenAI = require("openai");

const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

async function analisarImagem(imagePath) {

    const caminhoCompleto = path.resolve(imagePath);

    if (!fs.existsSync(caminhoCompleto)) {
        throw new Error("Imagem não encontrada.");
    }

    const extensao = path.extname(caminhoCompleto).toLowerCase();

    let mime = "image/jpeg";

    if (extensao === ".png") mime = "image/png";
    if (extensao === ".webp") mime = "image/webp";

    const imagemBase64 = fs.readFileSync(caminhoCompleto, {
        encoding: "base64"
    });

    const resposta = await client.responses.create({

        model: "gpt-5.5",

        input: [

            {
                role: "system",
                content: `
Você é especialista em criação de anúncios para Mercado Livre.

Analise cuidadosamente a fotografia enviada.

Identifique:

- tipo do produto
- marca
- modelo
- cor
- estado de conservação
- categoria
- preço sugerido em reais
- confiança da análise

Responda SOMENTE um JSON válido.

{
    "product_type":"",
    "brand":"",
    "model":"",
    "color":"",
    "condition":"",
    "title":"",
    "description":"",
    "category":"",
    "suggested_price":0,
    "confidence":0
}
`
            },

            {
                role: "user",
                content: [

                    {
                        type: "input_text",
                        text: "Analise esta imagem."
                    },

                    {
                        type: "input_image",
                        image_url: `data:${mime};base64,${imagemBase64}`
                    }

                ]
            }

        ]

    });

    let texto = resposta.output_text || "";

    texto = texto
        .replace(/```json/gi, "")
        .replace(/```/g, "")
        .trim();

    try {

        return JSON.parse(texto);

    } catch (erro) {

        console.log("====================================");
        console.log("RESPOSTA DA IA");
        console.log("====================================");
        console.log(texto);
        console.log("====================================");

        throw new Error("A OpenAI retornou um JSON inválido.");

    }

}

module.exports = {
    analisarImagem
};