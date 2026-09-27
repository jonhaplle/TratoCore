const fs = require("fs");
const path = require("path");
const axios = require("axios");
const FormData = require("form-data");

const apiService = require("./api.service");

const API = "https://api.mercadolibre.com";

exports.upload = async (pictures) => {

    console.log("==================================");
    console.log("UPLOAD DAS IMAGENS");
    console.log("==================================");

    if (!Array.isArray(pictures) || pictures.length === 0) {
        throw new Error("Nenhuma imagem encontrada.");
    }

    const token = await apiService.getAccessToken();

    const uploaded = [];

    for (const picture of pictures) {

        let filePath =
            picture.path ||
            picture.source ||
            picture.original_url;

        if (!filePath) {
            continue;
        }

        if (/^https?:\/\//i.test(filePath)) {
            throw new Error("Este projeto utiliza apenas imagens locais.");
        }

        filePath = filePath.replace(/\//g, path.sep);

        if (filePath.startsWith(path.sep)) {
            filePath = filePath.substring(1);
        }

        const absolutePath = path.resolve(process.cwd(), filePath);

        if (!fs.existsSync(absolutePath)) {
            throw new Error(`Imagem não encontrada: ${absolutePath}`);
        }

        console.log("Arquivo:");
        console.log(absolutePath);

        const form = new FormData();

        form.append(
            "file",
            fs.createReadStream(absolutePath)
        );

        const response = await axios.post(
            `${API}/pictures/items/upload`,
            form,
            {
                headers: {
                    Authorization: `Bearer ${token}`,
                    ...form.getHeaders(),
                    "User-Agent": "TratoCore/1.0"
                },
                maxBodyLength: Infinity,
                maxContentLength: Infinity,
                timeout: 120000
            }
        );

        console.log("Picture ID:", response.data.id);

        uploaded.push({
            id: response.data.id
        });

    }

    if (!uploaded.length) {
        throw new Error("Nenhuma imagem enviada.");
    }

    console.log("----------------------------------");
    console.log(`${uploaded.length} imagem(ns) enviada(s).`);
    console.log("----------------------------------");

    return uploaded;

};