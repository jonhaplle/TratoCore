require("dotenv").config();

const pool = require("./api/db");

async function main() {
    try {
        const result = await pool.query(`
            UPDATE products
            SET
                brand = $1,
                model = $2,
                category = $3,
                condition = $4,
                color = $5,
                ml_category_id = $6,
                ml_listing_type = $7
            WHERE id = $8
            RETURNING
                id,
                title,
                brand,
                model,
                category,
                condition,
                color,
                ml_category_id,
                ml_listing_type
        `, [
            "Microsoft",
            "Xbox Classic",
            "Consoles",
            "used",
            "Preto",
            "MLB11172",
            "gold_pro",
            17
        ]);

        if (!result.rows.length) {
            throw new Error("Produto ID 17 não encontrado.");
        }

        console.log("");
        console.log("==========================================");
        console.log("PRODUTO 17 ATUALIZADO");
        console.log("==========================================");
        console.dir(result.rows[0], { depth: null });
        console.log("==========================================");

    } catch (error) {
        console.error("ERRO:", error.message);
        process.exitCode = 1;

    } finally {
        await pool.end();
    }
}

main();