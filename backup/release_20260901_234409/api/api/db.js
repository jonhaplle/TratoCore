const { Pool } = require("pg");
const path = require("path");

require("dotenv").config({
    path: path.join(__dirname, "..", ".env")
});

const config = {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    database: process.env.DB_NAME,
    user: process.env.DB_USER
};

if (process.env.DB_PASSWORD) {
    config.password = process.env.DB_PASSWORD;
}

const pool = new Pool(config);

pool.connect()
    .then(client => {
        console.log("✅ PostgreSQL conectado");
        client.release();
    })
    .catch(err => {
        console.error("❌ Erro ao conectar:");
        console.error(err);
    });

module.exports = pool;