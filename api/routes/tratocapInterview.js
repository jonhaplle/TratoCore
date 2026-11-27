const express = require("express");

const productService = require("../services/productService");
const sellerListing = require("../services/seller/sellerListing.service");
const tratocapDevice = require("../services/tratocapDevice.service");
const tratocapRouter = require("./tratocap");

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
    //
    // Uma EXCEÇÃO aqui significa "não foi possível verificar" (banco fora,
    // timeout de query, SSL), e NÃO "credencial inválida". Os dois casos
    // exigem respostas diferentes: confundir um com o outro fazia o app
    // orientar o vendedor a reparear um aparelho que estava correto.
    try {
        const dispositivo = await tratocapDevice.validarToken(enviada);

        if (dispositivo) {
            req.dispositivo = dispositivo;
            return next();
        }
    } catch (error) {
        console.error(
            "[Entrevista] Falha ao validar dispositivo:",
            String(error.message || "").slice(0, 160)
        );

        return res.status(503).json({
            success: false,
            code: "VERIFICACAO_INDISPONIVEL",
            error: "Não foi possível verificar a autorização do aparelho agora. Tente novamente."
        });
    }

    // 2) Chave global (compatibilidade temporária).
    //
    // ATENÇÃO à classificação: o cliente JÁ enviou uma credencial (checado
    // no início). Logo, não havendo dispositivo correspondente, essa
    // credencial é inválida — e a resposta correta é 401, não 503.
    //
    // O 503 fica reservado à ausência total de credencial (ver início),
    // que é o único caso em que o aparelho realmente "não está ativado".
    // Mascarar credencial inválida como 503 impedia o app de detectar
    // revogação e de orientar o vendedor a parear novamente.
    const esperada = process.env.TRATOCAP_SYNC_KEY;

    if (!esperada) {
        return res.status(401).json({
            success: false,
            code: "REVOGADO",
            error: "A autorização deste aparelho não é mais válida. Informe um novo código."
        });
    }

    if (!esperadaCompleta(esperada, enviada)) {
        return res.status(401).json({
            success: false,
            code: "REVOGADO",
            error: "A autorização deste aparelho não é mais válida. Informe um novo código."
        });
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

        // Normaliza o nome antes de consultar disco ou iniciar a importação.
        const nomeAlbum = typeof tratocapRouter.safeAlbumName === "function"
            ? tratocapRouter.safeAlbumName(album)
            : album;

        // Resolução determinística: devolve divergência em vez de escolher.
        let resolucao = await resolverProdutoDoAlbum(nomeAlbum);
        let produto = resolucao?.produto || null;

        // O upload pode ter sido recebido, mas o auto-import ainda estar
        // aguardando o intervalo de estabilização ou ter falhado. A entrevista
        // tenta concluir a importação uma vez antes de declarar que não há produto.
        //
        // NÃO importa quando há divergência de produtos: importar não resolve
        // a ambiguidade e poderia criar um terceiro cadastro.
        if (!produto && !resolucao?.erro && typeof tratocapRouter.importAlbums === "function") {
            const resultadoImportacao = await tratocapRouter.importAlbums(nomeAlbum);
            resolucao = await resolverProdutoDoAlbum(nomeAlbum);
            produto = resolucao?.produto || null;

            if (!produto && !resolucao?.erro && resultadoImportacao?.skipped?.length) {
                console.warn(
                    "[Entrevista] Álbum ainda sem produto após importação:",
                    nomeAlbum,
                    String(resultadoImportacao.skipped[0]?.reason || "").slice(0, 160)
                );
            }
        }

        // Divergência: mais de um produto para o mesmo álbum.
        if (resolucao?.erro === "produtos_duplicados") {
            console.warn(
                "[Entrevista] Álbum com produtos divergentes:",
                nomeAlbum,
                JSON.stringify(resolucao.produtos)
            );

            return res.status(409).json({
                success: false,
                code: "PRODUTOS_DUPLICADOS",
                error: "Este álbum está vinculado a mais de um produto. "
                    + "É preciso reconciliar os cadastros antes de responder a entrevista.",
                produtos: resolucao.produtos
            });
        }

        if (!produto) {
            return res.status(404).json({
                success: false,
                code: "PRODUTO_NAO_ENCONTRADO",
                error: "Não foi possível vincular este álbum a um produto. Verifique se as fotos terminaram de enviar e tente novamente."
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

        // Resolução determinística: nunca gravar num produto arbitrário.
        const resolucao = await resolverProdutoDoAlbum(album);

        if (resolucao?.erro === "produtos_duplicados") {
            return res.status(409).json({
                success: false,
                code: "PRODUTOS_DUPLICADOS",
                error: "Este álbum está vinculado a mais de um produto. "
                    + "É preciso reconciliar os cadastros antes de salvar respostas.",
                produtos: resolucao.produtos
            });
        }

        const produto = resolucao?.produto || null;

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
/**
 * Resolve o produto vinculado a um álbum de forma DETERMINÍSTICA.
 *
 * Devolve `{ produto }`, `{ erro: "produtos_duplicados", produtos: [...] }`
 * ou `null`. NUNCA escolhe o "primeiro" resultado:
 *
 *  1. O marcador `.tratocore-import.json` tem precedência — é a fonte
 *     gravada pela própria importação, com o produto efetivamente vinculado.
 *  2. Sem marcador utilizável, consulta `tratocap_sync_jobs` por TODOS os
 *     `imported_product_id` distintos, sem `LIMIT 1`.
 *  3. Se houver mais de um produto, devolve divergência em vez de escolher.
 */
async function resolverProdutoDoAlbum(album) {
    const db = require("../db");
    const fs = require("fs");
    const path = require("path");

    // 1) Marcador: fonte de maior confiança.
    try {
        // Mesma raiz de `tratocap.js`: env permite isolar em testes.
        const raiz = process.env.TRATOCAP_STORAGE_ROOT
            ? path.join(path.resolve(process.env.TRATOCAP_STORAGE_ROOT), "tratocap", "albums")
            : path.join(__dirname, "..", "..", "storage", "tratocap", "albums");
        const marcador = path.join(raiz, album, ".tratocore-import.json");

        if (fs.existsSync(marcador)) {
            const meta = JSON.parse(fs.readFileSync(marcador, "utf8"));
            const idDoMarcador = Number(meta?.product_id);

            if (Number.isFinite(idDoMarcador) && idDoMarcador > 0) {
                const produto = await productService.getById(idDoMarcador);

                if (produto) return { produto };
            }
        }
    } catch (_) {
        // Marcador ausente ou ilegível: cai para a consulta no banco.
    }

    // 2) Jobs importados — TODOS os produtos, sem LIMIT.
    let ids = [];

    try {
        const { rows } = await db.query(
            `SELECT DISTINCT imported_product_id
               FROM tratocap_sync_jobs
              WHERE album_name = $1
                AND imported_product_id IS NOT NULL`,
            [album]
        );

        ids = rows
            .map(row => Number(row.imported_product_id))
            .filter(id => Number.isFinite(id) && id > 0)
            .sort((a, b) => a - b);
    } catch (_) {
        // Tabela pode não existir em ambiente novo.
        return null;
    }

    if (ids.length === 0) return null;

    if (ids.length > 1) {
        return { erro: "produtos_duplicados", produtos: ids };
    }

    const produto = await productService.getById(ids[0]);

    return produto ? { produto } : null;
}

async function encontrarProdutoDoAlbum(album) {
    const resolucao = await resolverProdutoDoAlbum(album);

    if (!resolucao || resolucao.erro) return null;

    return resolucao.produto || null;
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

/**
 * GET /api/tratocap/devices/me
 *
 * Informa ao PRÓPRIO aparelho se a sua autorização continua válida, com
 * status HTTP que o app consiga distinguir sem ambiguidade:
 *
 *   200  — token individual válido          (modo: "dispositivo")
 *   200  — chave compartilhada válida       (modo: "chave_compartilhada")
 *   401  — credencial ausente
 *   401  — token individual inválido/revogado (code: "REVOGADO")
 *   500  — falha interna / banco indisponível
 *
 * Por que não usa `requireSyncKey` diretamente:
 * aquele middleware, quando a credencial não casa com nenhum dispositivo,
 * cai no fallback da TRATOCAP_SYNC_KEY e responde 503 quando ela não está
 * configurada. Para o app, 503 significaria "não foi possível verificar",
 * e a revogação jamais seria detectada. Aqui a classificação é explícita,
 * MAS a validação continua sendo a mesma função (validarToken) e o mesmo
 * helper de comparação (esperadaCompleta) — nada de autenticação paralela.
 *
 * NUNCA devolve token, hash ou qualquer segredo.
 */
router.get("/devices/me", async (req, res) => {
    try {
        const enviada = extrairCredencial(req);

        // 1) Sem credencial: não há como autenticar.
        if (!enviada) {
            return res.status(401).json({
                success: false,
                code: "UNAUTHORIZED",
                error: "Informe o token do dispositivo."
            });
        }

        // 2) Token de dispositivo pareado (mesma validação das demais rotas).
        let dispositivo = null;
        let falhaAoValidar = null;

        try {
            dispositivo = await tratocapDevice.validarToken(enviada);
        } catch (error) {
            // Banco indisponível NÃO significa token revogado.
            falhaAoValidar = error;
        }

        if (dispositivo) {
            return res.json({
                success: true,
                autorizado: true,
                dispositivo: { id: dispositivo.id, apelido: dispositivo.apelido },
                modo: "dispositivo"
            });
        }

        // 3) Chave compartilhada (compatibilidade), quando configurada.
        const esperada = process.env.TRATOCAP_SYNC_KEY;

        if (esperada && esperadaCompleta(esperada, enviada)) {
            return res.json({
                success: true,
                autorizado: true,
                dispositivo: null,
                modo: "chave_compartilhada"
            });
        }

        // 4) A validação falhou por problema interno: não é revogação.
        if (falhaAoValidar) {
            console.error(
                "[Entrevista] Falha ao validar dispositivo em /devices/me:",
                String(falhaAoValidar.message || "").slice(0, 160)
            );
            return res.status(500).json({
                success: false,
                code: "VERIFICACAO_INDISPONIVEL",
                error: "Não foi possível verificar a autorização agora."
            });
        }

        // 5) Chegou aqui: a credencial existe e não é válida.
        return res.status(401).json({
            success: false,
            code: "REVOGADO",
            error: "A autorização deste aparelho não é mais válida."
        });
    } catch (error) {
        console.error("[Entrevista] Falha ao consultar /devices/me:", String(error.message || "").slice(0, 160));
        return res.status(500).json({
            success: false,
            error: "Não foi possível verificar a autorização."
        });
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
module.exports.encontrarProdutoDoAlbum = encontrarProdutoDoAlbum;
module.exports.resolverProdutoDoAlbum = resolverProdutoDoAlbum;
