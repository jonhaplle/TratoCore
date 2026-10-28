const fs = require("fs");
const path = require("path");
const axios = require("axios");
const FormData = require("form-data");
const apiService = require("./api.service");
const { getFileStream } = require("../googleDriveService");

const API = "https://api.mercadolibre.com";

exports.upload = async (pictures) => {
    if (!Array.isArray(pictures) || pictures.length === 0) {
        throw new Error("Nenhuma imagem encontrada.");
    }

    const token = await apiService.getAccessToken();
    const uploaded = [];

    for (const picture of pictures) {
        const driveFileId = picture.drive_file_id || null;
        let stream;
        let filename = path.basename(String(picture.file_name || "imagem.jpg"));
        const mimeType = picture.mime_type || "image/jpeg";

        if (driveFileId) {
            stream = await getFileStream(driveFileId);
            console.log("Imagem obtida do Google Drive:", driveFileId);
        } else {
            let filePath = picture.path || picture.source || picture.original_url;
            if (!filePath) continue;
            if (/^https?:\/\//i.test(filePath)) {
                throw new Error("Imagem sem ID do Google Drive: não é possível usar URL HTTP como arquivo local.");
            }
            filePath = filePath.replace(/\//g, path.sep);
            if (filePath.startsWith(path.sep)) filePath = filePath.substring(1);
            const absolutePath = path.resolve(process.cwd(), filePath);
            if (!fs.existsSync(absolutePath)) {
                throw new Error(`Imagem não encontrada localmente e sem ID válido no Google Drive: ${absolutePath}`);
            }
            stream = fs.createReadStream(absolutePath);
            filename = path.basename(absolutePath);
        }

        const form = new FormData();
        form.append("file", stream, { filename, contentType: mimeType });

        try {
            const response = await axios.post(`${API}/pictures/items/upload`, form, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    ...form.getHeaders(),
                    "User-Agent": "TratoCore/1.0"
                },
                maxBodyLength: Infinity,
                maxContentLength: Infinity,
                timeout: 120000
            });
            uploaded.push({ id: response.data.id });
            console.log("Picture ID:", response.data.id);
        } catch (error) {
            if (stream && typeof stream.destroy === "function") stream.destroy();
            throw error;
        }
    }

    if (!uploaded.length) throw new Error("Nenhuma imagem válida foi enviada.");
    console.log(`${uploaded.length} imagem(ns) enviada(s) ao Mercado Livre.`);
    return uploaded;
};
