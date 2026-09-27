const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { v2: cloudinary } = require("cloudinary");

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

function absoluteImagePath(imagePath) {
    const resolved = path.resolve(imagePath);
    if (!fs.existsSync(resolved)) {
        throw new Error("Imagem não encontrada para pesquisa visual.");
    }
    return resolved;
}

async function publicarImagemTemporaria(imagePath) {
    const resolved = absoluteImagePath(imagePath);

    if (!process.env.CLOUDINARY_CLOUD_NAME ||
        !process.env.CLOUDINARY_API_KEY ||
        !process.env.CLOUDINARY_API_SECRET) {
        throw new Error("Cloudinary não configurado para pesquisa visual.");
    }

    const result = await cloudinary.uploader.upload(resolved, {
        folder: "tratocore/lens",
        resource_type: "image"
    });

    return {
        url: result.secure_url,
        public_id: result.public_id
    };
}

function extrairTextoHtml(html) {
    return String(html || "")
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/\s+/g, " ")
        .trim();
}

function extrairLinks(html) {
    const links = [];
    const regex = /href=["']([^"']+)["']/gi;
    let match;

    while ((match = regex.exec(String(html || ""))) !== null) {
        const href = match[1];
        if (/^https?:\/\//i.test(href)) {
            links.push(href);
        }
        if (links.length >= 40) break;
    }

    return [...new Set(links)];
}

async function pesquisarImagem(imagePath) {
    const publicada = await publicarImagemTemporaria(imagePath);

    const lensUrl =
        "https://lens.google.com/uploadbyurl?url=" +
        encodeURIComponent(publicada.url) +
        "&hl=pt-BR";

    const response = await axios.get(lensUrl, {
        timeout: 30000,
        maxRedirects: 5,
        headers: {
            "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151 Safari/537.36",
            "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8"
        }
    });

    const html = response.data || "";

    return {
        provider: "google_lens",
        image_url: publicada.url,
        search_url: response.request?.res?.responseUrl || lensUrl,
        text: extrairTextoHtml(html).slice(0, 30000),
        links: extrairLinks(html),
        raw_length: String(html).length
    };
}

module.exports = {
    pesquisarImagem
};
