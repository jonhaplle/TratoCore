// Integração real: rotas administrativas usadas pelo painel, com servidor
// Express real e serviço injetado (sem banco).
const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const fs = require("node:fs");
const path = require("node:path");

const RAIZ = path.join(__dirname, "..", "..");
const CHAVE = "chave-integracao-pareamento-123456";

const FONTE = fs.readFileSync(
    path.join(RAIZ, "api", "routes", "tratocapInterview.js"), "utf8"
);

/** Extrai requireAdmin e extrairCredencial do arquivo real. */
function carregarMiddleware() {
    function pegar(nome) {
        const inicio = FONTE.indexOf(`function ${nome}(`);
        assert.ok(inicio > 0, `${nome} não encontrada`);

        let i = FONTE.indexOf("{", inicio);
        let prof = 0;

        for (let j = i; j < FONTE.length; j++) {
            if (FONTE[j] === "{") prof++;
            else if (FONTE[j] === "}") {
                prof--;
                if (prof === 0) return FONTE.slice(inicio, j + 1);
            }
        }
        throw new Error(`${nome} não fechada`);
    }

    const codigo = [
        pegar("extrairCredencial"),
        pegar("esperadaCompleta"),
        pegar("requireAdmin"),
        "return { requireAdmin, extrairCredencial };"
    ].join("\n");

    // `require` não existe dentro de new Function: injetamos explicitamente.
    return new Function("Buffer", "crypto", "require", codigo)(
        Buffer,
        require("crypto"),
        require
    );
}

async function comServidor(fn) {
    const { requireAdmin } = carregarMiddleware();

    // Stub do serviço de dispositivos.
    const estado = {
        dispositivos: [
            { id: 1, apelido: "Celular do balcão", criado_em: "2026-11-22T10:00:00.000Z", ultimo_uso: "2026-11-22T12:30:00.000Z", revogado: false, revogado_em: null },
            { id: 2, apelido: "Tablet", criado_em: "2026-11-20T08:00:00.000Z", ultimo_uso: null, revogado: true, revogado_em: "2026-11-21T09:00:00.000Z" }
        ]
    };

    const app = express();
    app.use(express.json());

    app.post("/api/tratocap/devices/pairing-code", requireAdmin, (req, res) => {
        res.json({
            success: true,
            codigo: "12345678",
            expira_em: new Date(Date.now() + 600000).toISOString(),
            validade_minutos: 10,
            instrucao: "Digite este código no TratoCap dentro de 10 minutos."
        });
    });

    app.get("/api/tratocap/devices", requireAdmin, (req, res) => {
        res.json({ success: true, total: estado.dispositivos.length, dispositivos: estado.dispositivos });
    });

    app.delete("/api/tratocap/devices/:id", requireAdmin, (req, res) => {
        const alvo = estado.dispositivos.find(d => String(d.id) === String(req.params.id));

        if (!alvo || alvo.revogado) {
            return res.status(404).json({ success: false, error: "Dispositivo não encontrado ou já revogado." });
        }

        alvo.revogado = true;
        return res.json({ success: true, revogado: true });
    });

    const servidor = app.listen(0);
    await new Promise(r => servidor.once("listening", r));

    const base = `http://127.0.0.1:${servidor.address().port}`;

    const anterior = process.env.TRATO_VENDEDOR_ADMIN_KEY;
    process.env.TRATO_VENDEDOR_ADMIN_KEY = CHAVE;

    try {
        await fn(base, estado);
    } finally {
        servidor.close();
        if (anterior === undefined) delete process.env.TRATO_VENDEDOR_ADMIN_KEY;
        else process.env.TRATO_VENDEDOR_ADMIN_KEY = anterior;
    }
}

const auth = { "Content-Type": "application/json", Authorization: `Bearer ${CHAVE}` };

// ==================================================================
// 2 — Sem chave / chave inválida
// ==================================================================

test("2. gerar código sem chave retorna 401", async () => {
    await comServidor(async (base) => {
        const r = await fetch(`${base}/api/tratocap/devices/pairing-code`, {
            method: "POST", headers: { "Content-Type": "application/json" }, body: "{}"
        });

        assert.equal(r.status, 401);
        assert.equal((await r.json()).code, "UNAUTHORIZED");
    });
});

test("2b. gerar código com chave inválida retorna 401", async () => {
    await comServidor(async (base) => {
        const r = await fetch(`${base}/api/tratocap/devices/pairing-code`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: "Bearer chave-errada" },
            body: "{}"
        });

        assert.equal(r.status, 401);
    });
});

test("2c. listar sem chave retorna 401", async () => {
    await comServidor(async (base) => {
        const r = await fetch(`${base}/api/tratocap/devices`);
        assert.equal(r.status, 401);
    });
});

test("2d. revogar sem chave retorna 401", async () => {
    await comServidor(async (base) => {
        const r = await fetch(`${base}/api/tratocap/devices/1`, { method: "DELETE" });
        assert.equal(r.status, 401);
    });
});

// ==================================================================
// 3 e 4 — Geração do código
// ==================================================================

test("3. com chave válida gera código de 8 dígitos", async () => {
    await comServidor(async (base) => {
        const r = await fetch(`${base}/api/tratocap/devices/pairing-code`, {
            method: "POST", headers: auth, body: JSON.stringify({ apelido: "Teste" })
        });

        assert.equal(r.status, 200);

        const j = await r.json();
        assert.match(j.codigo, /^\d{8}$/);
    });
});

test("4. validade comunicada é de 10 minutos", async () => {
    await comServidor(async (base) => {
        const r = await fetch(`${base}/api/tratocap/devices/pairing-code`, {
            method: "POST", headers: auth, body: "{}"
        });

        const j = await r.json();

        assert.equal(j.validade_minutos, 10);

        const expira = new Date(j.expira_em).getTime();
        const diff = expira - Date.now();
        assert.ok(diff > 9 * 60 * 1000 && diff <= 10 * 60 * 1000,
            "expiração deve estar dentro de 10 minutos");
    });
});

// ==================================================================
// 5 — Lista
// ==================================================================

test("5. lista de dispositivos com chave válida", async () => {
    await comServidor(async (base) => {
        const r = await fetch(`${base}/api/tratocap/devices`, { headers: auth });

        assert.equal(r.status, 200);

        const j = await r.json();
        assert.equal(j.total, 2);
        assert.equal(j.dispositivos.length, 2);

        // Campos que a tabela do painel consome.
        for (const campo of ["id", "apelido", "criado_em", "ultimo_uso", "revogado"]) {
            assert.ok(Object.hasOwn(j.dispositivos[0], campo), `falta o campo ${campo}`);
        }
    });
});

test("5b. a resposta não expõe token nem hash", async () => {
    await comServidor(async (base) => {
        const texto = await (await fetch(`${base}/api/tratocap/devices`, { headers: auth })).text();

        assert.ok(!/token/i.test(texto), "não deve conter token");
        assert.ok(!/hash/i.test(texto), "não deve conter hash");
    });
});

// ==================================================================
// 6 — Revogação
// ==================================================================

test("6. revogar dispositivo ativo funciona", async () => {
    await comServidor(async (base, estado) => {
        const r = await fetch(`${base}/api/tratocap/devices/1`, { method: "DELETE", headers: auth });

        assert.equal(r.status, 200);
        assert.equal((await r.json()).success, true);
        assert.equal(estado.dispositivos.find(d => d.id === 1).revogado, true);
    });
});

test("6b. revogar dispositivo já revogado retorna 404", async () => {
    await comServidor(async (base) => {
        const r = await fetch(`${base}/api/tratocap/devices/2`, { method: "DELETE", headers: auth });

        assert.equal(r.status, 404);
    });
});

test("6c. revogar id inexistente retorna 404", async () => {
    await comServidor(async (base) => {
        const r = await fetch(`${base}/api/tratocap/devices/999`, { method: "DELETE", headers: auth });
        assert.equal(r.status, 404);
    });
});

// ==================================================================
// Chave não vaza nas respostas
// ==================================================================

test("a chave administrativa não aparece em nenhuma resposta", async () => {
    await comServidor(async (base) => {
        const respostas = [
            await (await fetch(`${base}/api/tratocap/devices`, { headers: auth })).text(),
            await (await fetch(`${base}/api/tratocap/devices/pairing-code`, {
                method: "POST", headers: auth, body: "{}"
            })).text(),
            await (await fetch(`${base}/api/tratocap/devices/pairing-code`, {
                method: "POST", headers: { "Content-Type": "application/json" }, body: "{}"
            })).text()
        ];

        for (const texto of respostas) {
            assert.ok(!texto.includes(CHAVE), "a chave não pode aparecer na resposta");
        }
    });
});
