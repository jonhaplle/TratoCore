require("dotenv").config();

const axios = require("axios");
const pool = require("./api/db");

async function main() {
    try {
        const tokenResult = await pool.query(`
            SELECT access_token
            FROM ml_tokens
            ORDER BY created_at DESC
            LIMIT 1
        `);

        if (!tokenResult.rows.length) {
            throw new Error("Token Mercado Livre não encontrado.");
        }

        const token = tokenResult.rows[0].access_token;

        const me = await axios.get(
            "https://api.mercadolibre.com/users/me",
            {
                headers: {
                    Authorization: `Bearer ${token}`
                }
            }
        );

        const userId = me.data.id;

        console.log("========================================");
        console.log("USUÁRIO MERCADO LIVRE");
        console.log("========================================");
        console.log("ID:", userId);
        console.log("Nickname:", me.data.nickname);

        const shipping = await axios.get(
            `https://api.mercadolibre.com/users/${userId}/shipping_preferences`,
            {
                headers: {
                    Authorization: `Bearer ${token}`
                }
            }
        );

        console.log("");
        console.log("========================================");
        console.log("PREFERÊNCIAS DE ENVIO");
        console.log("========================================");

        console.dir(shipping.data, {
            depth: null
        });

    } catch (error) {

        console.log("");
        console.log("========================================");
        console.log("ERRO");
        console.log("========================================");

        console.dir(
            error.response?.data ||
            error.message ||
            error,
            { depth: null }
        );

    } finally {
        await pool.end();
    }
}

main();