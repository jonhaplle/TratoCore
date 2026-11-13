const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const db = require("../db");

/**
 * Sincroniza para o Google Drive as imagens de produto que ainda estão
 * apenas no disco local do servidor.
 *
 * Por que existe: o Render não tem disco persistente. Sem `drive_file_id`,
 * `picture.service` não consegue enviar a foto ao Mercado Livre e a publicação
 * falha com "Imagem não encontrada localmente".
 *
 * Decisões importantes (para não corromper nada):
 * - NÃO usa o `client_uuid` como vínculo: as 852 imagens históricas têm
 *   `client_uuid` NULL. O vínculo é feito pelo `product_images.id`.
 * - NÃO apaga arquivos locais nem arquivos do Drive.
 * - É IDEMPOTENTE: imagem que já tem `drive_file_id` é ignorada, então
 *   reprocessar não duplica nada.
 * - Um arquivo só é marcado como enviado DEPOIS de o Drive confirmar.
 */

const ORIGINALS_DIR = path.join(__dirname, "..", "..", "storage", "originals");

function resolverArquivoLocal(image) {
    const referencia = String(image?.original_url || "").trim();
    if (!referencia) return null;

    const relativo = referencia.replace(/^\//, "").replace(/\\/g, "/");
    const absoluto = path.resolve(__dirname, "..", "..", relativo);

    // Não sai da pasta de storage.
    const raiz = path.resolve(__dirname, "..", "..", "storage");
    if (!absoluto.startsWith(raiz)) return null;

    return fs.existsSync(absoluto) ? absoluto : null;
}

function nomeArquivoLegivel(image) {
    const base = String(image.file_name || "").trim();
    if (base) return base;

    const referencia = String(image.original_url || "").trim();
    return path.basename(referencia) || `imagem-${image.id}.jpg`;
}

function tipoMime(image, arquivo) {
    if (image.mime_type) return image.mime_type;

    const ext = path.extname(arquivo).toLowerCase();
    if (ext === ".png") return "image/png";
    if (ext === ".webp") return "image/webp";
    if (ext === ".gif") return "image/gif";
    return "image/jpeg";
}

/** Lista o que está pendente, sem enviar nada. */
async function listarPendentes({ limite = 50, productId = null, apenasComArquivo = true } = {}) {
    const params = [];
    let filtro = "where i.drive_file_id is null";

    if (productId) {
        params.push(productId);
        filtro += ` and i.product_id = $${params.length}`;
    }

    if (apenasComArquivo) {
        filtro += " and i.original_url is not null";
    }

    params.push(Math.max(1, Math.min(2000, Number(limite) || 50)));

    const { rows } = await db.query(`
        select i.id, i.product_id, i.file_name, i.original_url, i.mime_type,
               i.drive_sync_status, p.title
        from product_images i
        join products p on p.id = i.product_id
        ${filtro}
        order by i.id
        limit $${params.length}
    `, params);

    return rows;
}

/** Resumo do estado atual — para relatório e para a tela. */
async function resumo() {
    const { rows } = await db.query(`
        select
            count(*)::int as total,
            count(drive_file_id)::int as com_drive,
            count(*) filter (where drive_file_id is null)::int as sem_drive
        from product_images
    `);

    return rows[0];
}

/**
 * Envia UMA imagem para o Drive e grava os identificadores.
 * Devolve { enviada: boolean, motivo } sem lançar para casos previstos.
 */
async function sincronizarImagem(image, driveService, { albumName } = {}) {
    if (image.drive_file_id) {
        return { enviada: false, motivo: "ja_sincronizada" };
    }

    const arquivo = resolverArquivoLocal(image);

    if (!arquivo) {
        await db.query(`
            update product_images
            set drive_sync_status = 'failed',
                drive_sync_error = $2
            where id = $1 and drive_file_id is null
        `, [image.id, "Arquivo original não encontrado no servidor"]);

        return { enviada: false, motivo: "arquivo_ausente" };
    }

    const conteudo = fs.readFileSync(arquivo);
    const nome = nomeArquivoLegivel(image);
    const mime = tipoMime(image, arquivo);

    // `clientUuid` é usado apenas como nome/descrição no Drive; NÃO é o vínculo
    // do banco (o vínculo é product_images.id, atualizado abaixo).
    const enviado = await driveService.uploadBuffer(
        conteudo,
        nome,
        mime,
        albumName || "TratoCore",
        `product-image-${image.id}`
    );

    if (!enviado?.id) {
        throw new Error("O Google Drive não devolveu o identificador do arquivo.");
    }

    const { rowCount } = await db.query(`
        update product_images
        set drive_file_id = $2,
            drive_folder_id = $3,
            drive_web_view_link = $4,
            drive_sync_status = 'synced',
            drive_sync_error = null,
            drive_synced_at = now()
        where id = $1 and drive_file_id is null
    `, [image.id, enviado.id, enviado.folder_id || null, enviado.web_view_link || null]);

    // rowCount 0 significa que outra execução gravou primeiro (deduplicação).
    if (rowCount === 0) {
        return { enviada: false, motivo: "concorrente" };
    }

    return { enviada: true, drive_file_id: enviado.id };
}

/**
 * Sincroniza um lote. `dryRun` apenas relata o que faria.
 */
async function sincronizarLote({ driveService, limite = 10, productId = null, dryRun = true } = {}) {
    const pendentes = await listarPendentes({ limite, productId });

    if (dryRun) {
        return {
            dryRun: true,
            candidatos: pendentes.length,
            enviadas: 0,
            ignoradas: 0,
            falhas: 0,
            detalhes: pendentes.map(i => ({
                id: i.id,
                product_id: i.product_id,
                arquivo: Boolean(resolverArquivoLocal(i)),
                nome: nomeArquivoLegivel(i)
            }))
        };
    }

    let enviadas = 0;
    let ignoradas = 0;
    const falhas = [];

    for (const image of pendentes) {
        try {
            const resultado = await sincronizarImagem(image, driveService);

            if (resultado.enviada) enviadas += 1;
            else ignoradas += 1;
        } catch (error) {
            mensagemErro(error, image);
            falhas.push({ id: image.id, erro: String(error.message || "").slice(0, 200) });
        }
    }

    return {
        dryRun: false,
        candidatos: pendentes.length,
        enviadas,
        ignoradas,
        falhas: falhas.length,
        detalhes_falhas: falhas
    };
}

async function mensagemErro(error, image) {
    try {
        await db.query(`
            update product_images
            set drive_sync_status = 'failed',
                drive_sync_error = $2
            where id = $1 and drive_file_id is null
        `, [image.id, String(error?.message || error).slice(0, 500)]);
    } catch (_) {
        // Registro do erro não pode derrubar o lote.
    }
}

/** Hash do arquivo — permite detectar duplicatas por conteúdo. */
function hashArquivo(arquivo) {
    return crypto.createHash("sha256").update(fs.readFileSync(arquivo)).digest("hex");
}

module.exports = {
    ORIGINALS_DIR,
    resolverArquivoLocal,
    nomeArquivoLegivel,
    listarPendentes,
    resumo,
    sincronizarImagem,
    sincronizarLote,
    hashArquivo
};
