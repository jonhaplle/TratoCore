const axios = require("axios");
const fs = require("fs");
const api = require("../api/services/ml/api.service");

const userProductId = process.argv[2] || "MLBU3762850499";

(async () => {
    try {
        console.log("Consultando User Product:", userProductId);

        const token = await api.getAccessToken();

        const response = await axios.get(
            `https://api.mercadolibre.com/user-products/${encodeURIComponent(userProductId)}`,
            {
                headers: {
                    Authorization: `Bearer ${token}`,
                    "User-Agent": "TratoCore/1.0"
                },
                timeout: 30000
            }
        );

        const dir = "logs/reverse-engineering";

        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        const file = `${dir}/${userProductId}.json`;

        fs.writeFileSync(
            file,
            JSON.stringify(response.data, null, 2),
            "utf8"
        );

        console.log("");
        console.log("====================================");
        console.log("USER PRODUCT CONSULTADO");
        console.log("====================================");
        console.log("Arquivo:", file);
        console.log("====================================");

    } catch (err) {
        console.log("");
        console.log("====================================");
        console.log("ERRO");
        console.log("====================================");

        if (err.response && err.response.data) {
            console.log(JSON.stringify(err.response.data, null, 2));
        } else {
            console.log(err.message);
        }

        process.exit(1);
    }
})();