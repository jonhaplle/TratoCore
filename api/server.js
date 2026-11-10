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
const createDriveStatusRouter = require("./routes/driveStatus");
const googleDriveService = require("./services/googleDriveService");
const { createGoogleDriveOAuthRouter } = require("./routes/googleDriveOAuth");

const app = express();

// ======================================================
// CONFIGURAÇÕES
// ======================================================

app.use(cors());

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
// ARQUIVOS ESTÁTICOS
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
app.use("/api/version", versionRoutes);

// Módulo independente de atendimento ao cliente.
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
        imagens: "product_images",
        modulo_vendedor: "1.0.0"
    });
});

// ======================================================
// 404
// ======================================================

app.use((req, res) => {
    res.status(404).json({
        erro: "Rota não encontrada."
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
    console.log("Trato Vendedor IA:");
    console.log(`http://localhost:${PORT}/vendedor.html`);
    console.log("");
    console.log("API Vendedor:");
    console.log(`http://localhost:${PORT}/api/vendedor/status`);
    console.log("");
    console.log("Storage:");
    console.log(storagePath);
    console.log("");
    console.log("======================================");
});
