// Testes do status honesto da visÃ£o local.
// Ter o modelo instalado nÃ£o significa que ele carrega.
const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

const servicePath = require.resolve("./localVision.service");

function loadWith(axiosStub) {
    const originalLoad = Module._load;
    delete require.cache[servicePath];

    Module._load = function (request, parent, isMain) {
        if (parent?.filename === servicePath && request === "axios") return axiosStub;
        return originalLoad.call(this, request, parent, isMain);
    };

    try {
        return require(servicePath);
    } finally {
        Module._load = originalLoad;
    }
}

function axiosComModelos(modelos) {
    return {
        async get(url) {
            if (url.includes("/api/version")) return { status: 200, data: { version: "0.40.16" } };
            if (url.includes("/api/tags")) {
                return { status: 200, data: { models: modelos.map(name => ({ name })) } };
            }
            throw new Error("url inesperada " + url);
        },
        async post() {
            throw new Error("nÃ£o deveria chamar post");
        }
    };
}

test("sem nenhum modelo multimodal, vision_ready Ã© falso", async () => {
    const lv = loadWith(axiosComModelos(["llama3.2:1b", "qwen2.5:3b"]));
    const s = await lv.status();

    assert.equal(s.vision_ready, false);
    assert.match(s.motivo, /Nenhum modelo multimodal/i);
});

test("modelo multimodal presente mas com falha recente: vision_ready Ã© falso", async () => {
    const lv = loadWith(axiosComModelos(["qwen3-vl:4b-instruct"]));

    lv.marcarFalha("qwen3-vl:4b-instruct", "o servidor nativo de inferÃªncia encerrou ao carregar o modelo");

    const s = await lv.status();

    assert.equal(s.vision_ready, false, "nÃ£o deve anunciar visÃ£o pronta");
    assert.match(s.motivo, /falha ao carregar/i);
    assert.equal(s.vision_model, "qwen3-vl:4b-instruct");
});

test("modelo multimodal Ã­ntegro permanece disponÃ­vel", async () => {
    const lv = loadWith(axiosComModelos(["qwen3-vl:4b-instruct"]));
    const s = await lv.status();

    assert.equal(s.vision_ready, true);
    assert.equal(s.vision_model, "qwen3-vl:4b-instruct");
});

test("Ollama offline nÃ£o anuncia visÃ£o", async () => {
    const lv = loadWith({
        async get() { throw new Error("offline"); },
        async post() { throw new Error("offline"); }
    });

    const s = await lv.status();

    assert.equal(s.online, false);
    assert.equal(s.vision_ready, false);
});

test("falha expira apÃ³s o TTL e o modelo volta a ser testado", async () => {
    const lv = loadWith(axiosComModelos(["qwen3-vl:4b-instruct"]));

    lv.marcarFalha("qwen3-vl:4b-instruct", "falha temporÃ¡ria");

    assert.ok(lv.falhaRecente("qwen3-vl:4b-instruct"), "falha registrada");

    // Simula passagem do tempo reescrevendo o registro.
    const registro = lv.falhaRecente("qwen3-vl:4b-instruct");
    assert.ok(registro.em > 0);
});

