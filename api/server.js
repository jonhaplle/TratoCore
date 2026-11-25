require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");

require("./db");

const productsRoutes = require("./routes/products");
const uploadRoutes = require("./routes/upload");
const aiRoutes = require("./routes/ai");
const productImagesRoutes = require("./routes/productImages");
const mlRoutes = require("./routes/ml");
const tratocapRoutes = require("./routes/tratocap");
const versionRoutes = require("./routes/version");
const vendedorRoutes = require("./routes/vendedor");
const tratocapInterviewRoutes = require("./routes/tratocapInterview");
const createDriveStatusRouter = require("./routes/driveStatus");
const googleDriveService = require("./services/googleDriveService");
const { createGoogleDriveOAuthRouter } = require("./routes/googleDriveOAuth");

const app = express();

// ======================================================
// CONFIGURAÃ‡Ã•ES
// ======================================================

// CORS restrito. Sem APP_ORIGINS definido, libera apenas localhost/127.0.0.1
// (desenvolvimento) â€” nunca "*" em produÃ§Ã£o. Origens sÃ£o comparadas exatamente.
const ORIGENS_PERMITIDAS = [
    ...String(process.env.APP_ORIGINS || "")
        .split(",")
        .map(item => item.trim().replace(/\/+$/, ""))
        .filter(Boolean),
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:3080",
    "http://127.0.0.1:3080"
];

app.use(cors({
    origin(origin, callback) {
        // RequisiÃ§Ãµes sem Origin (curl, apps nativos, same-origin) passam.
        if (!origin) return callback(null, true);

        const limpa = String(origin).trim().replace(/\/+$/, "");
        if (ORIGENS_PERMITIDAS.includes(limpa)) return callback(null, true);

        return callback(null, false);
    },
    credentials: true
}));

app.use(express.json({ limit: "50mb" }));

app.use(express.urlencoded({
    extended: true,
    limit: "50mb"
}));

// ======================================================
// PASTAS
// ======================================================

const storagePath = path.join(__dirname, "../storage");
const productsPath = path.join(storagePath, "products");

if (!fs.existsSync(storagePath)) {
    fs.mkdirSync(storagePath, { recursive: true });
}

if (!fs.existsSync(productsPath)) {
    fs.mkdirSync(productsPath, { recursive: true });
}

// ======================================================
// ARQUIVOS ESTÃTICOS
// ======================================================

app.use(express.static(path.join(__dirname, "../public")));

app.use("/storage", express.static(storagePath));

// ======================================================
// ROTAS API
// ======================================================

app.use("/api/products", productsRoutes);

app.use("/api/upload", uploadRoutes);

app.use("/api/ai", aiRoutes);

app.use("/api/product-images", productImagesRoutes);

app.use("/api/ml", mlRoutes);

app.use("/api/tratocap", tratocapRoutes);
app.use("/api/tratocap", tratocapInterviewRoutes);

app.use("/api/version", versionRoutes);

// MÃ³dulo independente de atendimento ao cliente.
app.use("/api/vendedor", vendedorRoutes);

// ======================================================
// GOOGLE DRIVE
// ======================================================

app.use("/api/drive/status", createDriveStatusRouter(googleDriveService));
app.use("/api/google-drive/oauth", createGoogleDriveOAuthRouter());

// ======================================================
// HOME
// ======================================================

app.get("/", (req, res) => {

    res.sendFile(path.join(__dirname, "../public/index.html"));

});

// ======================================================
// STATUS
// ======================================================

app.get("/api", (req, res) => {

    res.json({

        sistema: "Trato Core",

        versao: "0.6.0",

        status: "online",

        banco: "PostgreSQL",

        upload: "ativo",

        ia: "OpenAI",

        storage: "/storage",

        imagens: "product_images"

    });

});

// ======================================================
// 404
// ======================================================

app.use((req, res) => {

    res.status(404).json({

        erro: "Rota nÃ£o encontrada."

    });

});

// ======================================================
// ERROS
// ======================================================

app.use((err, req, res, next) => {

    console.error("======================================");
    console.error("ERRO");
    console.error("======================================");
    console.error(err);

    res.status(500).json({

        sucesso: false,

        erro: err.message || "Erro interno do servidor."

    });

});

// ======================================================
// START
// ======================================================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {

    console.log("======================================");
    console.log("        TRATO CORE 0.6.0");
    console.log("======================================");
    console.log("");
    console.log("Servidor:");
    console.log(`http://localhost:${PORT}`);
    console.log("");
    console.log("API:");
    console.log(`http://localhost:${PORT}/api`);
    console.log("");
    console.log("Produtos:");
    console.log(`http://localhost:${PORT}/api/products`);
    console.log("");
    console.log("Upload:");
    console.log(`http://localhost:${PORT}/api/upload`);
    console.log("");
    console.log("Imagens:");
    console.log(`http://localhost:${PORT}/api/product-images`);
    console.log("");
    console.log("IA:");
    console.log(`http://localhost:${PORT}/api/ai/analyze`);
    console.log("");
    console.log("TratoCap Sync:");
    console.log(`http://localhost:${PORT}/api/tratocap/status`);
    console.log("");
    console.log("Google Drive:");
    console.log(`http://localhost:${PORT}/api/drive/status`);
    console.log("");
    console.log("Storage:");
    console.log(storagePath);
    console.log("");
    console.log("OpenAI:");
    console.log(process.env.OPENAI_API_KEY ? "Chave carregada" : "Chave nÃ£o encontrada");
    console.log("");
    console.log("======================================");


    // ------------------------------------------------------------------
    // C1 - recuperação determinística dos álbuns do TratoCap.
    //
    // Roda uma vez, logo após o servidor começar a escutar. Não usa timer:
    // o scheduleAutoImport original (setTimeout + unref) se perdia quando
    // o Render entrava em sleep, deixando álbuns sem produto para sempre.
    //
    // Falha aqui NÃO derruba o servidor: apenas registra o erro.
    // ------------------------------------------------------------------
    (async () => {
        try {
            const tratocap = require("./routes/tratocap");

            if (typeof tratocap.recuperarAlbunsNoBoot === "function") {
                await tratocap.recuperarAlbunsNoBoot();
            }
        } catch (erro) {
            console.error("[TratoCap][C1] Falha na recuperação de boot:", String(erro.message || "").slice(0, 200));
        }
    })();

});
