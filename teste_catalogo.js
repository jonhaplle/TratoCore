const pool = require("./api/db");
const { findCatalogMatch } = require("./api/services/catalog.service");

const identificacao = {
    product_type: "console",
    brand: "Microsoft",
    line: "Xbox",
    model: "",
    generation: "Xbox Classic",
    version: "",
    color: "preto",
    search_terms: [
        "Xbox clássico Microsoft",
        "Microsoft Xbox original",
        "Microsoft Xbox primeira geração"
    ]
};

(async () => {
    try {

        console.log("==========================================");
        console.log("TESTE CATALOG MATCHER");
        console.log("==========================================");

        console.dir(identificacao, { depth: null });

        const resultado = await findCatalogMatch(identificacao);

        console.log("\n==========================================");
        console.log("RESULTADO DO MATCHER");
        console.log("==========================================");

        console.log("Encontrado:", resultado.found);
        console.log("Confiança:", resultado.confidence);
        console.log("Candidatos recebidos:", resultado.candidates_received);
        console.log(
            "Removidos por incompatibilidade:",
            resultado.candidates_removed_as_incompatible
        );

        console.log("\n------------------------------------------");
        console.log("MELHOR CANDIDATO");
        console.log("------------------------------------------");

        console.dir(resultado.best, { depth: null });

        console.log("\n------------------------------------------");
        console.log("TOP 10 RANKING");
        console.log("------------------------------------------");

        console.dir(resultado.ranked, { depth: null });

        console.log("\n==========================================");
        console.log("FIM DO TESTE");
        console.log("==========================================");

    } catch (err) {

        console.error("\nERRO:");
        console.error(err);

        process.exitCode = 1;

    } finally {

        await pool.end();

    }
})();