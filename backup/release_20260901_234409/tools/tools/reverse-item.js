const api = require("../api/services/ml/api.service");
const fs = require("fs");

const itemId = process.argv[2] || "MLB4455717629";

(async () => {
    try {
        console.log("Consultando Mercado Livre:", itemId);

        const item = await api.getItem(itemId);

        const dir = "logs/reverse-engineering";

        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        const file = `${dir}/${itemId}.json`;

        fs.writeFileSync(
            file,
            JSON.stringify(item, null, 2),
            "utf8"
        );

        console.log("");
        console.log("====================================");
        console.log("CONSULTA REALIZADA COM SUCESSO");
        console.log("====================================");
        console.log("Arquivo:", file);
        console.log("");
        console.log("user_product_id:", item.user_product_id || "N/A");
        console.log("category_id:", item.category_id || "N/A");
        console.log("listing_type_id:", item.listing_type_id || "N/A");
        console.log("condition:", item.condition || "N/A");
        console.log("catalog_listing:", item.catalog_listing);
        console.log("====================================");

    } catch (err) {
        console.log("");
        console.log("====================================");
        console.log("ERRO NA CONSULTA");
        console.log("====================================");

        if (err.response && err.response.data) {
            console.log(JSON.stringify(err.response.data, null, 2));
        } else {
            console.log(err.message);
        }

        process.exit(1);
    }
})();
