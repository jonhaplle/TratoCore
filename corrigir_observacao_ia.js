const fs = require("fs");

const arquivo = "C:/TratoCore/api/services/ai.service.js";

let s = fs.readFileSync(arquivo, "utf8");

const marcador = 'type: "input_text"';

const inicio = s.indexOf(marcador);

if (inicio === -1) {
    throw new Error("type: input_text nao encontrado.");
}

const inicioText = s.indexOf("text:", inicio);

if (inicioText === -1) {
    throw new Error("text do input_text nao encontrado.");
}

const inicioValor = s.indexOf('"', inicioText);

if (inicioValor === -1) {
    throw new Error("Inicio do texto nao encontrado.");
}

const fimValor = s.indexOf('"', inicioValor + 1);

if (fimValor === -1) {
    throw new Error("Fim do texto nao encontrado.");
}

const novoTexto = `text: \`Analise esta imagem e identifique o produto com o maximo de precisao possivel.

OBSERVACAO DO VENDEDOR:
\${observacaoVendedor || "Nenhuma observacao informada."}

Use a observacao do vendedor como informacao adicional sobre funcionamento, defeitos, estado, testes realizados e se o produto e destinado a tecnicos para reparo.

Nao invente informacoes que nao estejam visiveis na imagem ou presentes na observacao do vendedor.

A descricao deve ser vendedora, clara e honesta.

Destaque os pontos positivos reais do produto.

Informe claramente defeitos, limitacoes, testes realizados e condicoes relatadas pelo vendedor.

Se o vendedor informar que o produto e vendido no estado ou destinado a tecnicos, deixe isso claro na descricao.
```;

s =
    s.substring(0, inicioText) +
    novoTexto +
    s.substring(fimValor + 1);

fs.writeFileSync(arquivo, s, "utf8");

console.log("OK - observacao do vendedor integrada na IA.");