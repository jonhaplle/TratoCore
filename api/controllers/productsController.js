const db = require("../db");

async function listar(req, res) {

    try {

        const sql = `
            SELECT
                id,
                sku,
                title,
                description,
                cost_price,
                sale_price,
                quantity,
                status,
                created_at
            FROM products
            ORDER BY created_at DESC
        `;

        const resultado = await db.query(sql);

        res.json({
            sucesso: true,
            total: resultado.rows.length,
            produtos: resultado.rows
        });

    } catch (erro) {

        console.error(erro);

        res.status(500).json({
            sucesso: false,
            erro: erro.message
        });

    }

}

module.exports = {
    listar
};