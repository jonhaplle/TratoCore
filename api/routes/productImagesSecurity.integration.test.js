// Teste de integração real: sobe o router de imagens num servidor Express
// com controller STUB (nenhum toque no banco, nenhuma imagem excluída).
//
// Prova o comportamento HTTP efetivo das rotas protegidas.
const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");

const createRouter = require("./productImages").createProductImagesRouter;

const CHAVE = "chave-integracao-imagens-123456";

// Controller stub: registra a chamada e responde 200 sem efeitos.
function criarStub() {
    const chamadas = [];
    const ok = (nome) => (req, res) => {
        chamadas.push(nome);
        res.json({ success: true, rota: nome });
    };

    return {
        chamadas,
        controller: {
            create: ok("create"),
            getByProductId: ok("listar"),
            getMainImage: ok("principal"),
            setMainImage: ok("setMain"),
            updateSelection: ok("selection"),
            remove: ok("remove")
        }
    };
}

function servicoStub() {
    return {
        getFileMetadata: async () => ({ mimeType: "image/jpeg" }),
        getFileStream: async () => ({ on() {}, pipe() {} })
    };
}

async function comServidor(fn) {
    const stub = criarStub();

    const app = express();
    app.use(express.json());

    app.use("/api/product-images", createRouter({
        controller: stub.controller,
        legacyDrive: { getDriveClient: () => ({}), getFileStream: async () => ({ on() {}, pipe() {} }) },
        oauthService: servicoStub()
    }));

    const servidor = app.listen(0);
    await new Promise(r => servidor.once("listening", r));

    const base = `http://127.0.0.1:${servidor.address().port}/api/product-images`;

    const anterior = process.env.TRATO_VENDEDOR_ADMIN_KEY;
    process.env.TRATO_VENDEDOR_ADMIN_KEY = CHAVE;

    try {
        await fn(base, stub);
    } finally {
        servidor.close();
        if (anterior === undefined) delete process.env.TRATO_VENDEDOR_ADMIN_KEY;
        else process.env.TRATO_VENDEDOR_ADMIN_KEY = anterior;
    }
}

const auth = { "Content-Type": "application/json", Authorization: `Bearer ${CHAVE}` };
const json = { "Content-Type": "application/json" };

// ==================================================================
// Escrita sem chave -> 401 e NENHUMA chamada ao controller
// ==================================================================

test("POST sem chave -> 401, controller não é chamado", async () => {
    await comServidor(async (base, stub) => {
        const r = await fetch(base, { method: "POST", headers: json, body: JSON.stringify({ product_id: 1 }) });

        assert.equal(r.status, 401);
        assert.equal((await r.json()).code, "UNAUTHORIZED");
        assert.deepEqual(stub.chamadas, [], "controller não deve ser executado");
    });
});

test("PUT /selection sem chave -> 401", async () => {
    await comServidor(async (base, stub) => {
        const r = await fetch(`${base}/product/1/selection`, {
            method: "PUT", headers: json, body: JSON.stringify({ selected_image_ids: [] })
        });

        assert.equal(r.status, 401);
        assert.deepEqual(stub.chamadas, []);
    });
});

test("PUT /main sem chave -> 401", async () => {
    await comServidor(async (base, stub) => {
        const r = await fetch(`${base}/product/1/main/2`, { method: "PUT", headers: json });

        assert.equal(r.status, 401);
        assert.deepEqual(stub.chamadas, []);
    });
});

test("DELETE sem chave -> 401 (nenhuma imagem excluída)", async () => {
    await comServidor(async (base, stub) => {
        const r = await fetch(`${base}/99`, { method: "DELETE" });

        assert.equal(r.status, 401);
        assert.deepEqual(stub.chamadas, [], "remove não deve ser chamado");
    });
});

test("chave incorreta -> 401", async () => {
    await comServidor(async (base, stub) => {
        const r = await fetch(base, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: "Bearer errada" },
            body: JSON.stringify({ product_id: 1 })
        });

        assert.equal(r.status, 401);
        assert.deepEqual(stub.chamadas, []);
    });
});

// ==================================================================
// Escrita com chave -> autorizada
// ==================================================================

test("POST com chave -> 200 e controller chamado", async () => {
    await comServidor(async (base, stub) => {
        const r = await fetch(base, {
            method: "POST", headers: auth, body: JSON.stringify({ product_id: 1, url: "x.jpg" })
        });

        assert.equal(r.status, 200);
        assert.deepEqual(stub.chamadas, ["create"]);
    });
});

test("PUT /selection com chave -> 200", async () => {
    await comServidor(async (base, stub) => {
        const r = await fetch(`${base}/product/1/selection`, {
            method: "PUT", headers: auth, body: JSON.stringify({ selected_image_ids: [1, 2] })
        });

        assert.equal(r.status, 200);
        assert.deepEqual(stub.chamadas, ["selection"]);
    });
});

test("PUT /main com chave -> 200", async () => {
    await comServidor(async (base, stub) => {
        const r = await fetch(`${base}/product/1/main/2`, { method: "PUT", headers: auth });

        assert.equal(r.status, 200);
        assert.deepEqual(stub.chamadas, ["setMain"]);
    });
});

test("DELETE com chave -> 200", async () => {
    await comServidor(async (base, stub) => {
        const r = await fetch(`${base}/99`, { method: "DELETE", headers: auth });

        assert.equal(r.status, 200);
        assert.deepEqual(stub.chamadas, ["remove"]);
    });
});

// ==================================================================
// Leitura continua pública
// ==================================================================

test("GET /product/:id continua 200 sem chave", async () => {
    await comServidor(async (base, stub) => {
        const r = await fetch(`${base}/product/1`);

        assert.equal(r.status, 200);
        assert.deepEqual(stub.chamadas, ["listar"]);
    });
});

test("GET /product/:id/main continua 200 sem chave", async () => {
    await comServidor(async (base, stub) => {
        const r = await fetch(`${base}/product/1/main`);

        assert.equal(r.status, 200);
        assert.deepEqual(stub.chamadas, ["principal"]);
    });
});

// ==================================================================
// Middleware não vaza a chave
// ==================================================================

test("a chave não aparece em nenhuma resposta", async () => {
    await comServidor(async (base) => {
        const semChave = await (await fetch(base, { method: "POST", headers: json, body: "{}" })).text();

        assert.ok(!semChave.includes(CHAVE));
        assert.ok(!/token_hash|secret/i.test(semChave));
    });
});
