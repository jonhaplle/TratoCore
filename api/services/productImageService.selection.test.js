const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

function loadService() {
    const servicePath = require.resolve("./productImageService");
    const originalLoad = Module._load;
    const calls = { ensure: 0, selection: null };
    const model = {
        async updateSelection(...args) {
            calls.selection = args;
            return [{ id: args[1][0], is_main: true, selected_for_ml: true }];
        }
    };
    const queue = { async ensureSchema() { calls.ensure += 1; } };
    delete require.cache[servicePath];
    Module._load = function (request, parent, isMain) {
        if (parent?.filename === servicePath && request === "../models/productImageModel") return model;
        if (parent?.filename === servicePath && request === "./tratocapSyncQueue.service") return queue;
        return originalLoad.call(this, request, parent, isMain);
    };
    try {
        return { service: originalLoad(servicePath, module, false), calls };
    } finally {
        Module._load = originalLoad;
    }
}

test("seleção ordena a imagem principal primeiro e limita a dez fotos", async () => {
    const { service, calls } = loadService();
    await service.updateSelection("17", [12, 13, 14], 14);
    assert.equal(calls.ensure, 1);
    assert.deepEqual(calls.selection, [17, [14, 12, 13], 14]);
});

test("seleção rejeita lista vazia, mais de dez fotos e IDs repetidos", async () => {
    const { service } = loadService();
    await assert.rejects(service.updateSelection(17, [], 1), /entre 1 e 10/);
    await assert.rejects(service.updateSelection(17, Array.from({ length: 11 }, (_, i) => i + 1), 1), /entre 1 e 10/);
    await assert.rejects(service.updateSelection(17, [1, 1], 1), /inválidos ou duplicados/);
});

test("imagem principal precisa fazer parte da seleção", async () => {
    const { service } = loadService();
    await assert.rejects(service.updateSelection(17, [1, 2], 3), /precisa estar selecionada/);
});
