require("dotenv").config();

const pool = require("./api/db");
const apiService = require("./api/services/ml/api.service");

(async () => {
    try {
        console.log("==========================================");
        console.log("TESTE CATALOGO POR ATRIBUTOS");
        console.log("==========================================");

        const data = await apiService.searchProducts({
            site_id: "MLB",
            status: "active",
            domain_id: "MLB-GAME_CONSOLES",
            attributes: [
                {
                    id: "BRAND",
                    value_id: "15770"
                },
                {
                    id: "LINE",
                    value_id: "110564"
                },
                {
                    id: "MODEL",
                    value_id: "401380"
                }
            ]
        });

        console.dir(data, { depth: null });

    } catch (err) {
        console.error("\nERRO:");

        if (err.response) {
            console.dir({
                status: err.response.status,
                data: err.response.data
            }, { depth: null });
        } else {
            console.error(err.message);
        }

        process.exitCode = 1;

    } finally {
        await pool.end();
    }
})();