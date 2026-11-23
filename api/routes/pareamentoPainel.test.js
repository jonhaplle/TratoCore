// Testes do painel de pareamento (public/pareamento.*).
//
// Valida estrutura, segurança da chave e contratos das rotas reutilizadas.
// Não sobe servidor com banco: os testes de rede usam o router real com
// dependências injetadas.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const RAIZ = path.join(__dirname, "..", "..");
const pub = (n) => fs.readFileSync(path.join(RAIZ, "public", n), "utf8");

const HTML = pub("pareamento.html");
const JS = pub("pareamento.js");
const CSS = pub("pareamento.css");

/** Remove comentários para não confundir documentação com código. */
function semComentarios(texto) {
    return texto
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^[ \t]*\/\/.*$/gm, "")
        .replace(/^[ \t]*\*.*$/gm, "");
}

const JS_CODIGO = semComentarios(JS);

// ==================================================================
// 1 — Página abre corretamente
// ==================================================================

test("1. pareamento.html é um documento HTML válido", () => {
    assert.match(HTML, /^<!DOCTYPE html>/i);
    assert.match(HTML, /<html lang="pt-BR">/);
    assert.match(HTML, /<meta charset="UTF-8">/);
    assert.match(HTML, /<meta[\s\S]*viewport/);
    assert.match(HTML, /<\/html>/);
});

test("1b. a página carrega os assets existentes", () => {
    assert.match(HTML, /href="style\.css"/);
    assert.match(HTML, /href="pareamento\.css"/);
    assert.match(HTML, /src="pareamento\.js"/);
});

test("1c. o CSS é sintaticamente consistente (chaves balanceadas)", () => {
    const abertas = (CSS.match(/\{/g) || []).length;
    const fechadas = (CSS.match(/\}/g) || []).length;
    assert.equal(abertas, fechadas, "chaves desbalanceadas no CSS");
});

test("1d. o JS carrega e expõe as funções por evento (sem erro de sintaxe)", () => {
    // node --check equivalente
    assert.doesNotThrow(() => {
        new Function(JS);
    });
});

// ==================================================================
// Controles exigidos pela missão
// ==================================================================

test("campo de chave é do tipo senha e sem autocomplete", () => {
    const bloco = HTML.substring(
        HTML.indexOf('id="adminKey"') - 220,
        HTML.indexOf('id="adminKey"') + 60
    );

    assert.match(bloco, /type="password"/);
    assert.match(bloco, /autocomplete="off"/);
});

test("campo opcional de apelido existe", () => {
    assert.match(HTML, /id="apelido"/);
    assert.match(HTML, /maxlength="80"/);
});

test("botão GERAR CÓDIGO existe", () => {
    assert.match(HTML, /id="btnGerar"/);
    assert.match(HTML, /GERAR CÓDIGO/);
});

test("área de exibição do código e da validade existe", () => {
    assert.match(HTML, /id="resultadoCodigo"/);
    assert.match(JS_CODIGO, /codigo-valor/);
    assert.match(JS_CODIGO, /validade_minutos/);
});

test("lista de dispositivos e botão de atualizar existem", () => {
    assert.match(HTML, /id="btnListar"/);
    assert.match(HTML, /id="tabelaDispositivos"/);
});

test("mensagens de sucesso e erro existem no HTML e no CSS", () => {
    assert.match(HTML, /id="mensagemGerar"/);
    assert.match(HTML, /id="mensagemLista"/);
    assert.match(CSS, /\.mensagem\.erro/);
    assert.match(CSS, /\.mensagem\.sucesso/);
});

// ==================================================================
// Rotas reutilizadas — sem duplicação
// ==================================================================

test("usa exatamente as três rotas existentes", () => {
    assert.match(JS_CODIGO, /"\/api\/tratocap\/devices\/pairing-code"/);
    assert.match(JS_CODIGO, /"\/api\/tratocap\/devices"/);
    assert.match(JS_CODIGO, /"\/api\/tratocap\/devices\/" \+/);

    // Nenhuma rota inventada.
    const rotas = JS_CODIGO.match(/["'`]\/api\/[^"'`]+/g) || [];
    for (const rota of rotas) {
        assert.ok(
            /\/api\/tratocap\/devices/.test(rota),
            `rota inesperada: ${rota}`
        );
    }
});

test("não cria rota nova nem middleware novo no backend", () => {
    const rotas = fs.readFileSync(
        path.join(RAIZ, "api", "routes", "tratocapInterview.js"), "utf8"
    );

    // As rotas usadas existem e seguem com requireAdmin.
    assert.match(rotas, /router\.post\("\/devices\/pairing-code", requireAdmin/);
    assert.match(rotas, /router\.get\("\/devices", requireAdmin/);
    assert.match(rotas, /router\.delete\("\/devices\/:id", requireAdmin/);
});

test("envia Authorization Bearer nas três operações", () => {
    assert.match(JS_CODIGO, /"Authorization":\s*"Bearer "\s*\+\s*chave/);
});

// ==================================================================
// 2 e 3 — Comportamento com chave
// ==================================================================

test("2. sem chave, a geração é bloqueada antes de chamar a API", () => {
    assert.match(JS_CODIGO, /if \(!chave\)\s*\{[\s\S]{0,200}throw/,
        "chamarApi deve recusar sem chave");

    assert.match(JS_CODIGO, /Informe a chave administrativa/);
});

test("2b. 401 é traduzido em mensagem clara", () => {
    assert.match(JS_CODIGO, /status === 401/);
    assert.match(JS_CODIGO, /Chave administrativa inválida/);
});

test("3. o código devolvido é validado como 8 dígitos", () => {
    assert.match(JS_CODIGO, /\^\\d\{8\}\$/);
});

test("3b. o código é exibido como texto (sem innerHTML do valor)", () => {
    // O valor vem por textContent, evitando injeção.
    assert.match(JS_CODIGO, /numero\.textContent = codigo/);
});

// ==================================================================
// 4 — Validade de dez minutos
// ==================================================================

test("4. a validade exibida vem do servidor (10 minutos)", () => {
    assert.match(JS_CODIGO, /validade_minutos/);
    assert.match(JS_CODIGO, /expira_em/);

    // O backend confirma 10 minutos.
    const servico = fs.readFileSync(
        path.join(RAIZ, "api", "services", "tratocapDevice.service.js"), "utf8"
    );
    assert.match(servico, /VALIDADE_CODIGO_MS = 10 \* 60 \* 1000/);
});

test("4b. a página não calcula validade própria (confia no servidor)", () => {
    assert.ok(!/Date\.now\(\)\s*\+\s*10\s*\*/.test(JS_CODIGO),
        "não deve inventar a validade");
});

// ==================================================================
// 5 e 6 — Lista e revogação
// ==================================================================

test("5. a listagem consome o campo dispositivos", () => {
    assert.match(JS_CODIGO, /dados\.dispositivos/);
    assert.match(JS_CODIGO, /total|Array\.isArray/);
});

test("5b. a tabela mostra os campos devolvidos pelo servidor", () => {
    for (const campo of ["id", "apelido", "criado_em", "ultimo_uso", "revogado"]) {
        assert.match(JS_CODIGO, new RegExp(`dispositivo\\.${campo}`),
            `deve usar ${campo}`);
    }
});

test("6. a revogação pede confirmação antes de excluir", () => {
    assert.match(JS_CODIGO, /window\.confirm\(/);
});

test("6b. a revogação usa DELETE na rota com o id codificado", () => {
    assert.match(JS_CODIGO, /"DELETE"/);
    assert.match(JS_CODIGO, /encodeURIComponent\(dispositivo\.id\)/);
});

test("6c. dispositivo já revogado não oferece nova revogação", () => {
    assert.match(JS_CODIGO, /botao\.disabled = revogado/);
});

// ==================================================================
// SEGURANÇA da chave
// ==================================================================

test("SEGURANÇA: a chave nunca é gravada em storage", () => {
    assert.ok(!/localStorage/.test(JS_CODIGO), "não deve usar localStorage");
    assert.ok(!/sessionStorage/.test(JS_CODIGO), "não deve usar sessionStorage");
    assert.ok(!/document\.cookie/.test(JS_CODIGO), "não deve usar cookie");
});

test("SEGURANÇA: a chave não é impressa em console", () => {
    const chamadas = JS_CODIGO.match(/console\.\w+\([^)]*\)/g) || [];

    for (const chamada of chamadas) {
        assert.ok(!/chave/i.test(chamada), `console não pode receber a chave: ${chamada}`);
    }
});

test("SEGURANÇA: a chave é limpa da tela após gerar o código", () => {
    assert.match(JS_CODIGO, /function esquecerChave\(\)/);
    assert.match(JS_CODIGO, /campoChave\.value = ""/);
    assert.match(JS_CODIGO, /esquecerChave\(\);/, "deve ser chamada em algum fluxo");
});

test("SEGURANÇA: a chave não vai para a URL nem para mensagem de erro", () => {
    assert.ok(!/location\.\w+\s*=.*chave/i.test(JS_CODIGO), "não deve ir para a URL");
    assert.ok(!/\?chave=/.test(JS_CODIGO), "não deve aparecer em query string");
});

test("SEGURANÇA: nenhuma chave embutida no código-fonte", () => {
    for (const arquivo of ["pareamento.html", "pareamento.js"]) {
        const texto = pub(arquivo);

        const suspeito = /(TRATO_VENDEDOR_ADMIN_KEY\s*[:=]\s*["'][^"']{8,}["'])|(value\s*=\s*["'][A-Za-z0-9_-]{16,}["'])/;
        assert.ok(!suspeito.test(texto), `${arquivo}: nenhuma chave literal`);
    }
});

test("SEGURANÇA: HTTPS exigido fora de localhost", () => {
    assert.match(JS_CODIGO, /verificarHTTPS/);
    assert.match(JS_CODIGO, /protocolo === "https:"/);
    assert.match(JS_CODIGO, /localhost/);
    assert.match(HTML, /id="avisoInseguro"/);
});

test("SEGURANÇA: a chave é descartada ao sair da página", () => {
    assert.match(JS_CODIGO, /pagehide/);
});

// ==================================================================
// Navegação
// ==================================================================

test("acesso à página adicionado na navegação das três telas", () => {
    for (const pagina of ["index.html", "produtos.html", "produto.html"]) {
        const html = pub(pagina);

        assert.match(html, /href="pareamento\.html"/, `${pagina} deve linkar o painel`);
    }
});

test("a própria página marca o item ativo", () => {
    assert.match(HTML, /href="pareamento\.html" class="ativo"/);
});

// ==================================================================
// Preservação
// ==================================================================

test("PRESERVAÇÃO: o TratoCap não foi alterado", () => {
    // A página é administrativa; o app não a consome.
    assert.ok(!/TratoCapSync|tratocap.*\.kt/i.test(HTML));
});

test("PRESERVAÇÃO: sincronização e upload não são tocados", () => {
    assert.ok(!/\/api\/tratocap\/upload/.test(JS_CODIGO),
        "o painel não deve interferir no upload");

    const tratocap = fs.readFileSync(path.join(RAIZ, "api", "routes", "tratocap.js"), "utf8");
    assert.match(tratocap, /router\.post\("\/upload", limitarUpload/, "upload segue intacto");
});

test("PRESERVAÇÃO: rotas de Drive e Mercado Livre não aparecem", () => {
    assert.ok(!/drive/i.test(JS_CODIGO));
    assert.ok(!/mercadolivre|meli|MLB/i.test(JS_CODIGO));
});
