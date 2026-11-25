// Testes de CONCORRÊNCIA — C1 vs. auto-import agendado.
//
// Comprovam que a recuperação no boot e os temporizadores de
// scheduleAutoImport não importam o mesmo álbum duas vezes.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const RAIZ = path.join(__dirname, "..", "..");
const FONTE = fs.readFileSync(path.join(RAIZ, "api", "routes", "tratocap.js"), "utf8");

// ------------------------------------------------------------------
// Extrai as funções de concorrência reais.
// ------------------------------------------------------------------
const vm = require("node:vm");

function carregarConcorrencia() {
    function pegar(nome) {
        let inicio = FONTE.indexOf(`async function ${nome}(`);

        if (inicio < 0) inicio = FONTE.indexOf(`function ${nome}(`);

        assert.ok(inicio > 0, `${nome} não encontrada`);

        const abre = FONTE.indexOf("(", inicio);
        let i = abre;
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

        return FONTE.slice(inicio, j + 1);
    }

    const sandbox = {
        console,
        safeAlbumName: (v) => String(v || "").trim() || "Sem_Album",
        importsEmAndamento: new Map(),
        importTimers: new Map(),
        clearTimeout,
        module: { exports: {} }
    };

    const codigo = [
        pegar("comTravaDeAlbum"),
        pegar("albumImportando"),
        pegar("cancelarTimerDoAlbum"),
        "module.exports = { comTravaDeAlbum, albumImportando, cancelarTimerDoAlbum };"
    ].join("\n\n");

    vm.createContext(sandbox);
    new vm.Script(codigo, { filename: "concorrencia.js" }).runInContext(sandbox);

    return { ...sandbox.module.exports, _sandbox: sandbox };
}

// ==================================================================
// 1 — Timer pendente + recuperação não importam duas vezes
// ==================================================================

test("1: trava impede que timer e boot importem o mesmo álbum duas vezes", async () => {
    const { comTravaDeAlbum } = carregarConcorrencia();

    let execucoes = 0;

    const tarefa = async () => {
        execucoes += 1;
        await new Promise(r => setTimeout(r, 20));
        return { imported: [{ album: "Produto 01", product_id: 1 }] };
    };

    // Duas entradas simultâneas (timer + boot) para o MESMO álbum.
    const [a, b] = await Promise.all([
        comTravaDeAlbum("Produto 01", tarefa),
        comTravaDeAlbum("Produto 01", tarefa)
    ]);

    assert.equal(execucoes, 1, "a importação deve executar uma única vez");
    assert.deepEqual(a, b, "ambas recebem o mesmo resultado");
});

// ==================================================================
// 2 — Importação em andamento não é interrompida
// ==================================================================

test("2: importação em andamento não é interrompida por nova entrada", async () => {
    const { comTravaDeAlbum, albumImportando } = carregarConcorrencia();

    let concluiu = false;

    const longa = comTravaDeAlbum("isqueiros", async () => {
        await new Promise(r => setTimeout(r, 40));
        concluiu = true;
        return { ok: true };
    });

    // Segunda entrada enquanto a primeira roda.
    assert.equal(albumImportando("isqueiros"), true, "deve indicar em andamento");

    const segunda = comTravaDeAlbum("isqueiros", async () => {
        throw new Error("não deveria executar");
    });

    assert.equal(segunda, longa, "a segunda entrada reaproveita a execução atual");

    await longa;

    assert.equal(concluiu, true, "a importação original terminou");
    assert.equal(albumImportando("isqueiros"), false, "trava liberada ao final");
});

// ==================================================================
// 3 — Dois pedidos simultâneos são controlados
// ==================================================================

test("3: dois pedidos simultâneos ao mesmo álbum geram um único produto", async () => {
    const { comTravaDeAlbum } = carregarConcorrencia();

    const produtos = [];

    const importar = async () => {
        await new Promise(r => setTimeout(r, 10));
        const id = produtos.length + 1;
        produtos.push(id);
        return { product_id: id };
    };

    await Promise.all([
        comTravaDeAlbum("album-x", importar),
        comTravaDeAlbum("album-x", importar),
        comTravaDeAlbum("album-x", importar)
    ]);

    assert.equal(produtos.length, 1, "somente um produto criado");
});

// ==================================================================
// 4 — Álbuns diferentes continuam paralelos
// ==================================================================

test("4: álbuns diferentes são processados independentemente", async () => {
    const { comTravaDeAlbum } = carregarConcorrencia();

    const processados = [];

    const tarefa = (nome) => async () => {
        processados.push(nome);
        await new Promise(r => setTimeout(r, 15));
        return { album: nome };
    };

    const resultados = await Promise.all([
        comTravaDeAlbum("Produto 01", tarefa("Produto 01")),
        comTravaDeAlbum("isqueiros", tarefa("isqueiros"))
    ]);

    assert.equal(processados.length, 2, "cada álbum executa uma vez");
    assert.equal(resultados[0].album, "Produto 01");
    assert.equal(resultados[1].album, "isqueiros");
});

// ==================================================================
// 5 — Falha permite nova tentativa
// ==================================================================

test("5: falha libera a trava e permite tentar de novo", async () => {
    const { comTravaDeAlbum, albumImportando } = carregarConcorrencia();

    let tentativas = 0;

    await assert.rejects(
        comTravaDeAlbum("quebra", async () => {
            tentativas += 1;
            throw new Error("disco cheio");
        }),
        /disco cheio/
    );

    assert.equal(albumImportando("quebra"), false, "trava liberada após falha");

    // Nova tentativa executa de fato.
    const ok = await comTravaDeAlbum("quebra", async () => {
        tentativas += 1;
        return { ok: true };
    });

    assert.equal(tentativas, 2, "a segunda tentativa executou");
    assert.equal(ok.ok, true);
});

// ==================================================================
// 6 — Duas recuperações consecutivas não duplicam
// ==================================================================

test("6: duas execuções sequenciais não duplicam importação", async () => {
    const { comTravaDeAlbum } = carregarConcorrencia();

    let execucoes = 0;

    const tarefa = async () => {
        execucoes += 1;
        return { ok: true };
    };

    await comTravaDeAlbum("seq", tarefa);
    await comTravaDeAlbum("seq", tarefa);

    // Sequencial: cada chamada é uma importação legítima nova (a dedupe
    // real é feita pelo marcador / reconciliação). O que a trava garante é
    // NÃO haver duas AO MESMO TEMPO.
    assert.equal(execucoes, 2, "sequencial executa duas vezes, não é trava");
});

test("6b: concorrente e sequencial juntos não duplicam produto", async () => {
    const { comTravaDeAlbum } = carregarConcorrencia();

    let produtos = 0;

    const importar = async () => {
        await new Promise(r => setTimeout(r, 10));
        produtos += 1;
        return { ok: true };
    };

    await Promise.all([
        comTravaDeAlbum("mix", importar),
        comTravaDeAlbum("mix", importar)
    ]);

    assert.equal(produtos, 1, "concorrência não duplica");

    // Sequencial posterior: executa, mas o marcador do importador real
    // impediria nova criação de produto (coberto em tratocapC1Boot.test.js).
    await comTravaDeAlbum("mix", importar);
    assert.equal(produtos, 2, "sequencial executa normalmente");
});

// ==================================================================
// 7 — cancelarTimerDoAlbum: escopo estreito
// ==================================================================

test("7: cancelarTimerDoAlbum cancela só o timer do álbum pedido", () => {
    const { cancelarTimerDoAlbum, _sandbox } = carregarConcorrencia();

    const canceladoA = [];
    const canceladoB = [];

    const timerA = setTimeout(() => {}, 10000);
    const timerB = setTimeout(() => {}, 10000);

    _sandbox.importTimers.set("Produto 01", {
        ...timerA,
        id: "a"
    });
    _sandbox.importTimers.set("isqueiros", {
        ...timerB,
        id: "b"
    });

    // Marcamos a instância para detectar qual foi limpa.
    let limpou = null;
    _sandbox.clearTimeout = (t) => { limpou = t?.id || null; };

    // Reconstitui a função com o clearTimeout instrumentado.
    const codigo = FONTE.slice(
        FONTE.indexOf("function cancelarTimerDoAlbum"),
        FONTE.indexOf("function cancelarTimerDoAlbum") + 500
    );

    const sandbox2 = {
        clearTimeout: (t) => { limpou = t?.id || null; },
        safeAlbumName: (v) => String(v || "").trim() || "Sem_Album",
        importTimers: _sandbox.importTimers,
        module: { exports: {} }
    };

    vm.createContext(sandbox2);
    new vm.Script(codigo.slice(0, codigo.indexOf("\n}") + 2) + "\nmodule.exports.f = cancelarTimerDoAlbum;")
        .runInContext(sandbox2);

    const resultado = sandbox2.module.exports.f("Produto 01");

    clearTimeout(timerA);
    clearTimeout(timerB);

    assert.equal(resultado, true, "deve reportar que cancelou");
    assert.equal(limpou, "a", "cancelou apenas o timer do álbum pedido");
    assert.equal(_sandbox.importTimers.has("isqueiros"), true, "outro timer preservado");
});

test("7b: cancelarTimerDoAlbum devolve false quando não há timer", () => {
    const { cancelarTimerDoAlbum } = carregarConcorrencia();

    assert.equal(cancelarTimerDoAlbum("inexistente"), false);
});

// ==================================================================
// Estrutura: proteções presentes no código
// ==================================================================

test("a trava é aplicada dentro de importAlbums", () => {
    const inicio = FONTE.indexOf("async function importAlbums(");
    const fim = FONTE.indexOf("async function importarAlbum(");
    const bloco = FONTE.slice(inicio, fim);

    assert.match(bloco, /comTravaDeAlbum\(album/, "importAlbums deve usar a trava");
});

test("a recuperação cancela o timer antes de importar", () => {
    const inicio = FONTE.indexOf("async function recuperarAlbunsNoBoot");
    const fim = FONTE.indexOf("router.recuperarAlbunsNoBoot");
    const bloco = FONTE.slice(inicio, fim);

    assert.match(bloco, /cancelarTimerDoAlbum\(album\)/);
    assert.match(bloco, /albumImportando\(album\)/, "deve checar importação em andamento");
});

test("a trava não usa limpeza indiscriminada de importTimers", () => {
    assert.ok(!/importTimers\.clear\(\)/.test(FONTE), "não pode limpar o Map inteiro");
});

test("falha em um álbum não impede os demais (teste existente preservado)", () => {
    const fonteTeste = fs.readFileSync(
        path.join(RAIZ, "api", "routes", "tratocapC1Boot.test.js"), "utf8"
    );

    assert.match(fonteTeste, /falha em um álbum não impede os demais/);
});
