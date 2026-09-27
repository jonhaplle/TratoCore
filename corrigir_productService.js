const fs = require("fs");

const p = "C:/TratoCore/api/services/productService.js";

let s = fs.readFileSync(p, "utf8");

const oldCreate = `        status: data.status || "NEW"

    };`;

const newCreate = `        status: data.status || "NEW",

        product_type: data.product_type || "",
        brand: data.brand || "",
        line: data.line || "",
        model: data.model || "",
        generation: data.generation || "",
        version: data.version || "",
        color: data.color || "",
        condition: data.condition || "used",
        ai_confidence: Number(data.ai_confidence || 0)

    };`;

if (!s.includes(oldCreate)) {
    throw new Error("Bloco CREATE nao encontrado.");
}

s = s.replace(oldCreate, newCreate);

const oldUpdate = `        status: data.status ?? atual.status

    };`;

const newUpdate = `        status: data.status ?? atual.status,

        product_type: data.product_type ?? atual.product_type ?? "",
        brand: data.brand ?? atual.brand ?? "",
        line: data.line ?? atual.line ?? "",
        model: data.model ?? atual.model ?? "",
        generation: data.generation ?? atual.generation ?? "",
        version: data.version ?? atual.version ?? "",
        color: data.color ?? atual.color ?? "",
        condition: data.condition ?? atual.condition ?? "used",
        ai_confidence: Number(
            data.ai_confidence ?? atual.ai_confidence ?? 0
        )

    };`;

if (!s.includes(oldUpdate)) {
    throw new Error("Bloco UPDATE nao encontrado.");
}

s = s.replace(oldUpdate, newUpdate);

fs.writeFileSync(p, s, "utf8");

console.log("OK - productService atualizado.");