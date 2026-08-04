const axios = require("axios");
const oauth = require("./oauth.service");

const api = axios.create({
    baseURL: "https://api.mercadolibre.com",
    timeout: 30000
});

async function execute(method, url, data = null, retry = true) {

    try {

        const token = await oauth.getAccessToken();

        const response = await api({

            method,
            url,
            data,

            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json"
            }

        });

        return response.data;

    } catch (err) {

        const status = err.response?.status;

        if (retry && (status === 400 || status === 401 || status === 403)) {

            console.log("==================================");
            console.log("TOKEN EXPIRADO");
            console.log("Renovando...");
            console.log("==================================");

            await oauth.refreshAccessToken();

            return execute(method, url, data, false);

        }

        throw err;

    }

}

exports.getMe = () =>
    execute("GET", "/users/me");

exports.uploadPicture = (body) =>
    execute("POST", "/pictures/items/upload", body);

exports.createItem = (body) =>
    execute("POST", "/items", body);