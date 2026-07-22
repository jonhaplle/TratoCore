const { Pool } = require("pg");
const path = require("path");

const result = require("dotenv").config({
    path: path.join(__dirname, "..", ".env")
});

console.log("ENV carregado:", !result.error);
console.log({
    DB_HOST: process.env.DB_HOST,
    DB_PORT: process.env.DB_PORT,
    DB_NAME: process.env.DB_NAME,
    DB_USER: process.env.DB_USER,
    DB_PASSWORD: process.env.DB_PASSWORD ? "(preenchida)" : "(vazia)"
});

const pool = new Pool({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT, 10),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD || undefined
});

pool.connect()
    .then(() => {
        console.log("✅ PostgreSQL conectado");
    })
    .catch((err) => {
        console.error("❌ Erro ao conectar:");
        console.error(err);
    });

module.exports = pool;