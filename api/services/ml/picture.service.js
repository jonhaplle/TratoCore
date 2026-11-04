const fs = require("fs");
const path = require("path");
const axios = require("axios");
const FormData = require("form-data");
const apiService = require("./api.service");
const googleDriveOAuthService = require("../googleDriveOAuthService").createGoogleDriveOAuthService();
const legacyDrive = require("../googleDriveService");

const API = "https://api.mercadolibre.com";

async function getDriveFileStream(fileId) {
    try {
        return await googleDriveOAuthService.getFileStream(fileId);
    } catch (oauthError) {
        console.warn("[PictureUpload] Leitura OAuth do Drive falhou; tentando serviço legado:", oauthError.message);
        try {
            return await legacyDrive.getFileStream(fileId);
        } catch (legacyError) {
            const error = new Error(
                `Não foi possível baixar a imagem ${fileId} do Google Drive. OAuth: ${oauthError.message}; serviço legado: ${legacyError.message}`
            );
            error.cause = legacyError;
            throw error;
        }
    }
}

exports.upload = async (pictures) => {
    if (!Array.isArray(pictures) || pictures.length === 0) {
        throw new Error("Nenhuma imagem encontrada.");
    }

    const token = await apiService.getAccessToken();
    const uploaded = [];
    console.log(`[PictureUpload] Iniciando envio: ${pictures.length} imagem(ns).`);

    for (const [index, picture] of pictures.entries()) {
        console.log(`[PictureUpload] Imagem ${index + 1}/${pictures.length}: drive_file_id=${picture.drive_file_id ? "presente" : "ausente"}, path=${picture.path ? "presente" : "ausente"}, source=${picture.source ? "presente" : "ausente"}, original_url=${picture.original_url ? "presente" : "ausente"}`);
        const driveFileId = picture.drive_file_id || null;
        let stream;
        let filename = path.basename(String(picture.file_name || "imagem.jpg"));
        const mimeType = picture.mime_type || "image/jpeg";

        if (driveFileId) {
            stream = await getDriveFileStream(driveFileId);
            console.log("Imagem obtida do Google Drive:", driveFileId);
        } else {
            let filePath = picture.path || picture.source || picture.original_url;
            if (!filePath) continue;
            if (/^https?:\/\//i.test(filePath)) {
                throw new Error("Imagem sem ID do Google Drive: não é possível usar URL HTTP como arquivo local.");
            }
            filePath = filePath.replace(/\\/g, path.sep);
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
            const pictureId = response.data?.id;
            if (!pictureId) {
                throw new Error(`Mercado Livre não retornou ID para a imagem ${index + 1}. Resposta: ${JSON.stringify(response.data || {})}`);
            }
            uploaded.push({ id: pictureId });
            console.log(`[PictureUpload] Imagem ${index + 1} enviada. ID ML: ${pictureId}`);
        } catch (error) {
            if (stream && typeof stream.destroy === "function") stream.destroy();
            throw error;
        }
    }

    if (!uploaded.length) throw new Error("Nenhuma imagem válida foi enviada.");
    if (uploaded.some(picture => !picture.id)) throw new Error("Upload incompleto: existe imagem sem ID do Mercado Livre.");
    console.log(`[PictureUpload] Concluído: ${uploaded.length}/${pictures.length} imagem(ns) enviada(s) ao Mercado Livre.`);
    return uploaded;
};
