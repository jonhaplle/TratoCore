// Testes da identificação com fallback de IA (Gemini -> visão local -> manual).
const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const servicePath = require.resolve("./identificationVendedor.service");

function loadWith(stubs = {}) {
    const originalLoad = Module._load;
    delete require.cache[servicePath];

    Module._load = function (request, parent, isMain) {
        if (parent?.filename === servicePath && Object.hasOwn(stubs, request)) {
            return stubs[request];
        }
        return originalLoad.call(this, request, parent, isMain);
    };

    try {
        return require(servicePath);
    } finally {
        Module._load = originalLoad;
    }
}

function sampleImage() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tratocore-ai-"));
    const file = path.join(dir, "foto.jpg");
    fs.writeFileSync(file, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    return file;
}

test("quando o Gemini está saudável, ele é usado e o local não é chamado", async () => {
    let localCalls = 0;

    const service = loadWith({
        "../geminiHealth.service": { async isAvailable() { return true; } },
        "../local-ai.service": {
            async analisarImagem() {
                return {
                    identification: { brand: "Samsung", model: "Galaxy A15", color: "Azul" },
                    facts: ["Tela grande"],
                    confidence: { score: 88, level: "HIGH" }
                };
            }
        },
        "../localVision.service": {
            isEnabled() { return true; },
            async analyzeImage() { localCalls += 1; return null; }
        }
    });

    const result = await service.identify({
        images: [{ original_url: sampleImage() }],
        sellerObservation: ""
    });

    assert.equal(result.ai.ok, true);
    assert.equal(result.ai.provider, "gemini");
    assert.equal(result.identification.brand, "Samsung");
    assert.equal(localCalls, 0);
});

test("com chave Gemini inválida, a análise local assume e avisa o vendedor", async () => {
    let geminiCalls = 0;

    const service = loadWith({
        "../geminiHealth.service": { async isAvailable() { return false; } },
        "../local-ai.service": {
            async analisarImagem() {
                geminiCalls += 1;
                throw new Error("chamada não deveria acontecer");
            }
        },
        "../localVision.service": {
            isEnabled() { return true; },
            async analyzeImage() {
                return {
                    product_type: "Celular",
                    brand: "Samsung",
                    model: "Galaxy A15",
                    color: "",
                    condition: "novo",
                    facts: ["Traseira azul", "Câmera tripla"],
                    hypotheses: [{ field: "model", value: "Galaxy A15" }],
                    confidence: { score: 62, level: "MEDIUM" },
                    model_used: "qwen3-vl:4b-instruct",
                    provider: "local_vision"
                };
            }
        }
    });

    const result = await service.identify({
        images: [{ original_url: sampleImage() }],
        sellerObservation: ""
    });

    assert.equal(geminiCalls, 0, "não deve chamar o Gemini com chave inválida");
    assert.equal(result.ai.ok, true);
    assert.equal(result.ai.provider, "local:qwen3-vl:4b-instruct");
    assert.equal(result.identification.brand, "Samsung");
    assert.equal(result.seller.condition, "", "estado nunca vem da foto");
    assert.ok(result.warnings.some(text => /modelo local/.test(text)));
});

test("sem nenhuma IA, cai na identificação declarada pelo vendedor", async () => {
    const service = loadWith({
        "../geminiHealth.service": { async isAvailable() { return false; } },
        "../local-ai.service": {
            async analisarImagem() { throw new Error("sem rede"); }
        },
        "../localVision.service": {
            isEnabled() { return true; },
            async analyzeImage() { throw new Error("llama-server process has terminated"); }
        }
    });

    const result = await service.identify({
        images: [{ original_url: sampleImage() }],
        sellerObservation: "Samsung Galaxy A15 128GB, usado, funciona"
    });

    assert.equal(result.ai.ok, false);
    assert.equal(result.seller.condition, "used");
    assert.equal(result.identification.brand, "Samsung");
    assert.ok(result.warnings.some(text => /revisão manual/.test(text)));
});

test("visão local desligada não é chamada", async () => {
    let localCalls = 0;

    const service = loadWith({
        "../geminiHealth.service": { async isAvailable() { return false; } },
        "../local-ai.service": { async analisarImagem() { throw new Error("sem rede"); } },
        "../localVision.service": {
            isEnabled() { return false; },
            async analyzeImage() { localCalls += 1; return null; }
        }
    });

    await service.identify({
        images: [{ original_url: sampleImage() }],
        sellerObservation: "produto usado"
    });

    assert.equal(localCalls, 0);
});
