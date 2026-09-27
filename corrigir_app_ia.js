const fs = require("fs");

const p = "C:/TratoCore/public/app.js";

let s = fs.readFileSync(p, "utf8");

// ======================================================
// 1. VARIÁVEIS DOS DADOS DA IA
// ======================================================

if (!s.includes("let aiProductType")) {

    const marker = 'const description = document.getElementById("description");';

    if (!s.includes(marker)) {
        throw new Error("Variavel description nao encontrada.");
    }

    s = s.replace(
        marker,
        marker + `

let aiProductType = "";
let aiLine = "";
let aiGeneration = "";
let aiVersion = "";
let aiColor = "";
let aiCondition = "used";
let aiConfidence = 0;`
    );
}

// ======================================================
// 2. GUARDAR RESULTADO COMPLETO DA IA
// ======================================================

if (!s.includes("aiProductType = p.product_type")) {

    const regex = /(\s*salePrice\.value\s*=\s*p\.suggested_price\s*\|\|\s*"";)/;

    if (!regex.test(s)) {
        throw new Error("Linha salePrice da analise IA nao encontrada.");
    }

    s = s.replace(
        regex,
        `$1

        aiProductType = p.product_type || "";
        aiLine = p.line || "";
        aiGeneration = p.generation || "";
        aiVersion = p.version || "";
        aiColor = p.color || "";
        aiCondition = p.condition || "used";
        aiConfidence = Number(p.confidence || 0);`
    );
}

// ======================================================
// 3. ENVIAR DADOS DA IA NO CADASTRO
// ======================================================

if (!s.includes("product_type: aiProductType")) {

    const regex = /(\s*status:\s*"NEW")/;

    if (!regex.test(s)) {
        throw new Error("status NEW do cadastro nao encontrado.");
    }

    s = s.replace(
        regex,
        `$1,

                product_type: aiProductType,
                brand: brand.value,
                line: aiLine,
                model: model.value,
                generation: aiGeneration,
                version: aiVersion,
                color: aiColor,
                condition: aiCondition,
                ai_confidence: aiConfidence`
    );
}

// ======================================================
// 4. LIMPAR DADOS DA IA
// ======================================================

if (!s.includes("aiProductType = \"\";") ||
    !s.includes("aiConfidence = 0;")) {

    const regex = /(\s*description\.value\s*=\s*"";)/g;

    const matches = [...s.matchAll(regex)];

    if (matches.length === 0) {
        throw new Error("description.value nao encontrado.");
    }

    // O ultimo corresponde ao newProduct()
    const ultimo = matches[matches.length - 1];

    const pos = ultimo.index + ultimo[0].length;

    const reset = `

    aiProductType = "";
    aiLine = "";
    aiGeneration = "";
    aiVersion = "";
    aiColor = "";
    aiCondition = "used";
    aiConfidence = 0;`;

    s = s.slice(0, pos) + reset + s.slice(pos);
}

fs.writeFileSync(p, s, "utf8");

console.log("OK - app.js atualizado com dados completos da IA.");