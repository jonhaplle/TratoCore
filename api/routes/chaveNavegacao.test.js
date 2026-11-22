// Simulação do ciclo de vida do navegador para a chave administrativa.
//
// Modela exatamente o que o teste real precisa provar:
//   - cada navegação entre páginas cria um `window` NOVO (sem herança);
//   - por isso window.__chaveAdmin NÃO sobrevive a index -> produtos;
//   - cada página tem seu próprio campo e sua própria leitura;
//   - F5 recria o window (campo vazio);
//   - storage permanece intocado.
//
// Executa o código REAL dos arquivos (extraindo as funções) num contexto
// isolado, para não depender de um navegador.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const RAIZ = path.join(__dirname, "..", "..");
const pub = (n) => fs.readFileSync(path.join(RAIZ, "public", n), "utf8");

// ------------------------------------------------------------------
// Modelo de página: um `window` novo por documento.
// ------------------------------------------------------------------
function novaPagina(nomeDoArquivo, scripts) {
    const campos = {};

    // Descobre o campo de chave que a página tem declarado no HTML.
    const html = pub(nomeDoArquivo);
    const declara = html.match(/id="adminKey"/) ? true : false;

    if (declara) campos.adminKey = { value: "" };

    const documento = {
        getElementById(id) { return campos[id] || null; },
        querySelector() { return null; }
    };

    const janela = {
        document: documento,
        localStorage: criarStorage("local"),
        sessionStorage: criarStorage("session"),
        console,
        setTimeout,
        clearTimeout,
        Event: function Event(tipo) { this.type = tipo; this.bubbles = true; },
        addEventListener() {},
        fetch() { throw new Error("fetch não deve ser chamado nesta simulação"); }
    };

    janela.window = janela;

    const contexto = vm.createContext(janela);

    for (const codigo of scripts) {
        vm.runInContext(codigo, contexto, { filename: nomeDoArquivo });
    }

    return { janela, campos, temCampo: declara };
}

function criarStorage(tipo) {
    const dados = {};
    return {
        get length() { return Object.keys(dados).length; },
        getItem(k) { return Object.prototype.hasOwnProperty.call(dados, k) ? dados[k] : null; },
        setItem(k, v) { dados[k] = String(v); },
        removeItem(k) { delete dados[k]; },
        clear() { for (const k of Object.keys(dados)) delete dados[k]; }
    };
}

/** Extrai uma função nomeada do código-fonte. */
function extrairFuncao(fonte, nome) {
    const inicio = fonte.indexOf(`function ${nome}(`);
    if (inicio < 0) throw new Error(`função ${nome} não encontrada`);

    let profundidade = 0;
    let i = fonte.indexOf("{", inicio);

    for (let j = i; j < fonte.length; j++) {
        if (fonte[j] === "{") profundidade++;
        else if (fonte[j] === "}") {
            profundidade--;
            if (profundidade === 0) return fonte.slice(inicio, j + 1);
        }
    }
    throw new Error(`função ${nome} não fechada`);
}

// Funções reais dos arquivos.
const APP = pub("app.js");
const PRODUTOS = pub("produtos.js");

const CODIGO_APP = [
    "let chaveAdministrativa = '';",
    extrairFuncao(APP, "lerChaveAdministrativa"),
    extrairFuncao(APP, "cabecalhosComChave")
].join("\n");

const CODIGO_PRODUTOS = [
    extrairFuncao(PRODUTOS, "chaveAdmin"),
    extrairFuncao(PRODUTOS, "cabecalhosEscrita")
].join("\n");

// ==================================================================
// Tarefa 1/2/3 — navegação entre documentos
// ==================================================================

test("navegação index -> produtos recria o window (sem herança)", () => {
    // Página 1: index, usuário digita a chave.
    const index = novaPagina("index.html", [CODIGO_APP]);
    index.campos.adminKey.value = "chave-teste-123456";

    const headersIndex = index.janela.cabecalhosComChave();
    assert.match(headersIndex.Authorization, /^Bearer chave-teste-123456$/);

    // Página 2: produtos — NOVO documento, novo window.
    const produtos = novaPagina("produtos.html", [CODIGO_PRODUTOS]);

    // O window novo não conhece nada do anterior.
    assert.equal(produtos.janela.chaveAdministrativa, undefined);

    // O campo da página está vazio: a chave NÃO deve ter "aparecido".
    assert.equal(produtos.campos.adminKey.value, "", "chave não sobrevive à navegação");

    // E escrever sem informar a chave deve falhar de forma clara.
    assert.throws(
        () => produtos.janela.cabecalhosEscrita(),
        /Informe a chave administrativa/,
        "sem chave na página de produtos, deve avisar"
    );
});

test("não existe mais ponte window.__chaveAdmin", () => {
    assert.ok(!APP.includes("__chaveAdmin"), "app.js não deve compartilhar chave via window");
    assert.ok(!PRODUTOS.includes("__chaveAdmin"), "produtos.js idem");
});

test("cada página tem o próprio campo de chave", () => {
    assert.match(pub("index.html"), /id="adminKey"/);
    assert.match(pub("produtos.html"), /id="adminKey"/);
});

// ==================================================================
// Tarefa 3 — informando a chave NA pr��pria página, a escrita funciona
// ==================================================================

test("produtos.html: digitando a chave na página, PUT/DELETE autenticam", () => {
    const produtos = novaPagina("produtos.html", [CODIGO_PRODUTOS]);

    produtos.campos.adminKey.value = "chave-teste-123456";

    const headers = produtos.janela.cabecalhosEscrita();

    assert.match(headers.Authorization, /^Bearer chave-teste-123456$/);
    assert.equal(headers["Content-Type"], "application/json");
});

test("index.html: digitando a chave, o POST autentica", () => {
    const index = novaPagina("index.html", [CODIGO_APP]);

    index.campos.adminKey.value = "chave-teste-123456";

    const headers = index.janela.cabecalhosComChave();

    assert.match(headers.Authorization, /^Bearer chave-teste-123456$/);
});

test("sem chave, index também recusa antes de chamar o servidor", () => {
    const index = novaPagina("index.html", [CODIGO_APP]);

    assert.throws(
        () => index.janela.cabecalhosComChave(),
        /Informe a chave administrativa/
    );
});

// ==================================================================
// Tarefa 4 — comportamento após F5
// ==================================================================

test("após F5 o campo volta vazio (novo documento)", () => {
    const primeira = novaPagina("produtos.html", [CODIGO_PRODUTOS]);
    primeira.campos.adminKey.value = "chave-teste-123456";
    assert.match(primeira.janela.cabecalhosEscrita().Authorization, /^Bearer /);

    // F5 = novo documento.
    const aposF5 = novaPagina("produtos.html", [CODIGO_PRODUTOS]);

    assert.equal(aposF5.campos.adminKey.value, "");
    assert.throws(() => aposF5.janela.cabecalhosEscrita(), /Informe a chave administrativa/);
});

// ==================================================================
// Tarefa 5 — storage permanece intocado
// ==================================================================

test("nenhum storage recebe a chave em nenhuma das páginas", () => {
    const index = novaPagina("index.html", [CODIGO_APP]);
    index.campos.adminKey.value = "chave-teste-123456";
    index.janela.cabecalhosComChave();

    const produtos = novaPagina("produtos.html", [CODIGO_PRODUTOS]);
    produtos.campos.adminKey.value = "chave-teste-123456";
    produtos.janela.cabecalhosEscrita();

    assert.equal(index.janela.localStorage.length, 0);
    assert.equal(index.janela.sessionStorage.length, 0);
    assert.equal(produtos.janela.localStorage.length, 0);
    assert.equal(produtos.janela.sessionStorage.length, 0);
});

test("o Bearer carrega exatamente a chave digitada (sem alteração)", () => {
    const index = novaPagina("index.html", [CODIGO_APP]);
    index.campos.adminKey.value = "  chave-com-espacos  ";

    // Trim nas pontas; conteúdo interno preservado.
    assert.equal(
        index.janela.cabecalhosComChave().Authorization,
        "Bearer chave-com-espacos"
    );
});

// ==================================================================
// Tarefa 7 — PUT /api/product-images/:productId/selection
// ==================================================================

test("rota PUT /api/product-images/:productId/selection exige autenticação", () => {
    // Antes desta missão a rota era pública. Agora exige a chave
    // administrativa, como as demais escritas de imagem.
    const fonte = fs.readFileSync(
        path.join(RAIZ, "api", "routes", "productImages.js"), "utf8"
    );

    const trecho = fonte.substring(
        fonte.indexOf('"/product/:productId/selection"') - 120,
        fonte.indexOf('"/product/:productId/selection"') + 120
    );

    assert.match(trecho, /requireAdminKey/, "a rota de seleção deve exigir a chave");
});

test("produto.js envia Authorization na rota de seleção", () => {
    const js = pub("produto.js");

    const chamada = /fetch\(`\/api\/product-images\/product\/[^`]*\/selection`,([\s\S]{0,400})/.exec(js);
    assert.ok(chamada, "fetch do endpoint /selection deve existir");

    assert.match(chamada[1], /"?Authorization"?\s*:\s*`Bearer \$\{chave\}`/);
});
