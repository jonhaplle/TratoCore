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
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tratocore-test-"));
    const file = path.join(dir, "foto.jpg");
    fs.writeFileSync(file, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    return file;
}

test("estado nunca é deduzido sem declaração do vendedor", async () => {
    const service = loadWith({
        "../local-ai.service": {
            async analisarImagem() {
                return {
                    product_type: "Celular",
                    identification: { brand: "Samsung", model: "Galaxy A15", condition: "" },
                    facts: ["Tela grande"],
                    confidence: { score: 82, level: "MEDIUM" }
                };
            }
        }
    });

    const result = await service.identify({
        images: [{ original_url: sampleImage() }],
        sellerObservation: ""
    });

    assert.equal(result.seller.condition, "");
    assert.ok(result.questions.some(question => question.field === "condition"));
});

test("observação do vendedor define estado, acessórios e defeitos", async () => {
    const service = loadWith({
        "../local-ai.service": {
            async analisarImagem() {
                throw new Error("IA fora do ar");
            }
        }
    });

    const result = await service.identify({
        images: [],
        sellerObservation: "Samsung Galaxy A15 128GB, usado, funciona, acompanha carregador, tem risco na tela"
    });

    assert.equal(result.seller.condition, "used");
    assert.equal(result.seller.working, true);
    assert.deepEqual(result.seller.accessories, ["Carregador"]);
    assert.ok(result.seller.defects.includes("Risco"));
    assert.equal(result.identification.capacity, "128GB");
    assert.equal(result.ai.ok, false);
    assert.ok(result.warnings.some(text => /IA não respondeu/.test(text)));
});

test("capacidade só aparece como hipótese quando não há evidência", async () => {
    const service = loadWith({
        "../local-ai.service": {
            async analisarImagem() {
                return {
                    identification: { brand: "Samsung", model: "Galaxy A15" },
                    facts: ["Ecrã grande"],
                    confidence: { score: 40, level: "LOW" }
                };
            }
        }
    });

    const result = await service.identify({
        images: [{ original_url: sampleImage() }],
        sellerObservation: ""
    });

    assert.equal(result.identification.capacity, "");
    assert.ok(
        result.hypotheses.some(item => item.field === "model")
        || result.evidence.some(item => item.field === "observacao") === false
    );
});

test("fatos da IA não viram condição, acessórios ou funcionamento", async () => {
    const service = loadWith({
        "../local-ai.service": {
            async analisarImagem() {
                return {
                    identification: { brand: "Samsung", model: "Galaxy A15", condition: "new" },
                    facts: ["Acompanha carregador original", "Funcionando perfeitamente"],
                    confidence: { score: 90, level: "HIGH" }
                };
            }
        }
    });

    const result = await service.identify({
        images: [{ original_url: sampleImage() }],
        sellerObservation: ""
    });

    assert.equal(result.seller.condition, "");
    assert.deepEqual(result.seller.accessories, []);
    assert.equal(result.seller.working, null);
});

test("observação com 'nunca usado' declara produto novo", async () => {
    const service = loadWith({
        "../local-ai.service": { async analisarImagem() { throw new Error("sem IA"); } }
    });

    const result = await service.identify({
        sellerObservation: "iPhone 13 lacrado, nunca usado"
    });

    assert.equal(result.seller.condition, "new");
});

test("declaração de usado prevalece sobre 'sem uso'", async () => {
    const service = loadWith({
        "../local-ai.service": { async analisarImagem() { throw new Error("sem IA"); } }
    });

    const result = await service.identify({
        sellerObservation: "Produto usado, mas sem uso nos últimos meses"
    });

    assert.equal(result.seller.condition, "used");
});
