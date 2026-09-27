require("dotenv").config();

const pool = require("./api/db");

async function main() {
    try {
        const result = await pool.query(`
            SELECT
                column_name,
                data_type,
                udt_name
            FROM information_schema.columns
            WHERE table_name = 'products'
            ORDER BY ordinal_position
        `);

        console.table(result.rows);

    } catch (error) {
        console.error("ERRO:", error.message);

    } finally {
        await pool.end();
    }
}

main();