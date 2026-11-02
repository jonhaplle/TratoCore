const express = require("express");
const path = require("path");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");
const { pipeline } = require("stream/promises");

const router = express.Router();

const localAI = require("../services/local-ai.service");
const { analisarImagem } = localAI;
const { pesquisarImagem } = require("../services/lens.service");
const { findCatalogMatch } = require("../services/catalog.service");
const { buildListing, improveListing } = localAI;

const googleDriveOAuthService =
    require("../services/googleDriveOAuthService")
        .createGoogleDriveOAuthService();

function getDriveFileId(imageUrl) {
    const value = String(imageUrl || "").trim();

    let pathname = value;

    try {
        if (/^https?:\/\//i.test(value)) {
            pathname = new URL(value).pathname;
        }
    } catch (_) {
        return null;
    }

    const match = pathname.match(
        /\/api\/product-images\/drive\/([^/?#]+)/
    );

    if (!match) return null;

    try {
        return decodeURIComponent(match[1]);
    } catch (_) {
        return null;
    }
}

function getImageExtension(mimeType, fileName) {
    const originalExtension = path.extname(fileName || "").toLowerCase();

    if ([".jpg", ".jpeg", ".png", ".webp"].includes(originalExtension)) {
        return originalExtension;
    }

    const extensions = {
        "image/jpeg": ".jpg",
        "image/png": ".png",
        "image/webp": ".webp"
    };

    return extensions[mimeType] || ".jpg";
}

async function prepareImage(imageUrl) {
    const driveFileId = getDriveFileId(imageUrl);

    // Imagem armazenada no Google Drive
    if (driveFileId) {
        const metadata =
            await googleDriveOAuthService.getFileMetadata(driveFileId);

        const mimeType = metadata.mimeType || "image/jpeg";

        if (!mimeType.startsWith("image/")) {
            throw new Error("O arquivo do Google Drive não é uma imagem.");
        }

        const extension = getImageExtension(
            mimeType,
            metadata.name
        );

        const tempFile = path.join(
            os.tmpdir(),
            `tratocore-${crypto.randomUUID()}${extension}`
        );

        try {
            const stream =
                await googleDriveOAuthService.getFileStream(driveFileId);

            await pipeline(
                stream,
                fs.createWriteStream(tempFile)
            );

            return {
                caminhoImagem: tempFile,
                temporario: true
            };
        } catch (error) {
            try {
                fs.unlinkSync(tempFile);
            } catch (_) {}

            throw new Error(
                `Não foi possível baixar a imagem do Google Drive: ${error.message}`
            );
        }
    }

    // Compatibilidade com imagens armazenadas localmente
    let caminhoImagem = String(imageUrl).trim();

    caminhoImagem = caminhoImagem.replace(
        /^https?:\/\/[^/]+/i,
        ""
    );

    caminhoImagem = caminhoImagem.replace(/^\/+/, "");

    caminhoImagem = path.resolve(
        __dirname,
        "../../",
        caminhoImagem
    );

    if (!fs.existsSync(caminhoImagem)) {
        throw new Error("Imagem não encontrada.");
    }

    return {
        caminhoImagem,
        temporario: false
    };
}


// ==================================================
// ANALISAR PRODUTO
// ==================================================

router.post("/analyze", async (req, res) => {
    let imagemTemporaria = null;

    try {
        const {
            imageUrl,
            observacaoVendedor = ""
        } = req.body || {};

        if (!imageUrl) {
            return res.status(400).json({
                sucesso: false,
                erro: "imageUrl não informado."
            });
        }

        // 1. PREPARAR IMAGEM

        const imagem = await prepareImage(imageUrl);

        const caminhoImagem = imagem.caminhoImagem;

        if (imagem.temporario) {
            imagemTemporaria = caminhoImagem;
        }

        // 2. PESQUISA VISUAL

        let pesquisaVisual = {
            provider: "unavailable",
            search_url: "",
            links: [],
            erro: null
        };

        try {
            const pesquisa = await pesquisarImagem(caminhoImagem);

            if (pesquisa && typeof pesquisa === "object") {
                pesquisaVisual = {
                    ...pesquisaVisual,
                    ...pesquisa,
                    links: Array.isArray(pesquisa.links)
                        ? pesquisa.links
                        : []
                };
            }
        } catch (err) {
            console.error(
                "Google Lens indisponível; continuando análise:",
                err.message
            );

            pesquisaVisual.erro =
                err.message || "Pesquisa visual indisponível.";
        }

        // 3. IDENTIFICAÇÃO

        const resultado = await analisarImagem(
            caminhoImagem,
            pesquisaVisual,
            observacaoVendedor
        );

        if (!resultado || typeof resultado !== "object") {
            throw new Error(
                "A análise da imagem não retornou uma identificação válida."
            );
        }

        // 4. CATALOG MATCHER

        const catalogIdentification = {
            ...(resultado.catalog_input || {}),
            product_type: resultado.product_type || "",
            brand: resultado.brand || "",
            line: resultado.line || "",
            model: resultado.model || "",
            generation: resultado.generation || ""
        };

        let catalogMatch = null;

        try {
            catalogMatch = await findCatalogMatch(
                catalogIdentification
            );
        } catch (err) {
            console.error("ERRO NO CATALOG MATCHER:", err);

            catalogMatch = {
                found: false,
                confidence: "LOW",
                best: null,
                ranked: [],
                candidates_received: 0,
                error: err.message
            };
        }

        // 5. COPYWRITER

        let listing = null;

        try {
            listing = await buildListing({
                identification: resultado.identification || {},
                facts: resultado.facts || [],
                cross_check: resultado.cross_check || {},
                catalogMatch,
                sellerObservation: observacaoVendedor
            });
        } catch (err) {
            console.error("ERRO NO COPYWRITER:", err);

            listing = {
                title: "",
                description: "",
                suggested_price: 0,
                category: "",
                error: err.message
            };
        }

        // 6. COMPATIBILIDADE COM O FRONTEND

        const listingCompat = listing || {};

        const resultadoCompat = {
            ...resultado,

            title: String(
                listingCompat.title || resultado.title || ""
            ).trim(),

            description: String(
                listingCompat.description || resultado.description || ""
            ).trim(),

            suggested_price: Number.isFinite(
                Number(listingCompat.suggested_price)
            )
                ? Number(listingCompat.suggested_price)
                : Number(resultado.suggested_price || 0),

            category: String(
                listingCompat.category || resultado.category || ""
            ).trim(),

            listing_draft: {
                title: String(
                    listingCompat.title || resultado.title || ""
                ).trim(),

                description: String(
                    listingCompat.description || resultado.description || ""
                ).trim(),

                suggested_price: Number.isFinite(
                    Number(listingCompat.suggested_price)
                )
                    ? Number(listingCompat.suggested_price)
                    : Number(resultado.suggested_price || 0),

                category: String(
                    listingCompat.category || resultado.category || ""
                ).trim()
            }
        };

        // 7. RESPOSTA FINAL

        return res.json({
            sucesso: true,

            pesquisaVisual: {
                provider: pesquisaVisual.provider || "unavailable",
                search_url: pesquisaVisual.search_url || "",
                links: Array.isArray(pesquisaVisual.links)
                    ? pesquisaVisual.links
                    : [],
                erro: pesquisaVisual.erro || null
            },

            resultado: resultadoCompat,
            catalogMatch,
            listing
        });

    } catch (err) {
        console.error("ERRO NA ANÁLISE DO PRODUTO:", err);

        return res.status(500).json({
            sucesso: false,
            erro: err.message || "Erro ao analisar o produto."
        });

    } finally {
        // REMOVER ARQUIVO TEMPORÁRIO

        if (imagemTemporaria) {
            try {
                await fs.promises.unlink(imagemTemporaria);
            } catch (err) {
                console.error(
                    "Não foi possível remover imagem temporária:",
                    err.message
                );
            }
        }
    }
});


// ======================================================
// CORRIGIR RASCUNHO + ESTIMAR PREÇO
// ======================================================

router.post("/improve-draft", async (req, res) => {
    try {
        const resultado = await improveListing(req.body || {});

        return res.json({
            sucesso: true,
            resultado
        });

    } catch (err) {
        console.error("ERRO AO CORRIGIR RASCUNHO:", err);

        return res.status(500).json({
            sucesso: false,
            erro: err.message || "Erro ao corrigir o rascunho."
        });
    }
});


// ======================================================
// STATUS DA IA LOCAL
// ======================================================

router.get("/local-status", async (req, res) => {
    try {
        return res.json({
            sucesso: true,
            ...await localAI.status()
        });

    } catch (err) {
        return res.status(500).json({
            sucesso: false,
            erro: err.message
        });
    }
});

module.exports = router;