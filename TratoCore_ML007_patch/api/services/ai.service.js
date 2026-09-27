const fs = require("fs");
const path = require("path");
const OpenAI = require("openai");

const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

function limparJson(texto) {
    return String(texto || "")
        .replace(/```json/gi, "")
        .replace(/```/g, "")
        .trim();
}

async function analisarImagem(imagePath, pesquisaVisual = null, observacaoVendedor = "") {

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

    const pesquisaTexto = pesquisaVisual
        ? JSON.stringify({
            provider: pesquisaVisual.provider,
            search_url: pesquisaVisual.search_url,
            text: pesquisaVisual.text,
            links: pesquisaVisual.links
        })
        : "Nenhuma pesquisa visual disponível.";

    const resposta = await client.responses.create({

        model: "gpt-5.5",

        input: [

            {
                role: "system",
                content: `
Você é o cérebro de identificação e preparação de anúncios do TratoCore.

A fotografia é a fonte visual primária.
A pesquisa do Google Lens é uma FONTE AUXILIAR de evidência.

REGRAS OBRIGATÓRIAS:
1. Nunca transforme uma hipótese em fato sem evidência suficiente.
2. Cruze o que aparece na fotografia com os resultados da pesquisa visual.
3. Se houver conflito entre fontes, registre a dúvida e reduza a confiança.
4. Não invente modelo, geração, versão, código, GTIN ou especificação.
5. Só considere a identificação consolidada quando houver evidência compatível.
6. A descrição do anúncio deve usar apenas informações sustentadas pela identificação.
7. O preço sugerido é estimativa comercial e não deve ser apresentado como fato de mercado.

RETORNE SOMENTE JSON VÁLIDO:
{
  "identification": {
    "product_type": "",
    "brand": "",
    "line": "",
    "model": "",
    "generation": "",
    "version": "",
    "color": "",
    "condition": ""
  },
  "facts": [],
  "hypotheses": [],
  "evidence": [],
  "cross_check": {
    "confirmed": [],
    "contradictions": [],
    "unresolved": []
  },
  "confidence": {
    "score": 0,
    "level": "LOW",
    "reasons": []
  },
  "catalog_input": {
    "search_terms": [],
    "product_type": "",
    "brand": "",
    "line": "",
    "model": "",
    "generation": ""
  },
  "decision": {
    "status": "PROVISIONAL",
    "reason": ""
  }
}
`
            },

            {
                role: "user",
                content: [
                    {
                        type: "input_text",
                        text:
                            "Analise esta foto. Cruze-a com a pesquisa visual abaixo. " +
                            "Observação do vendedor: " +
                            (observacaoVendedor || "nenhuma") +
                            "\\n\\nPESQUISA VISUAL:\\n" +
                            pesquisaTexto
                    },
                    {
                        type: "input_image",
                        image_url: `data:${mime};base64,${imagemBase64}`
                    }
                ]
            }
        ]
    });

    const texto = limparJson(resposta.output_text);

    try {
        const resultado = JSON.parse(texto);

        // Compatibilidade com o frontend atual sem misturar
        // a identificação com a etapa posterior de geração do anúncio.
        const id = resultado.identification || {};
        const conf = resultado.confidence || {};

        return {
            ...resultado,
            product_type: id.product_type || "",
            brand: id.brand || "",
            line: id.line || "",
            model: id.model || "",
            generation: id.generation || "",
            version: id.version || "",
            color: id.color || "",
            condition: id.condition || "",
            confidence: Number(conf.score || 0),
            confidence_details: conf,
            title: "",
            description: "",
            suggested_price: 0,
            category: ""
        };
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
