const express = require("express");

const productService = require("../services/productService");
const sellerListing = require("../services/seller/sellerListing.service");
const tratocapDevice = require("../services/tratocapDevice.service");

const router = express.Router();

/**
 * ENTREVISTA INTELIGENTE — rotas consumidas pelo TratoCap.
 *
 * O TratoCore é o cérebro: gera as perguntas a partir dos atributos
 * obrigatórios da categoria do Mercado Livre e das informações que já
 * existem no cadastro. O TratoCap apenas apresenta e coleta respostas.
 *
 * Regras:
 *  - Nunca pergunta algo que já está preenchido e confirmado.
 *  - Perguntas mudam conforme a categoria (via publicationSpec).
 *  - As quatro medidas reais da embalagem são sempre solicitadas ao
 *    vendedor — nunca estimadas.
 *  - Respostas são persistidas no PostgreSQL (products.ml_attributes e
 *    products.seller_observation). Nenhum arquivo local é usado.
 *  - Nenhuma rota publica anúncio.
 */

/**
 * Proteção simples por chave compartilhada com o TratoCap.
 * Sem a chave configurada, a rota fica desabilitada (falha fechada).
 * Não usa requirePublishKey: o TratoCap não tem a chave de publicação.
 */
/**
 * Proteção da entrevista.
 *
 * Ordem de aceitação (transição para dispositivos pareados):
 *   1. Token de DISPOSITIVO pareado — modelo definitivo
 *   2. TRATOCAP_SYNC_KEY — compatibilidade com o app já instalado
 *
 * Sem nenhum dos dois, falha fechado (503).
 */
async function requireSyncKey(req, res, next) {
    const enviada = extrairCredencial(req);

    if (!enviada) {
        return res.status(401).json({
            success: false,
            code: "UNAUTHORIZED",
            error: "Informe o token do dispositivo."
        });
    }

    // 1) Token de dispositivo pareado.
    try {
        const dispositivo = await tratocapDevice.validarToken(enviada);

        if (dispositivo) {
            req.dispositivo = dispositivo;
            return next();
        }
    } catch (error) {
        console.warn("[Entrevista] Falha ao validar dispositivo:", String(error.message || "").slice(0, 120));
    }

    // 2) Chave global (compatibilidade temporária).
    const esperada = process.env.TRATOCAP_SYNC_KEY;

    if (!esperada) {
        return res.status(503).json({
            success: false,
            code: "ATIVACAO_PENDENTE",
            error: "Nenhum dispositivo pareado e TRATOCAP_SYNC_KEY não configurada."
        });
    }

    if (!esperadaCompleta(esperada, enviada)) {
        return res.status(401).json({ success: false, code: "UNAUTHORIZED", error: "Chave inválida." });
    }

    if (req.body && Object.hasOwn(req.body, "syncKey")) delete req.body.syncKey;

    return next();
}

/** Extrai a credencial do header ou do corpo da requisição. */
function extrairCredencial(req) {
    const cabecalho = req.get?.("Authorization")?.replace(/^Bearer\s*/i, "").trim();
    if (cabecalho) return cabecalho;

    const corpo = req.body || {};
    const chave = typeof corpo.syncKey === "string" ? corpo.syncKey.trim() : "";
    if (chave) return chave;

    const token = typeof corpo.deviceToken === "string" ? corpo.deviceToken.trim() : "";
    return token || "";
}

function esperadaCompleta(esperada, enviada) {
    if (typeof esperada !== "string" || typeof enviada !== "string") return false;
    if (esperada.length === 0 || esperada.length !== enviada.length) return false;

    const crypto = require("crypto");
    return crypto.timingSafeEqual(Buffer.from(esperada), Buffer.from(enviada));
}

/**
 * Separa as perguntas por natureza, para a interface priorizar.
 *   obrigatoria  — bloqueia a publicação
 *   condicional  — depende de outro atributo
 *   comercial    — útil para vender melhor (preço, fotos)
 */
function classificarPergunta(pergunta) {
    const campo = String(pergunta.field || "");

    if (campo === "sale_price" || campo === "photos") return "comercial";
    if (campo.startsWith("confirm_attribute:")) return "condicional";
    if (campo.startsWith("attribute:")) {
        const id = campo.replace("attribute:", "");
        return /^SELLER_PACKAGE_/.test(id) ? "obrigatoria" : "obrigatoria";
    }
    if (campo === "condition") return "obrigatoria";

    return "comercial";
}

function montarPerguntas(review) {
    const bruto = Array.isArray(review.questions) ? review.questions : [];

    return bruto.map((q, indice) => ({
        id: q.field || `pergunta_${indice}`,
        campo: q.field || "",
        atributo_id: q.attribute_id || null,
        tipo: classificarPergunta(q),
        pergunta: q.question || "",
        opcoes: Array.isArray(q.options) ? q.options : [],
        sugestao: q.suggested || null,
        confianca: q.confidence || null,
        origem: q.source || null,
        nota: q.note || "",
        // Medidas da embalagem nunca vêm com sugestão: o vendedor informa.
        eh_medida_embalagem: /^SELLER_PACKAGE_/.test(q.attribute_id || "")
    }));
}

/**
 * GET /api/tratocap/interview/:album
 *
 * Retorna a entrevista do álbum. O álbum é a pasta onde o TratoCap subiu
 * as fotos; ela chega ao produto pelo marcador `.tratocore-import.json`.
 */
router.get("/interview/:album", requireSyncKey, async (req, res) => {
    try {
        const album = String(req.params.album || "").trim();

        if (!album) {
            return res.status(400).json({ success: false, error: "Informe o álbum." });
        }

        const produto = await encontrarProdutoDoAlbum(album);

        if (!produto) {
            return res.status(404).json({
                success: false,
                code: "PRODUTO_NAO_ENCONTRADO",
                error: "Nenhum produto vinculado a este álbum ainda. Envie as fotos primeiro."
            });
        }

        const review = await sellerListing.buildReview({
            productId: produto.id,
            skipAi: false,
            skipPrice: false
        });

        const perguntas = montarPerguntas(review);

        return res.json({
            success: true,
            album,
            produto: {
                id: produto.id,
                title: produto.title,
                categoria: review.category?.id || null,
                categoria_nome: review.category?.name || null
            },
            perguntas,
            resumo: {
                total: perguntas.length,
                obrigatorias: perguntas.filter(p => p.tipo === "obrigatoria").length,
                condicionais: perguntas.filter(p => p.tipo === "condicional").length,
                comerciais: perguntas.filter(p => p.tipo === "comercial").length
            },
            pronto_para_publicar: Boolean(review.ready_to_publish)
        });
    } catch (error) {
        console.error("[Entrevista] Falha ao montar perguntas:", String(error.message || "").slice(0, 160));
        return res.status(500).json({ success: false, error: "Não foi possível montar a entrevista." });
    }
});

/**
 * POST /api/tratocap/answers
 *
 * Recebe as respostas do TratoCap, persiste no PostgreSQL e devolve as
 * perguntas restantes. O vendedor pode responder em partes.
 *
 * Corpo:
 *   { album, respostas: [{ atributo_id, valor, opcao_id? }], observacao? }
 */
router.post("/answers", requireSyncKey, async (req, res) => {
    try {
        const body = req.body || {};
        const album = String(body.album || "").trim();
        const respostas = Array.isArray(body.respostas) ? body.respostas : [];

        if (!album) {
            return res.status(400).json({ success: false, error: "Informe o álbum." });
        }

        if (!respostas.length && !body.observacao) {
            return res.status(400).json({
                success: false,
                code: "SEM_RESPOSTAS",
                error: "Envie ao menos uma resposta ou uma observação."
            });
        }

        const produto = await encontrarProdutoDoAlbum(album);

        if (!produto) {
            return res.status(404).json({
                success: false,
                code: "PRODUTO_NAO_ENCONTRADO",
                error: "Nenhum produto vinculado a este álbum."
            });
        }

        // 1) Respostas viram overrides de atributo.
        const attributeOverrides = {};

        for (const resposta of respostas) {
            const id = String(resposta?.atributo_id || "").trim();
            if (!id) continue;

            const valorTexto = String(resposta?.valor ?? "").trim();
            const valorId = String(resposta?.opcao_id ?? "").trim();

            if (!valorTexto && !valorId) continue;

            attributeOverrides[id] = valorId
                ? { id, value_id: valorId, value_name: valorTexto || valorId }
                : { id, value_name: valorTexto };
        }

        if (!Object.keys(attributeOverrides).length && !body.observacao) {
            return res.status(400).json({
                success: false,
                code: "SEM_RESPOSTAS_VALIDAS",
                error: "Nenhuma resposta tinha atributo_id e valor."
            });
        }

        // 2) Recalcula com as respostas (não grava ainda).
        const review = await sellerListing.buildReview({
            productId: produto.id,
            sellerObservation: body.observacao || produto.seller_observation || "",
            attributeOverrides
        });

        // 3) Persiste apenas o que é seguro: observação e a categoria.
        const atualizacao = {};

        if (body.observacao) {
            atualizacao.seller_observation = String(body.observacao).slice(0, 4000);
        }

        if (review?.category?.id) {
            atualizacao.ml_category_id = review.category.id;
        }

        // Atributos confirmados ficam em ml_attributes (JSONB), com merge —
        // preservando qualquer dado anterior de outros processos.
        const anterior = produto.ml_attributes && typeof produto.ml_attributes === "object"
            ? produto.ml_attributes
            : {};

        const atributosAnteriores = anterior.entrevista?.atributos || {};

        atualizacao.ml_attributes = {
            ...anterior,
            entrevista: {
                atualizado_em: new Date().toISOString(),
                album,
                atributos: { ...atributosAnteriores, ...normalizarParaJson(attributeOverrides) }
            }
        };

        await productService.update(produto.id, atualizacao);

        const perguntas = montarPerguntas(review);

        return res.json({
            success: true,
            album,
            produto_id: produto.id,
            respondidas: Object.keys(attributeOverrides).length,
            perguntas,
            resumo: {
                total: perguntas.length,
                obrigatorias: perguntas.filter(p => p.tipo === "obrigatoria").length,
                condicionais: perguntas.filter(p => p.tipo === "condicional").length,
                comerciais: perguntas.filter(p => p.tipo === "comercial").length
            },
            pronto_para_publicar: Boolean(review.ready_to_publish)
        });
    } catch (error) {
        console.error("[Entrevista] Falha ao salvar respostas:", String(error.message || "").slice(0, 160));
        return res.status(500).json({ success: false, error: "Não foi possível salvar as respostas." });
    }
});

function normalizarParaJson(overrides) {
    const saida = {};

    for (const [id, valor] of Object.entries(overrides || {})) {
        saida[id] = {
            value_id: valor.value_id || null,
            value_name: valor.value_name || ""
        };
    }

    return saida;
}

/**
 * Encontra o produto vinculado ao álbum.
 *
 * O vínculo já existe: o import grava `.tratocore-import.json` com
 * `product_id`, e `tratocap_sync_jobs.imported_product_id` também guarda.
 * Priorizamos a tabela (fonte durável) e caímos para o marcador em disco.
 */
async function encontrarProdutoDoAlbum(album) {
    const db = require("../db");

    // 1) Fonte durável: jobs já importados.
    try {
        const { rows } = await db.query(
            `SELECT DISTINCT imported_product_id
               FROM tratocap_sync_jobs
              WHERE album_name = $1
                AND imported_product_id IS NOT NULL
              LIMIT 1`,
            [album]
        );

        if (rows[0]?.imported_product_id) {
            const produto = await productService.getById(rows[0].imported_product_id);
            if (produto) return produto;
        }
    } catch (_) {
        // tabela pode não existir em ambiente novo; segue para o marcador.
    }

    // 2) Marcador deixado pelo import.
    try {
        const fs = require("fs");
        const path = require("path");
        const raiz = path.join(__dirname, "..", "..", "storage", "tratocap", "albums");
        const marcador = path.join(raiz, album, ".tratocore-import.json");

        if (fs.existsSync(marcador)) {
            const meta = JSON.parse(fs.readFileSync(marcador, "utf8"));
            if (meta?.product_id) {
                const produto = await productService.getById(meta.product_id);
                if (produto) return produto;
            }
        }
    } catch (_) {
        // marcador ausente: sem produto vinculado.
    }

    return null;
}

// ======================================================
// PAREAMENTO DE DISPOSITIVOS (rotas administrativas)
// ======================================================
// O administrador gera o código; o vendedor digita no app; o app recebe
// um token próprio e o guarda no Android Keystore. Não há chave global
// embutida no APK.

/** Chave de administração (reaproveita a de publicação). */
function requireAdmin(req, res, next) {
    const esperada = process.env.TRATO_VENDEDOR_ADMIN_KEY;

    if (!esperada) {
        return res.status(503).json({
            success: false,
            code: "ADMIN_KEY_NOT_CONFIGURED",
            error: "Configure TRATO_VENDEDOR_ADMIN_KEY para gerenciar dispositivos."
        });
    }

    const enviada = extrairCredencial(req);

    if (!esperadaCompleta(esperada, enviada)) {
        return res.status(401).json({ success: false, code: "UNAUTHORIZED", error: "Acesso não autorizado." });
    }

    return next();
}

/** Gera um código de pareamento válido por 10 minutos. */
router.post("/devices/pairing-code", requireAdmin, async (req, res) => {
    try {
        const resultado = await tratocapDevice.criarCodigoPareamento({
            apelidoSugerido: req.body?.apelido || ""
        });

        return res.json({
            success: true,
            codigo: resultado.codigo,
            expira_em: resultado.expira_em,
            validade_minutos: resultado.validade_minutos,
            instrucao: "Digite este código no TratoCap dentro de 10 minutos."
        });
    } catch (error) {
        console.error("[Entrevista] Falha ao gerar código:", String(error.message || "").slice(0, 160));
        return res.status(500).json({ success: false, error: "Não foi possível gerar o código." });
    }
});

/** O app troca o código por um token de dispositivo. */
router.post("/devices/pair", async (req, res) => {
    try {
        const resultado = await tratocapDevice.parearDispositivo({
            codigo: req.body?.codigo,
            apelido: req.body?.apelido || ""
        });

        if (resultado.erro) {
            return res.status(401).json({
                success: false,
                code: "CODIGO_INVALIDO",
                error: "Código inválido ou expirado. Gere um novo."
            });
        }

        // O token só aparece aqui. Não é registrado em log.
        return res.json({
            success: true,
            token: resultado.token,
            device: resultado.device,
            aviso: "Guarde este token no armazenamento seguro do aparelho."
        });
    } catch (error) {
        console.error("[Entrevista] Falha no pareamento:", String(error.message || "").slice(0, 160));
        return res.status(500).json({ success: false, error: "Não foi possível parear o dispositivo." });
    }
});

/** Lista dispositivos (sem tokens). */
router.get("/devices", requireAdmin, async (req, res) => {
    try {
        const dispositivos = await tratocapDevice.listarDispositivos();
        return res.json({ success: true, total: dispositivos.length, dispositivos });
    } catch (error) {
        return res.status(500).json({ success: false, error: "Não foi possível listar os dispositivos." });
    }
});

/** Revoga um dispositivo específico. */
router.delete("/devices/:id", requireAdmin, async (req, res) => {
    try {
        const revogado = await tratocapDevice.revogarDispositivo(req.params.id);

        if (!revogado) {
            return res.status(404).json({ success: false, error: "Dispositivo não encontrado ou já revogado." });
        }

        return res.json({ success: true, revogado });
    } catch (error) {
        return res.status(500).json({ success: false, error: "Não foi possível revogar o dispositivo." });
    }
});

module.exports = router;
module.exports.classificarPergunta = classificarPergunta;
module.exports.montarPerguntas = montarPerguntas;
module.exports.extrairCredencial = extrairCredencial;
