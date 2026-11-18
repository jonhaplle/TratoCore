const crypto = require("crypto");

const db = require("../db");

/**
 * PAREAMENTO DE DISPOSITIVOS DO TRATOCAP
 *
 * Substitui a chave global `TRATOCAP_SYNC_KEY`. Cada dispositivo (celular)
 * recebe um token próprio, emitido por um código curto de pareamento que
 * um administrador gera e o vendedor digita no app.
 *
 * Por que assim:
 *  - Nenhum segredo vai embutido no APK.
 *  - Vazamento de um aparelho não compromete os outros: basta revogar.
 *  - O código de pareamento expira em 10 minutos e tem limite de tentativas.
 *
 * O token é gerado aqui e MOSTRADO UMA ÚNICA VEZ. O banco guarda apenas o
 * SHA-256 dele — quem ler a tabela não consegue reconstruir o token.
 */

const VALIDADE_CODIGO_MS = 10 * 60 * 1000;   // 10 minutos
const MAX_TENTATIVAS = 5;
const BYTES_TOKEN = 32;

let schemaPromise;

async function ensureSchema() {
    if (!schemaPromise) {
        schemaPromise = (async () => {
            await db.query(`
                CREATE TABLE IF NOT EXISTS tratocap_devices (
                    id BIGSERIAL PRIMARY KEY,
                    token_hash TEXT NOT NULL UNIQUE,
                    apelido VARCHAR(80) NOT NULL DEFAULT '',
                    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    ultimo_uso TIMESTAMPTZ,
                    revogado BOOLEAN NOT NULL DEFAULT FALSE,
                    revogado_em TIMESTAMPTZ
                )
            `);

            await db.query(`
                CREATE INDEX IF NOT EXISTS idx_tratocap_devices_ativo
                    ON tratocap_devices(token_hash)
                    WHERE revogado = FALSE
            `);

            await db.query(`
                CREATE TABLE IF NOT EXISTS tratocap_pairing_codes (
                    codigo_hash TEXT PRIMARY KEY,
                    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    expira_em TIMESTAMPTZ NOT NULL,
                    tentativas INTEGER NOT NULL DEFAULT 0,
                    consumido BOOLEAN NOT NULL DEFAULT FALSE
                )
            `);

            await db.query(`
                CREATE INDEX IF NOT EXISTS idx_tratocap_pairing_expira
                    ON tratocap_pairing_codes(expira_em)
                    WHERE consumido = FALSE
            `);
        })().catch(error => {
            schemaPromise = null;
            throw error;
        });
    }

    return schemaPromise;
}

function hashToken(token) {
    return crypto.createHash("sha256").update(String(token), "utf8").digest("hex");
}

/** Gera um código numérico de 8 dígitos, legível para digitar no celular. */
function gerarCodigo() {
    // crypto.randomInt evita viés de módulo.
    const numero = crypto.randomInt(0, 100000000);
    return String(numero).padStart(8, "0");
}

/**
 * Cria um código de pareamento. Devolve o código em texto (só esta vez).
 */
async function criarCodigoPareamento({ apelidoSugerido = "" } = {}) {
    await ensureSchema();

    const codigo = gerarCodigo();
    const codigoHash = hashToken(codigo);
    const expira = new Date(Date.now() + VALIDADE_CODIGO_MS);

    await db.query(
        `INSERT INTO tratocap_pairing_codes (codigo_hash, expira_em)
         VALUES ($1, $2)
         ON CONFLICT (codigo_hash) DO UPDATE
            SET criado_em = NOW(), expira_em = $2, tentativas = 0, consumido = FALSE`,
        [codigoHash, expira]
    );

    return {
        codigo,
        expira_em: expira.toISOString(),
        validade_minutos: VALIDADE_CODIGO_MS / 60000,
        apelido_sugerido: String(apelidoSugerido || "").slice(0, 80)
    };
}

/**
 * Consome um código e emite um token para o dispositivo.
 *
 * Devolve { token, device } em caso de sucesso, ou { erro: "codigo" }.
 */
async function parearDispositivo({ codigo, apelido = "" } = {}) {
    await ensureSchema();

    const codigoLimpo = String(codigo || "").replace(/\D/g, "");
    if (codigoLimpo.length !== 8) {
        return { erro: "codigo_invalido" };
    }

    const codigoHash = hashToken(codigoLimpo);

    // Consome o código atomicamente: só passa se ainda for válido.
    const { rows } = await db.query(
        `UPDATE tratocap_pairing_codes
            SET consumido = TRUE,
                tentativas = tentativas + 1
          WHERE codigo_hash = $1
            AND consumido = FALSE
            AND expira_em > NOW()
            AND tentativas < $2
        RETURNING codigo_hash`,
        [codigoHash, MAX_TENTATIVAS]
    );

    if (!rows.length) {
        // Registra a tentativa frustrada (se o código existir).
        await db.query(
            `UPDATE tratocap_pairing_codes
                SET tentativas = tentativas + 1
              WHERE codigo_hash = $1 AND consumido = FALSE`,
            [codigoHash]
        ).catch(() => {});

        return { erro: "codigo_invalido" };
    }

    const token = crypto.randomBytes(BYTES_TOKEN).toString("base64url");
    const tokenHash = hashToken(token);
    const nome = String(apelido || "").trim().slice(0, 80) || "TratoCap";

    const criado = await db.query(
        `INSERT INTO tratocap_devices (token_hash, apelido)
         VALUES ($1, $2)
         RETURNING id, apelido, criado_em`,
        [tokenHash, nome]
    );

    return {
        token,
        device: {
            id: criado.rows[0].id,
            apelido: criado.rows[0].apelido,
            criado_em: criado.rows[0].criado_em
        }
    };
}

/**
 * Valida um token de dispositivo. Devolve o dispositivo ou null.
 * Atualiza `ultimo_uso` sem bloquear a resposta.
 */
async function validarToken(token) {
    if (typeof token !== "string" || token.length < 20) return null;

    await ensureSchema();

    const tokenHash = hashToken(token);

    const { rows } = await db.query(
        `SELECT id, apelido FROM tratocap_devices
          WHERE token_hash = $1 AND revogado = FALSE`,
        [tokenHash]
    );

    if (!rows.length) return null;

    // Atualização de telemetria: falha aqui não invalida a autenticação.
    db.query(
        `UPDATE tratocap_devices SET ultimo_uso = NOW() WHERE id = $1`,
        [rows[0].id]
    ).catch(() => {});

    return { id: rows[0].id, apelido: rows[0].apelido };
}

/** Revoga um dispositivo específico. */
async function revogarDispositivo(id) {
    await ensureSchema();

    const { rows } = await db.query(
        `UPDATE tratocap_devices
            SET revogado = TRUE, revogado_em = NOW()
          WHERE id = $1 AND revogado = FALSE
          RETURNING id, apelido`,
        [id]
    );

    return rows[0] || null;
}

/** Lista dispositivos para o administrador (sem expor tokens). */
async function listarDispositivos() {
    await ensureSchema();

    const { rows } = await db.query(
        `SELECT id, apelido, criado_em, ultimo_uso, revogado, revogado_em
           FROM tratocap_devices
          ORDER BY criado_em DESC
          LIMIT 200`
    );

    return rows;
}

module.exports = {
    ensureSchema,
    criarCodigoPareamento,
    parearDispositivo,
    validarToken,
    revogarDispositivo,
    listarDispositivos,
    hashToken,
    validarFormatoCodigo: (codigo) => /^\d{8}$/.test(String(codigo || "").replace(/\D/g, "")),
    VALIDADE_CODIGO_MS,
    MAX_TENTATIVAS
};
