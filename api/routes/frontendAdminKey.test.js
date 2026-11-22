// Verificação de compatibilidade da chave administrativa no frontend.
//
// Não sobe servidor: valida a estrutura de cada página e script.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const RAIZ = path.join(__dirname, "..", "..");
const pub = (n) => fs.readFileSync(path.join(RAIZ, "public", n), "utf8");

/** Remove comentários para não confundir documentação com código. */
function semComentarios(js) {
    return js
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^[ \t]*\/\/.*$/gm, "");
}

// ==================================================================
// index.html
// ==================================================================

test("index.html tem o campo de chave administrativa", () => {
    const html = pub("index.html");

    assert.match(html, /id="adminKey"/);
    assert.match(html, /type="password"/);
    assert.match(html, /autocomplete="off"/);
});

test("index.html -> app.js envia a chave no POST de produtos", () => {
    const js = pub("app.js");

    assert.match(js, /function cabecalhosComChave\(\)/);
    assert.match(js, /headers: cabecalhosComChave\(\)/);
});

// ==================================================================
// produtos.html
// ==================================================================

test("produtos.html carrega produtos.js", () => {
    assert.match(pub("produtos.html"), /produtos\.js/);
});

test("produtos.html tem o próprio campo de chave", () => {
    const html = pub("produtos.html");

    assert.match(html, /id="adminKey"/, "campo local na página de produtos");
    assert.match(html, /type="password"/);
    assert.match(html, /autocomplete="off"/);
});

test("produtos.js envia chave em PUT, DELETE e improve-ai", () => {
    const js = pub("produtos.js");

    assert.match(js, /function cabecalhosEscrita\(\)/);

    const usos = (js.match(/headers: cabecalhosEscrita\(\)/g) || []).length;
    assert.ok(usos >= 3, `esperado >= 3, encontrado ${usos}`);
});

test("produtos.js liga o campo ao carregar a página", () => {
    const js = pub("produtos.js");

    assert.match(js, /function ligarCampoChave\(\)/);
    assert.match(js, /ligarCampoChave\(\);/, "deve ser chamada na inicialização");
});

test("produtos.js NÃO tenta compartilhar a chave via window", () => {
    // index.html -> produtos.html é navegação de documento completo:
    // `window` é recriado, então uma ponte por window não funcionaria.
    // Cada página tem o próprio campo e o usuário digita a chave nela.
    const js = pub("produtos.js");

    assert.ok(!js.includes("window.__chaveAdmin"),
        "não deve depender de ponte entre páginas");
});

// ==================================================================
// produto.html
// ==================================================================

test("produto.js só escreve em product-images (não em /api/products)", () => {
    const js = pub("produto.js");

    // Escritas reais: qualquer fetch com método POST/PUT/DELETE.
    const escritas = js.match(/method:\s*"(POST|PUT|DELETE)"/g) || [];
    assert.ok(escritas.length <= 1, `escritas inesperadas: ${escritas.join(", ")}`);

    // Ocorrências de /api/products devem ser leitura (GET).
    const linhas = js.split(/\r?\n/);
    for (let i = 0; i < linhas.length; i++) {
        if (linhas[i].includes("/api/products")) {
            const bloco = linhas.slice(i, i + 3).join(" ");
            assert.ok(!/method:\s*"(POST|PUT|DELETE)"/.test(bloco),
                `linha ${i + 1}: escrita em /api/products`);
        }
    }
});

test("produto.html não precisa de chave administrativa", () => {
    assert.match(pub("produto.js"), /\/api\/product-images\//);
});

// ==================================================================
// anuncio.html
// ==================================================================

test("anuncio.js tem mecanismo próprio de chave (Bearer)", () => {
    const js = pub("anuncio.js");

    assert.match(js, /function pedirChavePublicacao\(/);
    assert.match(js, /window\.__chavePublicacao/);
    assert.match(js, /Authorization: "Bearer "/);
});

test("anuncio.js pede a chave quando o servidor recusa", () => {
    const js = pub("anuncio.js");

    assert.match(js, /pedirChavePublicacao\(/);
    assert.match(js, /401|503/);
});

// ==================================================================
// Segurança: nenhum script grava a chave administrativa em storage
// ==================================================================

test("SEGURANÇA: chave administrativa não vai para storage", () => {
    const scripts = ["app.js", "produtos.js", "produto.js", "anuncio.js"];

    for (const nome of scripts) {
        const caminho = path.join(RAIZ, "public", nome);
        if (!fs.existsSync(caminho)) continue;

        const js = semComentarios(fs.readFileSync(caminho, "utf8"));

        // Padrão: setItem com identificador de chave administrativa.
        const setItem = /(localStorage|sessionStorage)\.setItem\([^)]*(adminKey|chaveAdministrativa|__chaveAdmin|__chavePublicacao)/i;
        assert.ok(!setItem.test(js), `${nome}: não pode gravar a chave em storage`);

        // Padrão: atribuição direta de propriedade.
        const prop = /(localStorage|sessionStorage)\.[A-Za-z_$][\w$]*\s*=[^\n]*(adminKey|chave)/i;
        assert.ok(!prop.test(js), `${nome}: não pode gravar a chave em storage`);
    }
});

test("SEGURANÇA: google-drive-setup usa storage próprio (mecanismo pré-existente, fora do escopo)", () => {
    // Registro consciente: a tela de configuração do Google Drive guarda a
    // chave dela em sessionStorage, sob a sua PRÓPRIA chave
    // ("googleDriveAdminKey"). É um mecanismo existente, numa página
    // separada (google-drive-setup.html), e NÃO é a chave de produtos.
    const js = pub("google-drive-setup.js");

    assert.match(js, /sessionStorage\.setItem\("googleDriveAdminKey"/);

    // O identificador "adminKey" ali é apenas o id do INPUT naquela página,
    // nunca uma chave de produtos: as duas páginas não compartilham DOM.
    const htmlProdutos = pub("produtos.html");
    assert.ok(!htmlProdutos.includes("google-drive-setup.js"));

    const htmlDrive = pub("google-drive-setup.html");
    assert.ok(!htmlDrive.includes("produtos.js"));
});

test("SEGURANÇA: nenhuma chave literal no HTML", () => {
    for (const pagina of ["index.html", "produtos.html", "produto.html", "anuncio.html"]) {
        const html = pub(pagina);
        const suspeito = /(value|data-key)\s*=\s*["'][A-Za-z0-9_\-]{16,}["']/g;

        assert.deepEqual(html.match(suspeito) || [], [], `${pagina}: nenhuma chave embutida`);
    }
});

// ==================================================================
// Não duplicar mecanismo de autenticação
// ==================================================================

test("ARQUITETURA: telas de produtos usam apenas Bearer", () => {
    for (const nome of ["app.js", "produtos.js"]) {
        const js = pub(nome);

        assert.match(js, /Authorization": `Bearer \$\{chave\}`/);
        assert.ok(!/["']X-Api-Key["']|["']x-admin-key["']/i.test(js), `${nome}: apenas Bearer`);
    }
});

test("ARQUITETURA: middleware do servidor é único (publishKeyAuth)", () => {
    const rotas = fs.readFileSync(path.join(RAIZ, "api", "routes", "products.js"), "utf8");

    assert.match(rotas, /require\("\.\.\/middleware\/publishKeyAuth"\)/);
    assert.ok(!/process\.env\.TRATO_VENDEDOR_ADMIN_KEY/.test(rotas),
        "a rota não deve comparar a chave diretamente");
});

// ==================================================================
// Mensagens de 401 e 503
// ==================================================================

test("mensagem 401 é compreensível", () => {
    const fonte = fs.readFileSync(
        path.join(RAIZ, "api", "middleware", "publishKeyAuth.js"), "utf8"
    );
    assert.match(fonte, /Chave de autorização inválida/);
});

test("mensagem 503 explica a configuração ausente", () => {
    const fonte = fs.readFileSync(
        path.join(RAIZ, "api", "middleware", "publishKeyAuth.js"), "utf8"
    );
    assert.match(fonte, /ADMIN_KEY_NOT_CONFIGURED/);
});

test("frontend orienta quando falta a chave", () => {
    assert.match(pub("app.js"), /Informe a chave administrativa/);
    assert.match(pub("produtos.js"), /Informe a chave administrativa/);
});

// ==================================================================
// Preservação: TratoCap e Mercado Livre
// ==================================================================

test("PRESERVAÇÃO: TratoCap não depende da chave administrativa", () => {
    const fonte = fs.readFileSync(path.join(RAIZ, "api", "routes", "tratocap.js"), "utf8");

    assert.match(fonte, /ProductService\.create\(/);
    assert.ok(!/requireAdminKey[^;]*ProductService/.test(fonte));
});

test("PRESERVAÇÃO: api.js não ganhou lógica de chave", () => {
    const js = pub("js/core/api.js");

    assert.ok(!/adminKey|__chavePublicacao/i.test(js),
        "o wrapper genérico não deve conhecer a chave");
});
