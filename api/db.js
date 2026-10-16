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
    .then(async client => {
        try {
            console.log("PostgreSQL conectado");

            // A migraÃ§Ã£o roda somente no Render; a base local nÃ£o Ã© alterada.
            if (process.env.RENDER === "true") {
                await client.query(`
                    ALTER TABLE product_images
                        ADD COLUMN IF NOT EXISTS drive_file_id TEXT,
                        ADD COLUMN IF NOT EXISTS drive_folder_id TEXT,
                        ADD COLUMN IF NOT EXISTS drive_web_view_link TEXT
                `);
                console.log("product_images_drive verificada no Render");
            }
        } catch (err) {
            console.error("Erro na conexÃ£o ou migraÃ§Ã£o inicial do PostgreSQL:");
            console.error(err);
        } finally {
            client.release();
        }
    })
    .catch(err => {
        console.error("Erro ao conectar PostgreSQL:");
        console.error(err);
    });

module.exports = pool;