const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const Module = require("node:module");

function missingValidationError(attributeId, conditional = false) {
    const error = new Error("simulated Mercado Livre validation error");
    error.response = {
        status: 400,
        data: {
            cause: [{
                code: conditional
                    ? "item.attribute.missing_conditional_required"
                    : "item.attribute.missing_required",
                message: `The attributes [${attributeId}] are required`
            }]
        }
    };
    return error;
}

function missingPicturesValidationError() {
    const error = new Error("simulated validation requires pictures");
    error.response = {
        status: 400,
        data: { cause: [{ code: "item.pictures.required", message: "Pictures are required" }] }
    };
    return error;
}

function createBackend({ validationErrors = [
    missingValidationError("MATERIAL"),
    missingValidationError("GTIN", true)
], uploadError = null, imageKind = "drive" } = {}) {
    const calls = { validationPayloads: [], publishItem: 0, publishPayload: null, pictureUpload: 0, uploadInputs: [], events: [] };
    const product = {
        id: "10",
        title: "Saca-rolhas manual prateado",
        description: "Acabamento prateado; material ainda não confirmado.",
        sale_price: 25,
        quantity: 1,
        condition: "used",
        attributes: { material: "Prata" }
    };
    const definitions = [
        { id: "MATERIAL", name: "Material", value_type: "string", tags: {}, values: [] },
        { id: "GTIN", name: "GTIN", value_type: "string", tags: {}, values: [] }
    ];
    const apiService = {
        async getAccessToken() {},
        async getMe() { return {}; },
        async validateItem(item) {
            calls.events.push("validate");
            calls.validationPayloads.push(structuredClone(item));
            const error = validationErrors[calls.validationPayloads.length - 1];
            if (error) throw error;
            return {};
        },
        async publishItem(item) {
            calls.events.push("publishItem");
            calls.publishItem += 1;
            calls.publishPayload = item;
            throw new Error("mock stopped before any outbound item creation request");
        }
    };
    const pictureService = {
        async upload(pictures) {
            calls.events.push("upload");
            calls.pictureUpload += 1;
            calls.uploadInputs.push(pictures);
            if (uploadError) throw uploadError;
            return pictures.map((_, index) => ({ id: `PIC-10-${index + 1}` }));
        }
    };

    const stubs = {
        "../productService": { async getById() { return { ...product }; } },
        "../productImageService": {
            async getByProductId() {
                return imageKind === "drive"
                    ? [{ original_url: "https://images.invalid/product-10.jpg", drive_file_id: "drive-file-10" }]
                    : [{ original_url: "/storage/originals/product-10.jpg", path: "storage/originals/product-10.jpg", file_name: "product-10.jpg" }];
            }
        },
        "./api.service": apiService,
        "./mlProduct.service": { async savePublication() {} },
        "./publicationSpec.service": {
            async resolve() {
                return {
                    category_id: "MLB193633",
                    category: { id: "MLB193633", name: "Acessórios" , settings: { max_title_length: 60 } },
                    listing_type: { id: "gold_pro" },
                    attributes: definitions,
                    conditionalAttributes: { required_attributes: [] },
                    prediction: { attributes: [{ id: "MATERIAL", value_name: "Prata" }] }
                };
            }
        }
    };

    const publishServicePath = require.resolve("./publish.service");
    const itemServicePath = require.resolve("./item.service");
    const controllerPath = path.resolve(__dirname, "../../controllers/mlController.js");
    const originalLoad = Module._load;
    delete require.cache[publishServicePath];
    delete require.cache[itemServicePath];
    delete require.cache[controllerPath];

    Module._load = function (request, parent, isMain) {
        if (parent?.filename === publishServicePath && Object.hasOwn(stubs, request)) return stubs[request];
        if (parent?.filename === itemServicePath && request === "./picture.service") return pictureService;
        if (parent?.filename === controllerPath) {
            if (request === "../services/ml/publish.service") return originalLoad(publishServicePath, parent, isMain);
            if (request === "../services/ml/oauth.service") return {};
            if (request === "../services/ml/api.service") return apiService;
        }
        return originalLoad.call(this, request, parent, isMain);
    };

    try {
        const publishService = originalLoad(publishServicePath, module, false);
        require.cache[publishServicePath].exports = publishService;
        const controller = originalLoad(controllerPath, module, false);
        return { calls, controller };
    } finally {
        Module._load = originalLoad;
    }
}

function createModalElement() {
    return {
        style: {},
        addEventListener() {}
    };
}

async function callPublishController(controller, body) {
    let statusCode = 200;
    let responseBody = null;
    const response = {
        status(code) { statusCode = code; return this; },
        json(data) { responseBody = data; return this; }
    };
    await controller.publish({ params: { id: "10" }, body }, response);
    return { statusCode, body: responseBody };
}

test("pendências enviam MATERIAL manual, retornam nova pendência e permitem retry sem publicação real", async () => {
    const { calls, controller } = createBackend();
    const modal = createModalElement();
    const message = { textContent: "" };
    const fieldsContainer = {
        html: "",
        fields: [],
        set innerHTML(value) { this.html = value; },
        get innerHTML() { return this.html; },
        querySelectorAll() { return this.fields; }
    };
    const continueButton = {};
    const cancelButton = {};
    const elements = {
        modalPublicacaoML: modal,
        publicacaoMLMensagem: message,
        publicacaoMLCampos: fieldsContainer,
        btnContinuarPublicacaoML: continueButton,
        btnCancelarPublicacaoML: cancelButton
    };
    const requests = [];
    const context = {
        document: {
            getElementById(id) { return elements[id] || null; },
            querySelectorAll() { return []; }
        },
        window: {},
        console: { log() {}, error() {} },
        alert() {},
        async carregarProdutos() {},
        async fetch(url, options) {
            const body = JSON.parse(options.body);
            requests.push({ url, body });
            let statusCode = 200;
            let responseBody = {};
            const response = {
                status(code) { statusCode = code; return this; },
                json(data) { responseBody = data; return this; }
            };
            await controller.publish({ params: { id: "10" }, body }, response);
            return {
                ok: statusCode >= 200 && statusCode < 300,
                async json() { return responseBody; }
            };
        }
    };
    const source = fs.readFileSync(path.resolve(__dirname, "../../../public/produtos.js"), "utf8");
    const start = source.indexOf("const modalPublicacaoML =");
    const end = source.indexOf("btnCancelarPublicacaoML.onclick", start);
    assert.ok(start >= 0 && end > start, "publication UI section should exist in produtos.js");
    const uiSection = `${source.slice(start, end)}\nglobalThis.__publicationUI = { publicarML, btnContinuarPublicacaoML };`;
    vm.runInNewContext(uiSection, context, { filename: "public/produtos.js" });

    const ui = context.__publicationUI;
    const firstResult = await ui.publicarML(10);

    assert.equal(firstResult, false);
    assert.equal(requests[0].url, "/api/ml/publish/10");
    assert.deepEqual(requests[0].body.attributeOverrides, {});
    assert.equal(modal.style.display, "flex");
    assert.match(fieldsContainer.innerHTML, /data-attribute-id="MATERIAL"/);

    const materialField = {
        tagName: "INPUT",
        value: "Aço",
        getAttribute(name) { return name === "data-attribute-id" ? "MATERIAL" : null; },
        closest() { return { querySelector() { return { textContent: "Material" }; } }; },
        focus() {}
    };
    fieldsContainer.fields = [materialField];
    await ui.btnContinuarPublicacaoML.onclick();

    assert.equal(requests[1].body.attributeOverrides.MATERIAL.value_name, "Aço");
    assert.deepEqual(
        calls.validationPayloads[0].attributes.filter(item => item.id === "MATERIAL"),
        []
    );
    assert.deepEqual(
        calls.validationPayloads[1].attributes.find(item => item.id === "MATERIAL"),
        { id: "MATERIAL", value_name: "Aço" }
    );
    assert.deepEqual(calls.validationPayloads[0].pictures, []);
    assert.deepEqual(calls.validationPayloads[1].pictures, []);
    assert.equal(fieldsContainer.html.includes('data-attribute-id="GTIN"'), true);
    assert.equal(modal.style.display, "flex");
    assert.equal(calls.publishItem, 0);
    assert.equal(calls.pictureUpload, 0);
    assert.deepEqual(calls.events, ["validate", "validate"]);
});

test("após validação aprovada, envia a imagem uma vez e passa o ID ao limite de criação", async () => {
    const { calls, controller } = createBackend({ validationErrors: [] });
    const result = await callPublishController(controller, {
        attributeOverrides: { MATERIAL: { value_name: "Aço" } }
    });

    assert.equal(result.statusCode, 500); // O mock interrompe antes de qualquer requisição externa.
    assert.equal(calls.validationPayloads.length, 2);
    assert.deepEqual(calls.validationPayloads[0].pictures, []);
    assert.deepEqual(calls.validationPayloads[1].pictures, [{ source: "https://images.invalid/product-10.jpg" }]);
    assert.equal(calls.pictureUpload, 1);
    assert.deepEqual(calls.events, ["validate", "validate", "upload", "publishItem"]);
    assert.equal(calls.uploadInputs[0][0].drive_file_id, "drive-file-10");
    assert.deepEqual(calls.publishPayload.pictures, [{ id: "PIC-10-1" }]);
    assert.equal(calls.publishPayload.pictures.some(picture => picture.source), false);
});

test("após validação aprovada, imagem local é enviada uma vez antes da criação", async () => {
    const { calls, controller } = createBackend({ validationErrors: [], imageKind: "local" });
    const result = await callPublishController(controller, {
        attributeOverrides: { MATERIAL: { value_name: "Aço" } }
    });

    assert.equal(result.statusCode, 500); // O mock interrompe antes de qualquer requisição externa.
    assert.equal(calls.validationPayloads.length, 2);
    assert.equal(calls.pictureUpload, 1);
    assert.deepEqual(calls.uploadInputs[0][0], {
        source: "/storage/originals/product-10.jpg",
        path: "storage/originals/product-10.jpg",
        file_name: "product-10.jpg",
        mime_type: undefined,
        drive_file_id: undefined
    });
    assert.deepEqual(calls.publishPayload.pictures, [{ id: "PIC-10-1" }]);
    assert.deepEqual(calls.events, ["validate", "upload", "validate", "publishItem"]);
});

test("falha no upload bloqueia publishItem", async () => {
    const { calls, controller } = createBackend({
        validationErrors: [],
        uploadError: new Error("simulated Mercado Livre picture upload failure")
    });
    const result = await callPublishController(controller, {
        attributeOverrides: { MATERIAL: { value_name: "Aço" } }
    });

    assert.equal(result.statusCode, 500);
    assert.equal(calls.validationPayloads.length, 2);
    assert.equal(calls.pictureUpload, 1);
    assert.equal(calls.publishItem, 0);
    assert.equal(calls.publishPayload, null);
    assert.deepEqual(calls.events, ["validate", "validate", "upload"]);
});

test("imagem local não é enviada quando a validação condicional retorna MATERIAL pendente", async () => {
    const { calls, controller } = createBackend({ imageKind: "local" });
    const result = await callPublishController(controller, {});

    assert.equal(result.statusCode, 422);
    assert.equal(result.body.code, "ML_MISSING_ATTRIBUTES");
    assert.equal(calls.validationPayloads.length, 1);
    assert.deepEqual(calls.validationPayloads[0].pictures, []);
    assert.equal(calls.pictureUpload, 0);
    assert.equal(calls.publishItem, 0);
    assert.deepEqual(calls.events, ["validate"]);
});

test("preflight local ignora somente erro de imagem ausente e valida o payload completo após upload", async () => {
    const { calls, controller } = createBackend({
        imageKind: "local",
        validationErrors: [missingPicturesValidationError(), null]
    });
    const result = await callPublishController(controller, {
        attributeOverrides: { MATERIAL: { value_name: "Aço" } }
    });

    assert.equal(result.statusCode, 500); // O mock interrompe antes da publicação externa.
    assert.equal(calls.pictureUpload, 1);
    assert.deepEqual(calls.events, ["validate", "upload", "validate", "publishItem"]);
    assert.deepEqual(calls.publishPayload.pictures, [{ id: "PIC-10-1" }]);
});

test("falha desconhecida no preflight interrompe o fluxo antes do upload", async () => {
    const { calls, controller } = createBackend({
        imageKind: "local",
        validationErrors: [new Error("simulated validation service outage")]
    });
    const result = await callPublishController(controller, {});

    assert.equal(result.statusCode, 500);
    assert.deepEqual(calls.events, ["validate"]);
    assert.equal(calls.pictureUpload, 0);
    assert.equal(calls.publishItem, 0);
});
