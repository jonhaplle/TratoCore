const fs = require("fs");

const p = "C:/TratoCore/api/models/productModel.js";

let s = fs.readFileSync(p, "utf8");

const inicio = s.indexOf("async function create(product) {");
const marcador = "// REMOVER";
const posMarcador = s.indexOf(marcador, inicio);

if (inicio < 0 || posMarcador < 0) {
    throw new Error("Nao foi possivel localizar create/update.");
}

const fim = s.lastIndexOf("// ======================================================", posMarcador);

if (fim < inicio) {
    throw new Error("Nao foi possivel localizar o inicio de REMOVER.");
}

const novoBloco = `async function create(product) {

    const sql = \`
        INSERT INTO products
        (
            sku,
            barcode,
            title,
            description,
            sale_price,
            quantity,
            status,
            product_type,
            brand,
            line,
            model,
            generation,
            version,
            color,
            condition,
            ai_confidence
        )
        VALUES
        (
            $1,$2,$3,$4,$5,$6,$7,$8,
            $9,$10,$11,$12,$13,$14,$15,$16
        )
        RETURNING *
    \`;

    const values = [
        product.sku || "",
        product.barcode || "",
        product.title || "",
        product.description || "",
        Number(product.sale_price || 0),
        Math.max(1, Number(product.quantity || 1)),
        product.status || "NEW",
        product.product_type || "",
        product.brand || "",
        product.line || "",
        product.model || "",
        product.generation || "",
        product.version || "",
        product.color || "",
        product.condition || "used",
        Number(product.ai_confidence || 0)
    ];

    const result = await db.query(sql, values);

    return result.rows[0];
}

// ======================================================
// ATUALIZAR
// ======================================================

async function update(id, product) {

    const sql = \`
        UPDATE products
        SET
            sku=$1,
            barcode=$2,
            title=$3,
            description=$4,
            sale_price=$5,
            quantity=$6,
            status=$7,
            product_type=$8,
            brand=$9,
            line=$10,
            model=$11,
            generation=$12,
            version=$13,
            color=$14,
            condition=$15,
            ai_confidence=$16
        WHERE id=$17
        RETURNING *
    \`;

    const values = [
        product.sku || "",
        product.barcode || "",
        product.title || "",
        product.description || "",
        Number(product.sale_price || 0),
        Math.max(1, Number(product.quantity || 1)),
        product.status || "NEW",
        product.product_type || "",
        product.brand || "",
        product.line || "",
        product.model || "",
        product.generation || "",
        product.version || "",
        product.color || "",
        product.condition || "used",
        Number(product.ai_confidence || 0),
        id
    ];

    const result = await db.query(sql, values);

    return result.rows[0] || null;
}

// ======================================================

`;

s = s.substring(0, inicio) + novoBloco + s.substring(fim);

fs.writeFileSync(p, s, "utf8");

console.log("OK - create/update corrigidos.");