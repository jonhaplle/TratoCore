require("dotenv").config();

const pool = require("./api/db");
const apiService = require("./api/services/ml/api.service");

(async () => {
    try {
        const titulo =
            "Console Microsoft Xbox Clássico Original Preto Usado";

        const categorias = await apiService.predictCategory(titulo);

        console.log("");
        console.log("==========================================");
        console.log("CATEGORIAS ENCONTRADAS PELO MERCADO LIVRE");
        console.log("==========================================");

        console.dir(categorias, {
            depth: null
        });

        console.log("");
        console.log("==========================================");
        console.log("PRIMEIRA CATEGORIA (MAIOR PROBABILIDADE)");
        console.log("==========================================");
        console.dir(categorias[0], {
            depth: null
        });

    } catch (err) {
        console.error("");
        console.error("ERRO:");

        if (err.response) {
            console.dir(err.response.data, {
                depth: null
            });
        } else {
            console.error(err.message);
        }

    } finally {
        await pool.end();
    }
})();
