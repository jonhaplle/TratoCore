// Testes da Entrevista Inteligente — os três cenários obrigatórios.
// Usa o rankeamento real das perguntas; banco e ML simulados.
const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

const routesPath = require.resolve("./tratocapInterview");

// ------------------------------------------------------------------
// Banco e serviços simulados
// ------------------------------------------------------------------

function criarStubs({ produto, review, importAlbums }) {
    const estado = { updates: [], produtos: produto ? [produto] : [] };

    const stubs = {
        "../services/productService": {
            async getById(id) {
                const p = estado.produtos.find(x => Number(x.id) === Number(id));
                return p ? { ...p } : null;
            },
            async update(id, dados) {
                const p = estado.produtos.find(x => Number(x.id) === Number(id));
                estado.updates.push({ id, dados });
                if (p) Object.assign(p, dados);
                return p ? { ...p } : null;
            }
        },
        "../services/seller/sellerListing.service": {
            async buildReview() {
                return typeof review === "function" ? review() : review;
            }
        },
        // O middleware agora consulta dispositivos pareados antes da chave global.
        "./tratocap": {
            safeAlbumName(value) {
                return String(value || "").trim().replace(/[\\/:*?"<>|]/g, "_").replace(/\\.+$/g, "").slice(0, 120);
            },
            async importAlbums(album) {
                if (typeof importAlbums === "function") return importAlbums(album, estado);
                return { success: true, imported: [], skipped: [] };
            }
        },
        "../services/tratocapDevice.service": {
            // Simula um dispositivo pareado válido: o middleware aceita o token.
            async validarToken(token) {
                return typeof token === "string" && token.length > 20
                    ? { id: 1, apelido: "Teste" }
                    : null;
            },
            async ensureSchema() {},
            async criarCodigoPareamento() { return {}; },
            async parearDispositivo() { return { erro: "codigo_invalido" }; },
            async listarDispositivos() { return []; },
            async revogarDispositivo() { return null; }
        },
        "../db": {
            async query(sql, params) {
                // tratocap_sync_jobs: devolve o produto vinculado ao álbum.
                // O módulo faz require("../db") DENTRO de encontrarProdutoDoAlbum,
                // portanto o parent é o próprio módulo e este stub é aplicado.
                if (/tratocap_sync_jobs/i.test(String(sql))) {
                    if (!estado.produtos.length) return { rows: [] };
                    return { rows: [{ imported_product_id: estado.produtos[0].id }] };
                }
                return { rows: [] };
            }
        }
    };

    return { stubs, estado };
}

/**
 * Patch persistente de Module._load.
 *
 * O módulo faz require("../db") DENTRO de encontrarProdutoDoAlbum, isto é,
 * DEPOIS do carregamento do módulo. Se o patch fosse removido logo após o
 * require(), o stub não valeria durante a execução da rota e a busca do
 * produto cairia no banco real — retornando 404.
 */
const patchOriginal = Module._load;
let stubsAtivos = null;

Module._load = function (request, parent, isMain) {
    if (parent?.filename === routesPath && stubsAtivos && Object.hasOwn(stubsAtivos, request)) {
        return stubsAtivos[request];
    }
    return patchOriginal.call(this, request, parent, isMain);
};

function carregar(stubs) {
    stubsAtivos = stubs;
    delete require.cache[routesPath];
    return require(routesPath);
}

/** Executa uma rota do roteador sem subir servidor HTTP. */
/**
 * Executa uma rota do roteador sem subir servidor HTTP.
 * O caminho é montado com o álbum/ID real, e os params vêm do padrão da rota.
 */
async function chamar(router, metodo, caminho, { body = {}, headers = {} } = {}) {
    const partesDoCaminho = caminho.split("/").filter(Boolean);

    const camada = router.stack.find(l => {
        if (!l.route) return false;
        const regex = new RegExp("^" + l.route.path.replace(/:[^/]+/g, "[^/]+") + "$");
        return regex.test(caminho);
    });

    if (!camada) {
        return { status: 404, corpo: { error: "rota nao encontrada no teste: " + caminho } };
    }

    // Deriva os params comparando cada segmento do padrão com o do caminho.
    const padrao = camada.route.path.split("/").filter(Boolean);
    const params = {};
    padrao.forEach((segmento, indice) => {
        if (segmento.startsWith(":")) {
            params[segmento.slice(1)] = partesDoCaminho[indice];
        }
    });

    const req = {
        method: metodo,
        url: caminho,
        params,
        query: {},
        body,
        get(nome) { return headers[String(nome || "").toLowerCase()]; }
    };

    return new Promise((resolve) => {
        const res = {
            statusCode: 200,
            corpo: null,
            cabecalhos: {},
            set(k, v) { this.cabecalhos[k] = v; return this; },
            status(c) { this.statusCode = c; return this; },
            json(p) { this.corpo = p; resolve({ status: this.statusCode, corpo: p }); return this; }
        };

        const stack = camada.route.stack;
        let i = 0;

        const next = (erro) => {
            if (erro) { resolve({ status: 500, corpo: { error: String(erro) } }); return; }
            i += 1;
            if (i >= stack.length) return;
            try { stack[i].handle(req, res, next); }
            catch (e) { resolve({ status: 500, corpo: { error: String(e) } }); }
        };

        try { stack[0].handle(req, res, next); }
        catch (e) { resolve({ status: 500, corpo: { error: String(e) } }); }
    });
}
// Chave de sincronização simulada.
// ATENÇÃO: os headers são montados DENTRO de comChave(), porque a env só
// existe durante a execução do teste — avaliá-la no topo do arquivo daria 401.
const CHAVE = "chave-entrevista-teste";
const CHAVE_TESTE = "chave-entrevista-teste";
function autorizado() { return { headers: { authorization: "Bearer " + CHAVE_TESTE } }; }

function comChave(fn) {
    const anterior = process.env.TRATOCAP_SYNC_KEY;
    process.env.TRATOCAP_SYNC_KEY = CHAVE;

    try { return fn(); }
    finally {
        if (anterior === undefined) delete process.env.TRATOCAP_SYNC_KEY;
        else process.env.TRATOCAP_SYNC_KEY = anterior;
    }
}

// ------------------------------------------------------------------
// Reviews simuladas por cenário (formato real do buildReview)
// ------------------------------------------------------------------

function reviewSmartphone() {
    return {
        category: { id: "MLB1055", name: "Celulares e Smartphones" },
        questions: [
            { field: "attribute:BRAND", attribute_id: "BRAND", question: "Informe Marca (exigido pelo Mercado Livre).", options: [] },
            { field: "attribute:MODEL", attribute_id: "MODEL", question: "Informe Modelo (exigido pelo Mercado Livre).", options: [] },
            { field: "attribute:IS_DUAL_SIM", attribute_id: "IS_DUAL_SIM", question: "Informe É Dual SIM.", options: [{ value: "1", label: "Sim" }, { value: "2", label: "Não" }] },
            { field: "attribute:CELLPHONES_ANATEL_HOMOLOGATION_NUMBER", attribute_id: "CELLPHONES_ANATEL_HOMOLOGATION_NUMBER", question: "Informe Número de homologação da Anatel.", options: [] },
            { field: "attribute:SELLER_PACKAGE_HEIGHT", attribute_id: "SELLER_PACKAGE_HEIGHT", question: "Informe Altura da embalagem do vendor.", options: [] },
            { field: "attribute:SELLER_PACKAGE_WIDTH", attribute_id: "SELLER_PACKAGE_WIDTH", question: "Informe Largura da embalagem do vendor.", options: [] },
            { field: "attribute:SELLER_PACKAGE_LENGTH", attribute_id: "SELLER_PACKAGE_LENGTH", question: "Informe Comprimento da embalagem do vendor.", options: [] },
            { field: "attribute:SELLER_PACKAGE_WEIGHT", attribute_id: "SELLER_PACKAGE_WEIGHT", question: "Informe Peso da embalagem do vendor.", options: [] },
            { field: "sale_price", question: "Qual é o preço de venda?", options: [] }
        ],
        ready_to_publish: false
    };
}

function reviewTelevisor() {
    return {
        category: { id: "MLB1002", name: "Televisores" },
        questions: [
            { field: "attribute:BRAND", attribute_id: "BRAND", question: "Informe Marca (exigido pelo Mercado Livre).", options: [{ value: "10", label: "CCE" }] },
            { field: "attribute:MODEL", attribute_id: "MODEL", question: "Informe Modelo.", options: [] },
            { field: "attribute:VOLTAGE", attribute_id: "VOLTAGE", question: "Informe Voltagem.", options: [{ value: "1", label: "127V" }, { value: "2", label: "220V" }] },
            { field: "attribute:DISPLAY_SIZE", attribute_id: "DISPLAY_SIZE", question: "Informe Tamanho da tela.", options: [] },
            { field: "attribute:SELLER_PACKAGE_HEIGHT", attribute_id: "SELLER_PACKAGE_HEIGHT", question: "Informe Altura da embalagem do vendor.", options: [] },
            { field: "attribute:SELLER_PACKAGE_WIDTH", attribute_id: "SELLER_PACKAGE_WIDTH", question: "Informe Largura da embalagem do vendor.", options: [] },
            { field: "attribute:SELLER_PACKAGE_LENGTH", attribute_id: "SELLER_PACKAGE_LENGTH", question: "Informe Comprimento da embalagem do vendor.", options: [] },
            { field: "attribute:SELLER_PACKAGE_WEIGHT", attribute_id: "SELLER_PACKAGE_WEIGHT", question: "Informe Peso da embalagem do vendor.", options: [] }
        ],
        ready_to_publish: false
    };
}

function reviewColecionavel() {
    return {
        category: { id: "MLB1174", name: "Música" },
        questions: [
            { field: "attribute:MUSIC_ARTIST_NAME", attribute_id: "MUSIC_ARTIST_NAME", question: "Informe Nome do artista do álbum.", options: [] },
            { field: "attribute:ALBUM_NAME", attribute_id: "ALBUM_NAME", question: "Informe Nome do álbum.", options: [] },
            { field: "attribute:SELLER_PACKAGE_HEIGHT", attribute_id: "SELLER_PACKAGE_HEIGHT", question: "Informe Altura da embalagem do vendor.", options: [] },
            { field: "attribute:SELLER_PACKAGE_WIDTH", attribute_id: "SELLER_PACKAGE_WIDTH", question: "Informe Largura da embalagem do vendor.", options: [] },
            { field: "attribute:SELLER_PACKAGE_LENGTH", attribute_id: "SELLER_PACKAGE_LENGTH", question: "Informe Comprimento da embalagem do vendor.", options: [] },
            { field: "attribute:SELLER_PACKAGE_WEIGHT", attribute_id: "SELLER_PACKAGE_WEIGHT", question: "Informe Peso da embalagem do vendor.", options: [] }
        ],
        ready_to_publish: false
    };
}

const PRODUTO = { id: 501, title: "Produto de teste", ml_attributes: null, seller_observation: null };

// ------------------------------------------------------------------
// Recuperação de álbum pendente antes de abrir a entrevista

test("entrevista: importa álbum pendente e carrega perguntas na mesma chamada", async () => {
    const { stubs } = criarStubs({
        produto: null,
        review: reviewSmartphone(),
        importAlbums: async (album, estado) => {
            assert.equal(album, "Produto_01");
            estado.produtos.push({ ...PRODUTO, id: 777, title: "Produto 01 importado" });
            return { success: true, imported: [{ album, product_id: 777 }], skipped: [] };
        }
    });
    const router = carregar(stubs);
    const r = await comChave(() => chamar(router, "GET", "/interview/Produto_01", autorizado()));
    assert.equal(r.status, 200);
    assert.equal(r.corpo.produto.id, 777);
    assert.equal(r.corpo.produto.title, "Produto 01 importado");
    assert.ok(r.corpo.perguntas.length > 0);
});

test("entrevista: mantém 404 claro se importação não gerar produto", async () => {
    const { stubs } = criarStubs({
        produto: null,
        review: reviewSmartphone(),
        importAlbums: async () => ({ success: true, imported: [], skipped: [{ album: "vazio", reason: "Nenhuma imagem" }] })
    });
    const router = carregar(stubs);
    const r = await comChave(() => chamar(router, "GET", "/interview/vazio", autorizado()));
    assert.equal(r.status, 404);
    assert.equal(r.corpo.code, "PRODUTO_NAO_ENCONTRADO");
    assert.match(r.corpo.error, /fotos terminaram de enviar/);
});

// Cenário 1 — SMARTPHONE USADO
// ------------------------------------------------------------------

test("smartphone: perguntas incluem Anatel e os campos de celular", () => {
    const ids = reviewSmartphone().questions.map(q => q.attribute_id).filter(Boolean);

    assert.ok(ids.includes("BRAND"), "exige marca");
    assert.ok(ids.includes("MODEL"), "exige modelo");
    assert.ok(ids.includes("IS_DUAL_SIM"), "exige dual SIM");
    assert.ok(ids.includes("CELLPHONES_ANATEL_HOMOLOGATION_NUMBER"), "exige Anatel");

    // Celular não exige atributos de vinil
    assert.ok(!ids.includes("MUSIC_ARTIST_NAME"), "não deve pedir artista");
});


test("smartphone: rota entrega as perguntas classificadas por tipo", async () => {
    const { stubs } = criarStubs({ produto: PRODUTO, review: reviewSmartphone() });
    const router = carregar(stubs);

    const r = await comChave(() => chamar(router, "GET", "/interview/album-smartphone", autorizado()));

    assert.equal(r.status, 200);
    assert.equal(r.corpo.produto.categoria, "MLB1055");
    assert.ok(r.corpo.perguntas.length > 0);

    const tipos = new Set(r.corpo.perguntas.map(p => p.tipo));
    assert.ok(tipos.has("obrigatoria"), "tem perguntas obrigatórias");
    assert.ok(tipos.has("comercial"), "tem perguntas comerciais (preço)");
});

// ------------------------------------------------------------------
// Cenário 2 — TELEVISOR USADO
// ------------------------------------------------------------------

test("televisor: perguntas incluem voltagem e tamanho de tela", () => {
    const ids = reviewTelevisor().questions.map(q => q.attribute_id).filter(Boolean);

    assert.ok(ids.includes("VOLTAGE"), "exige voltagem");
    assert.ok(ids.includes("DISPLAY_SIZE"), "exige tamanho da tela");
    assert.ok(ids.includes("BRAND"));

    // Não pede Anatel (é de celular)
    assert.ok(!ids.includes("CELLPHONES_ANATEL_HOMOLOGATION_NUMBER"), "não deve pedir Anatel");
});

test("televisor: pergunta de voltagem traz opções oficiais", async () => {
    const { stubs } = criarStubs({ produto: PRODUTO, review: reviewTelevisor() });
    const router = carregar(stubs);

    const r = await comChave(() => chamar(router, "GET", "/interview/album-tv", autorizado()));

    const voltagem = r.corpo.perguntas.find(p => p.atributo_id === "VOLTAGE");
    assert.ok(voltagem, "pergunta de voltagem presente");
    assert.ok(voltagem.opcoes.length >= 2, "traz opções oficiais");
});

// ------------------------------------------------------------------
// Cenário 3 — PRODUTO ANTIGO / COLEÇÃO
// ------------------------------------------------------------------

test("colecionável: perguntas são de artista e álbum", () => {
    const ids = reviewColecionavel().questions.map(q => q.attribute_id).filter(Boolean);

    assert.ok(ids.includes("MUSIC_ARTIST_NAME"), "exige artista");
    assert.ok(ids.includes("ALBUM_NAME"), "exige álbum");

    assert.ok(!ids.includes("CELLPHONES_ANATEL_HOMOLOGATION_NUMBER"), "não pede Anatel");
    assert.ok(!ids.includes("VOLTAGE"), "não pede voltagem");
});

test("colecionável: rota devolve categoria de Música", async () => {
    const { stubs } = criarStubs({ produto: PRODUTO, review: reviewColecionavel() });
    const router = carregar(stubs);

    const r = await comChave(() => chamar(router, "GET", "/interview/album-vinil", autorizado()));

    assert.equal(r.corpo.produto.categoria, "MLB1174");
    assert.equal(r.corpo.produto.categoria_nome, "Música");
});

// ------------------------------------------------------------------
// As perguntas mudam entre categorias — comparação direta
// ------------------------------------------------------------------

test("as perguntas mudam conforme a categoria", () => {
    const tel = new Set(reviewSmartphone().questions.map(q => q.attribute_id));
    const tv = new Set(reviewTelevisor().questions.map(q => q.attribute_id));
    const vinil = new Set(reviewColecionavel().questions.map(q => q.attribute_id));

    assert.ok(tel.has("IS_DUAL_SIM") && !tv.has("IS_DUAL_SIM"), "dual SIM só no celular");
    assert.ok(tv.has("VOLTAGE") && !vinil.has("VOLTAGE"), "voltagem só na TV");
    assert.ok(vinil.has("ALBUM_NAME") && !tel.has("ALBUM_NAME"), "álbum só no vinil");

    // Embalagem é comum a todas (exigência do ML)
    for (const conjunto of [tel, tv, vinil]) {
        assert.ok(conjunto.has("SELLER_PACKAGE_HEIGHT"), "embalagem em todas");
    }
});

// ------------------------------------------------------------------
// Medidas da embalagem — nunca estimadas
// ------------------------------------------------------------------

test("medidas da embalagem vêm sem sugestão (vendedor informa)", async () => {
    const { stubs } = criarStubs({ produto: PRODUTO, review: reviewSmartphone() });
    const router = carregar(stubs);

    const r = await comChave(() => chamar(router, "GET", "/interview/album-x", autorizado()));

    const medidas = r.corpo.perguntas.filter(p => p.eh_medida_embalagem);
    assert.equal(medidas.length, 4, "as quatro medidas são solicitadas");

    for (const m of medidas) {
        assert.equal(m.sugestao, null, "nenhuma sugestão de medida — nunca estimar");
    }
});

// ------------------------------------------------------------------
// Persistência das respostas
// ------------------------------------------------------------------

test("answers: persiste em ml_attributes preservando dados anteriores", async () => {
    const comDados = { ...PRODUTO, ml_attributes: { outro_processo: { x: 1 } } };
    const { stubs, estado } = criarStubs({ produto: comDados, review: reviewSmartphone() });
    const router = carregar(stubs);

    const r = await comChave(() => chamar(router, "POST", "/answers", {
        body: {
            album: "album-smartphone",
            respostas: [
                { atributo_id: "BRAND", valor: "Samsung" },
                { atributo_id: "MODEL", valor: "Galaxy A16" }
            ]
        },
        ...autorizado()
    }));

    assert.equal(r.status, 200);
    assert.equal(r.corpo.respondidas, 2);

    const gravado = estado.updates[0].dados.ml_attributes;
    assert.deepEqual(gravado.outro_processo, { x: 1 }, "dado anterior preservado");
    assert.equal(gravado.entrevista.atributos.BRAND.value_name, "Samsung");
});

test("answers: persiste a observação no produto", async () => {
    const { stubs, estado } = criarStubs({ produto: PRODUTO, review: reviewSmartphone() });
    const router = carregar(stubs);

    await comChave(() => chamar(router, "POST", "/answers", {
        body: { album: "album-a", observacao: "tela trincada no canto" },
        ...autorizado()
    }));

    assert.equal(estado.updates[0].dados.seller_observation, "tela trincada no canto");
});

test("answers: grava ml_category_id da categoria resolvida", async () => {
    const { stubs, estado } = criarStubs({ produto: PRODUTO, review: reviewSmartphone() });
    const router = carregar(stubs);

    await comChave(() => chamar(router, "POST", "/answers", {
        body: { album: "album-b", respostas: [{ atributo_id: "BRAND", valor: "Samsung" }] },
        ...autorizado()
    }));

    assert.equal(estado.updates[0].dados.ml_category_id, "MLB1055");
});

test("answers: devolve as perguntas restantes após responder", async () => {
    let chamadas = 0;
    const { stubs } = criarStubs({
        produto: PRODUTO,
        review: () => {
            chamadas += 1;
            return chamadas === 1 ? reviewSmartphone() : reviewTelevisor();
        }
    });
    const router = carregar(stubs);

    const r = await comChave(() => chamar(router, "POST", "/answers", {
        body: { album: "album-c", respostas: [{ atributo_id: "BRAND", valor: "Samsung" }] },
        ...autorizado()
    }));

    assert.ok(r.corpo.perguntas.length > 0, "recalcula e devolve o que falta");
});

// ------------------------------------------------------------------
// Validações e segurança
// ------------------------------------------------------------------

test("answers: sem respostas retorna 400", async () => {
    const { stubs } = criarStubs({ produto: PRODUTO, review: reviewSmartphone() });
    const router = carregar(stubs);

    const r = await comChave(() => chamar(router, "POST", "/answers", {
        body: { album: "album-d", respostas: [] },
        ...autorizado()
    }));

    assert.equal(r.status, 400);
    assert.equal(r.corpo.code, "SEM_RESPOSTAS");
});

test("answers: resposta sem valor é ignorada", async () => {
    const { stubs, estado } = criarStubs({ produto: PRODUTO, review: reviewSmartphone() });
    const router = carregar(stubs);

    const r = await comChave(() => chamar(router, "POST", "/answers", {
        body: { album: "album-e", respostas: [{ atributo_id: "BRAND", valor: "  " }] },
        ...autorizado()
    }));

    assert.equal(r.status, 400);
    assert.equal(estado.updates.length, 0, "nada foi gravado");
});

test("segurança: sem chave de sincronização retorna 401", async () => {
    const { stubs } = criarStubs({ produto: PRODUTO, review: reviewSmartphone() });
    const router = carregar(stubs);

    const r = await comChave(() => chamar(router, "GET", "/interview/album-x", {}));

    assert.equal(r.status, 401);
});

test("segurança: token inválido sem chave global retorna 503", async () => {
    const { stubs } = criarStubs({ produto: PRODUTO, review: reviewSmartphone() });
    const router = carregar(stubs);

    const r = await comChave(() => chamar(router, "GET", "/interview/album-x", {
        headers: { authorization: "Bearer errada" }
    }));

    // Token curto: o stub de validarToken rejeita e não há chave global -> falha fechada.
    assert.equal(r.status, 503);

});

test("segurança: sem dispositivo e sem chave global retorna 503", async () => {
    const anterior = process.env.TRATOCAP_SYNC_KEY;
    delete process.env.TRATOCAP_SYNC_KEY;

    try {
        const { stubs } = criarStubs({ produto: PRODUTO, review: reviewSmartphone() });
        const router = carregar(stubs);
        // Sem dispositivo pareado (token curto) e sem chave global.
        const r = await chamar(router, "GET", "/interview/album-x", {
            headers: { authorization: "Bearer curto" }
        });
        assert.equal(r.status, 503);
        assert.equal(r.corpo.code, "ATIVACAO_PENDENTE");
    } finally {
        if (anterior !== undefined) process.env.TRATOCAP_SYNC_KEY = anterior;
    }
});

test("segurança: rotas não publicam anúncio", () => {
    const fs = require("node:fs");
    const src = fs.readFileSync(routesPath, "utf8");

    assert.ok(!/publishItem|sellerListing\.publish|publishSellerListing/.test(src), "não publica");
    assert.ok(!/googleDrive|OAuth/.test(src), "não toca em OAuth/Drive");
});
