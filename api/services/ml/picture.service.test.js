const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const path = require("node:path");
const { Readable } = require("node:stream");

function loadPictureService({ oauthError = null, legacyError = null } = {}) {
    const calls = { oauth: 0, legacy: 0, post: 0, postedStream: null };
    const picturePath = require.resolve("./picture.service");
    const originalLoad = Module._load;

    class MockFormData {
        append(name, stream, options) {
            calls.postedStream = stream;
            calls.formOptions = { name, ...options };
        }
        getHeaders() { return { "content-type": "multipart/form-data; boundary=test" }; }
    }

    Module._load = function (request, parent, isMain) {
        if (parent?.filename === picturePath) {
            if (request === "./api.service") return { async getAccessToken() { return "ml-token"; } };
            if (request === "axios") return {
                async post(url, form, options) {
                    calls.post += 1;
                    calls.postUrl = url;
                    calls.postOptions = options;
                    return { data: { id: "ML-PICTURE-123" } };
                }
            };
            if (request === "form-data") return MockFormData;
            if (request === "../googleDriveOAuthService") return {
                createGoogleDriveOAuthService() {
                    return {
                        async getFileStream(fileId) {
                            calls.oauth += 1;
                            calls.oauthFileId = fileId;
                            if (oauthError) throw oauthError;
                            return Readable.from(["image-bytes"]);
                        }
                    };
                }
            };
            if (request === "../googleDriveService") return {
                async getFileStream(fileId) {
                    calls.legacy += 1;
                    calls.legacyFileId = fileId;
                    if (legacyError) throw legacyError;
                    return Readable.from(["legacy-image-bytes"]);
                }
            };
        }
        return originalLoad.call(this, request, parent, isMain);
    };

    delete require.cache[picturePath];
    try {
        const service = originalLoad(picturePath, module, false);
        return { service, calls, restore() {
            Module._load = originalLoad;
            delete require.cache[picturePath];
        } };
    } finally {
        Module._load = originalLoad;
    }
}

test("PictureUpload usa Google Drive OAuth como primeira opção", async () => {
    const { service, calls, restore } = loadPictureService();
    try {
        const result = await service.upload([{
            drive_file_id: "drive-file-123",
            file_name: "produto.jpg",
            mime_type: "image/jpeg"
        }]);
        assert.deepEqual(result, [{ id: "ML-PICTURE-123" }]);
        assert.equal(calls.oauth, 1);
        assert.equal(calls.legacy, 0);
        assert.equal(calls.post, 1);
        assert.equal(calls.oauthFileId, "drive-file-123");
        assert.equal(calls.postUrl, "https://api.mercadolibre.com/pictures/items/upload");
    } finally {
        restore();
    }
});

test("PictureUpload recorre ao serviço legado quando OAuth não consegue ler a foto", async () => {
    const { service, calls, restore } = loadPictureService({
        oauthError: new Error("OAuth sem autorização")
    });
    try {
        const result = await service.upload([{ drive_file_id: "drive-file-456" }]);
        assert.deepEqual(result, [{ id: "ML-PICTURE-123" }]);
        assert.equal(calls.oauth, 1);
        assert.equal(calls.legacy, 1);
        assert.equal(calls.legacyFileId, "drive-file-456");
        assert.equal(calls.post, 1);
    } finally {
        restore();
    }
});

test("PictureUpload interrompe antes do envio ao ML se os dois leitores do Drive falharem", async () => {
    const { service, calls, restore } = loadPictureService({
        oauthError: new Error("OAuth falhou"),
        legacyError: new Error("Service Account falhou")
    });
    try {
        await assert.rejects(
            service.upload([{ drive_file_id: "drive-file-789" }]),
            /Não foi possível baixar a imagem drive-file-789 do Google Drive/
        );
        assert.equal(calls.oauth, 1);
        assert.equal(calls.legacy, 1);
        assert.equal(calls.post, 0);
    } finally {
        restore();
    }
});
