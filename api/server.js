require("dotenv").config();
require("./db");

const express = require("express");
const cors = require("cors");

const productsRoutes = require("./routes/products");

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
    res.json({
        sistema: "Trato Core",
        versao: "0.1.0",
        status: "online"
    });
});

// Rotas
app.use("/api/products", productsRoutes);

// 404
app.use((req, res) => {
    res.status(404).json({
        erro: "Rota não encontrada."
    });
});

// Tratamento de erro
app.use((err, req, res, next) => {
    console.error(err);

    res.status(500).json({
        erro: "Erro interno do servidor."
    });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log("");
    console.log("=================================");
    console.log(" Trato Core iniciado");
    console.log(` http://localhost:${PORT}`);
    console.log("=================================");
});