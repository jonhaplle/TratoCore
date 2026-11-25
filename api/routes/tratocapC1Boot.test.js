// Testes de C1 — recuperação de álbuns no boot.
//
// Carrega o router REAL com dependências substituídas em require.cache
// (sem banco, sem Drive, sem Storage).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const RAIZ = path.join(__dirname, "..", "..");
const FONTE = fs.readFileSync(path.join(RAIZ, "api", "routes", "tratocap.js"), "utf8");

const JPEG = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01]);

// ------------------------------------------------------------------
// Carrega o router real com stubs. `albumsRoot` é substituído via
// process.env.TRATOCAP_STORAGE_ROOT, que o módulo usa para o storage.
// ------------------------------------------------------------------

/**
 * Em vez de montar o router inteiro (que abre conexões), extraímos
 * `imageFiles` + `recuperarAlbunsNoBoot` com `vm` num contexto que
 * fornece as dependências — sem usar `new Function` em escopo de função.
 */
const vm = require("node:vm");

function carregar({ albumsRoot, getByClientUuid, markAlbumImported }) {
    function pegar(nome) {
        // ATENÇÃO: procurar por "function <nome>(" acha também o trecho de
        // "async function <nome>(", e o corte descartaria o "async" — a
        // função perderia o await. Por isso procuramos o prefixo completo.
        let inicio = FONTE.indexOf(`async function ${nome}(`);

        if (inicio < 0) {
            inicio = FONTE.indexOf(`function ${nome}(`);
        }

        assert.ok(inicio > 0, `${nome} não encontrada`);

        return fatiar(inicio);
    }

    function fatiar(inicio) {
        // O corpo começa no `{` que abre o bloco, DEPOIS da lista de
        // parâmetros. Parâmetros com destructuring (`{ importar = null }`)
        // confundiriam um contador que começasse no primeiro `{`.
        const abreParen = FONTE.indexOf("(", inicio);

        let i = abreParen;
        let profundidadeParen = 0;

        // Pula a lista de parâmetros equilibrando parênteses.
        for (; i < FONTE.length; i++) {
            if (FONTE[i] === "(") profundidadeParen++;
            else if (FONTE[i] === ")") {
                profundidadeParen--;
                if (profundidadeParen === 0) { i++; break; }
            }
        }

        // A partir daqui, o próximo `{` abre o corpo.
        let j = FONTE.indexOf("{", i);
        let prof = 0;

        for (; j < FONTE.length; j++) {
            if (FONTE[j] === "{") prof++;
            else if (FONTE[j] === "}") {
                prof--;
                if (prof === 0) return FONTE.slice(inicio, j + 1);
            }
        }

        throw new Error("função não fechada");
    }

    const sandbox = {
        fs,
        path,
        crypto: require("crypto"),
        console,
        albumsRoot,
        ProductImageService: { getByClientUuid },
        SyncQueue: { markAlbumImported },
        sharp: null,
        // Dependências de concorrência usadas por recuperarAlbunsNoBoot.
        safeAlbumName: (v) => String(v || "").trim() || "Sem_Album",
        importsEmAndamento: new Map(),
        importTimers: new Map(),
        cancelarTimerDoAlbum: () => false,
        albumImportando: () => false,
        // C1.1 — a retomada valida o product_id do marcador pendente e usa
        // a mesma trava de importAlbums. Sem estes stubs o código extraído
        // não executa.
        ProductService: { getById: async () => null },
        comTravaDeAlbum: (album, tarefa) => tarefa(),
        // `module` é definido aqui, não como parâmetro: o código extraído
        // referencia `module.exports` no final.
        module: { exports: {} }
    };

    const codigo = [
        pegar("imageFiles"),
        pegar("marcadorValido"),
        "module.exports.recuperarAlbunsNoBoot = " + pegar("recuperarAlbunsNoBoot") + ";"
    ].join("\n\n");

    // `recuperarAlbunsNoBoot` é async. Um script comum via vm não aceita
    // `await` no topo, mas a DECLARAÇÃO de uma função async é válida em
    // escopo comum — o await fica dentro do corpo da função.
    const script = new vm.Script(codigo, { filename: "c1-extraido.js" });

    vm.createContext(sandbox);
    script.runInContext(sandbox);

    return sandbox.module.exports;
}

// ------------------------------------------------------------------
// Fixtures
// ------------------------------------------------------------------

function criarRaiz() {
    return fs.mkdtempSync(path.join(os.tmpdir(), "c1-boot-"));
}

function criarAlbum(raiz, nome, arquivos) {
    const dir = path.join(raiz, nome);
    fs.mkdirSync(dir, { recursive: true });

    for (const arq of arquivos) {
        fs.writeFileSync(path.join(dir, arq.nome), JPEG);

        if (arq.client_uuid) {
            fs.writeFileSync(
                path.join(dir, arq.nome + ".json"),
                JSON.stringify({ client_uuid: arq.client_uuid })
            );
        }
    }

    return dir;
}

// ==================================================================
// 1 — Boot com álbuns pendentes
// ==================================================================

test("C1: boot com álbum pendente importa e devolve o produto criado", async () => {
    const raiz = criarRaiz();
    criarAlbum(raiz, "Produto 01", [
        { nome: "a.jpg", client_uuid: "uuid-1" },
        { nome: "b.jpg", client_uuid: "uuid-2" }
    ]);

    const { recuperarAlbunsNoBoot } = carregar({
        albumsRoot: raiz,
        getByClientUuid: async () => null,
        markAlbumImported: async () => {}
    });

    const chamadas = [];

    const relatorio = await recuperarAlbunsNoBoot({
        importar: async (album) => {
            chamadas.push(album);
            return { imported: [{ album, product_id: 900 }], skipped: [] };
        }
    });

    fs.rmSync(raiz, { recursive: true, force: true });

    assert.deepEqual(relatorio.encontrados, ["Produto 01"]);
    assert.equal(relatorio.importados.length, 1);
    assert.equal(relatorio.importados[0].produto_id, 900);
    assert.equal(chamadas.length, 1);
});

// ==================================================================
// 2 — Ausência de álbuns
// ==================================================================

test("C1: sem álbuns não chama o importador", async () => {
    const raiz = criarRaiz();

    const { recuperarAlbunsNoBoot } = carregar({
        albumsRoot: raiz,
        getByClientUuid: async () => null,
        markAlbumImported: async () => {}
    });

    let chamadas = 0;

    const relatorio = await recuperarAlbunsNoBoot({
        importar: async () => { chamadas += 1; return { imported: [] }; }
    });

    fs.rmSync(raiz, { recursive: true, force: true });

    assert.deepEqual(relatorio.encontrados, []);
    assert.equal(chamadas, 0);
    assert.equal(relatorio.erros.length, 0);
});

test("C1: álbum sem imagens é ignorado com motivo", async () => {
    const raiz = criarRaiz();
    fs.mkdirSync(path.join(raiz, "vazio"), { recursive: true });

    const { recuperarAlbunsNoBoot } = carregar({
        albumsRoot: raiz,
        getByClientUuid: async () => null,
        markAlbumImported: async () => {}
    });

    let chamadas = 0;

    const relatorio = await recuperarAlbunsNoBoot({
        importar: async () => { chamadas += 1; return { imported: [] }; }
    });

    fs.rmSync(raiz, { recursive: true, force: true });

    assert.equal(chamadas, 0);
    assert.equal(relatorio.ignorados.length, 1);
    assert.equal(relatorio.ignorados[0].motivo, "sem imagens");
});

// ==================================================================
// 3 — Álbum já importado
// ==================================================================

test("C1: álbum com marcador não é reimportado", async () => {
    const raiz = criarRaiz();
    criarAlbum(raiz, "ja-importado", [{ nome: "a.jpg", client_uuid: "uuid-a" }]);
    fs.writeFileSync(
        path.join(raiz, "ja-importado", ".tratocore-import.json"),
        JSON.stringify({ product_id: 55 })
    );

    const { recuperarAlbunsNoBoot } = carregar({
        albumsRoot: raiz,
        getByClientUuid: async () => null,
        markAlbumImported: async () => {}
    });

    let chamadas = 0;

    const relatorio = await recuperarAlbunsNoBoot({
        importar: async () => { chamadas += 1; return { imported: [] }; }
    });

    fs.rmSync(raiz, { recursive: true, force: true });

    assert.equal(chamadas, 0);
    assert.equal(relatorio.jaVinculados.length, 1);
    assert.equal(relatorio.jaVinculados[0].motivo, "marcador presente");
});

test("C1: produto existente sem marcador é reconciliado sem criar outro", async () => {
    const raiz = criarRaiz();
    criarAlbum(raiz, "sem-marcador", [{ nome: "a.jpg", client_uuid: "uuid-reconcilia" }]);

    const marcados = [];

    const { recuperarAlbunsNoBoot } = carregar({
        albumsRoot: raiz,
        getByClientUuid: async (uuid) =>
            (uuid === "uuid-reconcilia" ? { id: 1, product_id: 77 } : null),
        markAlbumImported: async (album, id) => { marcados.push({ album, id }); }
    });

    let chamadas = 0;

    const relatorio = await recuperarAlbunsNoBoot({
        importar: async () => { chamadas += 1; return { imported: [] }; }
    });

    fs.rmSync(raiz, { recursive: true, force: true });

    assert.equal(chamadas, 0, "não deve criar produto duplicado");
    assert.equal(relatorio.jaVinculados.length, 1);
    assert.equal(relatorio.jaVinculados[0].produto_id, 77);
    assert.equal(marcados.length, 1);
});

// ==================================================================
// 4 — Duas execuções consecutivas (idempotência)
// ==================================================================

test("C1: duas execuções não duplicam produto", async () => {
    const raiz = criarRaiz();
    criarAlbum(raiz, "pendente", [{ nome: "a.jpg", client_uuid: "uuid-idem" }]);

    let produtoCriado = null;

    const { recuperarAlbunsNoBoot } = carregar({
        albumsRoot: raiz,
        getByClientUuid: async (uuid) =>
            (produtoCriado && uuid === "uuid-idem" ? { id: 1, product_id: produtoCriado } : null),
        markAlbumImported: async () => {}
    });

    const importar = async (album) => {
        produtoCriado = 101;
        return { imported: [{ album, product_id: 101 }], skipped: [] };
    };

    const r1 = await recuperarAlbunsNoBoot({ importar });
    assert.equal(r1.importados.length, 1);

    fs.writeFileSync(
        path.join(raiz, "pendente", ".tratocore-import.json"),
        JSON.stringify({ product_id: 101 })
    );

    const r2 = await recuperarAlbunsNoBoot({ importar });

    fs.rmSync(raiz, { recursive: true, force: true });

    assert.equal(r2.importados.length, 0);
    assert.equal(r2.jaVinculados.length, 1);
    assert.equal(produtoCriado, 101);
});

test("C1: sem marcador, a segunda execução reconcilia em vez de duplicar", async () => {
    const raiz = criarRaiz();
    criarAlbum(raiz, "sem-marcador-2", [{ nome: "a.jpg", client_uuid: "uuid-recon2" }]);

    let produtoCriado = null;
    let chamadasImportacao = 0;

    const { recuperarAlbunsNoBoot } = carregar({
        albumsRoot: raiz,
        getByClientUuid: async (uuid) =>
            (produtoCriado && uuid === "uuid-recon2" ? { id: 1, product_id: produtoCriado } : null),
        markAlbumImported: async () => {}
    });

    const importar = async (album) => {
        chamadasImportacao += 1;
        produtoCriado = 202;
        return { imported: [{ album, product_id: 202 }], skipped: [] };
    };

    await recuperarAlbunsNoBoot({ importar });
    await recuperarAlbunsNoBoot({ importar });

    fs.rmSync(raiz, { recursive: true, force: true });

    assert.equal(chamadasImportacao, 1, "importação só pode ocorrer uma vez");
    assert.equal(produtoCriado, 202);
});

// ==================================================================
// 5 — Falha durante a importação
// ==================================================================

test("C1: falha em um álbum não impede os demais", async () => {
    const raiz = criarRaiz();
    criarAlbum(raiz, "aaa-quebra", [{ nome: "a.jpg", client_uuid: "u1" }]);
    criarAlbum(raiz, "bbb-ok", [{ nome: "b.jpg", client_uuid: "u2" }]);

    const { recuperarAlbunsNoBoot } = carregar({
        albumsRoot: raiz,
        getByClientUuid: async () => null,
        markAlbumImported: async () => {}
    });

    const relatorio = await recuperarAlbunsNoBoot({
        importar: async (album) => {
            if (album === "aaa-quebra") throw new Error("disco cheio");
            return { imported: [{ album, product_id: 303 }], skipped: [] };
        }
    });

    fs.rmSync(raiz, { recursive: true, force: true });

    assert.equal(relatorio.erros.length, 1);
    assert.equal(relatorio.erros[0].album, "aaa-quebra");
    assert.equal(relatorio.importados.length, 1);
    assert.equal(relatorio.importados[0].album, "bbb-ok");
});

test("C1: erro de banco na reconciliação é registrado, não silenciado", async () => {
    const raiz = criarRaiz();
    criarAlbum(raiz, "erro-recon", [{ nome: "a.jpg", client_uuid: "u-erro" }]);

    const { recuperarAlbunsNoBoot } = carregar({
        albumsRoot: raiz,
        getByClientUuid: async () => { throw new Error("banco fora"); },
        markAlbumImported: async () => {}
    });

    const relatorio = await recuperarAlbunsNoBoot({
        importar: async () => ({ imported: [], skipped: [] })
    });

    fs.rmSync(raiz, { recursive: true, force: true });

    assert.equal(relatorio.erros[0].etapa, "reconciliar");
    assert.match(relatorio.erros[0].motivo, /banco fora/);
});

// ==================================================================
// 6 — Concorrência com o temporizador existente
// ==================================================================

test("C1: não depende de setTimeout (execução determinística)", () => {
    const inicio = FONTE.indexOf("async function recuperarAlbunsNoBoot");
    assert.ok(inicio > 0, "função não encontrada");

    // Extrai apenas o CORPO da função (até a chave que a fecha), usando o
    // mesmo balanceamento do helper. Assim não pegamos o setTimeout da
    // recuperação antiga, que fica fora desta função.
    const abreParen = FONTE.indexOf("(", inicio);
    let i = abreParen;
    let p = 0;

    for (; i < FONTE.length; i++) {
        if (FONTE[i] === "(") p++;
        else if (FONTE[i] === ")") { p--; if (p === 0) { i++; break; } }
    }

    let j = FONTE.indexOf("{", i);
    let d = 0;

    for (; j < FONTE.length; j++) {
        if (FONTE[j] === "{") d++;
        else if (FONTE[j] === "}") { d--; if (d === 0) break; }
    }

    const bloco = FONTE.slice(inicio, j + 1);

    assert.ok(bloco.length > 500, "bloco muito curto — extração falhou");
    assert.ok(!/setTimeout/.test(bloco), "não pode usar timer");
    assert.ok(!/setInterval/.test(bloco), "não pode usar timer");
});

test("C1: chamado dentro de app.listen, depois do servidor escutar", () => {
    const server = fs.readFileSync(path.join(RAIZ, "api", "server.js"), "latin1");

    const posListen = server.indexOf("app.listen(");
    const posC1 = server.indexOf("recuperarAlbunsNoBoot");

    assert.ok(posListen > 0 && posC1 > posListen, "C1 deve estar no callback do listen");
});

test("C1: falha no boot não derruba o servidor", () => {
    const server = fs.readFileSync(path.join(RAIZ, "api", "server.js"), "latin1");

    const pos = server.indexOf("recuperarAlbunsNoBoot");
    const bloco = server.slice(pos, pos + 400);

    assert.match(bloco, /catch/);
    assert.ok(!/process\.exit/.test(bloco));
});

test("C1: exportado no router", () => {
    assert.match(FONTE, /router\.recuperarAlbunsNoBoot = recuperarAlbunsNoBoot;/);
});
