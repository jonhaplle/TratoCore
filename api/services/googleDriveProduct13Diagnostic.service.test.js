const test = require("node:test");
const assert = require("node:assert/strict");
const { createGoogleDriveProduct13Diagnostic } = require("./googleDriveProduct13Diagnostic.service");

const ROOT_ID = "photos-root-id";
const FOLDER_ID = "rings-folder-id";

function createDriveFixture({ rootPages, folderPages = {}, rootName = "FOTOS" } = {}) {
    const calls = { get: [], list: [], writes: 0 };
    const drive = {
        files: {
            async get(params, options) {
                calls.get.push({ params, options });
                return { data: { id: ROOT_ID, name: rootName, mimeType: "application/vnd.google-apps.folder" } };
            },
            async list(params, options) {
                calls.list.push({ params, options });
                const pages = params.q.includes(FOLDER_ID) ? folderPages : rootPages;
                const page = pages?.[params.pageToken || "first"] || { files: [] };
                return { data: page };
            },
            async create() { calls.writes++; throw new Error("write must never be called"); },
            async update() { calls.writes++; throw new Error("write must never be called"); },
            async delete() { calls.writes++; throw new Error("write must never be called"); }
        }
    };
    return {
        calls,
        service: {
            getDriveClient() { return drive; }
        }
    };
}

test("recursively finds UUID and jewelry-name image candidates with preview metadata", async () => {
    const fixture = createDriveFixture({
        rootPages: {
            first: {
                nextPageToken: "root-page-2",
                files: [
                    { id: FOLDER_ID, name: "Aliança de Prata", mimeType: "application/vnd.google-apps.folder" }
                ]
            },
            "root-page-2": {
                files: [
                    { id: "image-exact", name: "a2e3cc52-3542-41e7-9106-565182a8d855.jpeg", mimeType: "image/jpeg", size: "110053", modifiedTime: "2026-09-01T10:00:00Z", webViewLink: "https://drive.google.com/file/d/image-exact/view", imageMediaMetadata: { width: 900, height: 1600 } },
                    { id: "image-main", name: "4799f28e-6966-46a9-af94-5f3f1d4b098b.jpeg", mimeType: "image/jpeg", size: "74956" },
                    { id: "image-third", name: "a827ac72-f8e3-4632-9831-6632549faecb.jpeg", mimeType: "image/jpeg", size: "151808" },
                    { id: "not-image", name: "Anel.txt", mimeType: "text/plain" }
                ]
            }
        },
        folderPages: {
            first: {
                files: [
                    { id: "image-keyword", name: "IMG_001.jpg", mimeType: "image/jpeg", size: "120000", webViewLink: "https://drive.google.com/file/d/image-keyword/view" }
                ]
            }
        }
    });
    const search = createGoogleDriveProduct13Diagnostic({
        driveService: fixture.service,
        getRootFolderId: () => ROOT_ID,
        maxResults: 3
    });

    const result = await search();

    assert.equal(result.success, true);
    assert.equal(result.candidateCount, 4);
    assert.equal(result.candidates.length, 3);
    assert.equal(result.candidates[0].matchType, "uuid");
    assert.deepEqual(
        result.candidates.map(candidate => candidate.name).sort(),
        [
            "4799f28e-6966-46a9-af94-5f3f1d4b098b.jpeg",
            "a2e3cc52-3542-41e7-9106-565182a8d855.jpeg",
            "a827ac72-f8e3-4632-9831-6632549faecb.jpeg"
        ].sort()
    );
    const exactCandidate = result.candidates.find(candidate => candidate.name.startsWith("a2e3cc52"));
    assert.equal(exactCandidate.width, 900);
    assert.equal(exactCandidate.previewUrl, "https://drive.google.com/file/d/image-exact/view");
    assert.equal(fixture.calls.list.length, 3);
    assert.equal(fixture.calls.writes, 0);
    assert.ok(fixture.calls.list.every(call => call.params.pageSize <= 1000));
    assert.ok(fixture.calls.list.every(call => call.options.timeout > 0));
});

test("returns partial results when a Drive page request times out", async () => {
    const calls = { writes: 0 };
    const search = createGoogleDriveProduct13Diagnostic({
        driveService: {
            getDriveClient() {
                return {
                    files: {
                        async get() {
                            return { data: { id: ROOT_ID, name: "FOTOS", mimeType: "application/vnd.google-apps.folder" } };
                        },
                        async list() {
                            const error = new Error("timeout");
                            error.code = "ETIMEDOUT";
                            throw error;
                        },
                        async create() { calls.writes++; },
                        async delete() { calls.writes++; }
                    }
                };
            }
        },
        getRootFolderId: () => ROOT_ID
    });

    const result = await search();
    assert.equal(result.success, true);
    assert.equal(result.truncated, true);
    assert.equal(result.truncatedReason, "request_timeout");
    assert.equal(calls.writes, 0);
});

test("rejects a root folder that is not FOTOS", async () => {
    const fixture = createDriveFixture({ rootPages: {}, rootName: "OTHER" });
    const search = createGoogleDriveProduct13Diagnostic({
        driveService: fixture.service,
        getRootFolderId: () => ROOT_ID
    });

    await assert.rejects(search(), error => error.code === "DRIVE_ROOT_INVALID");
    assert.equal(fixture.calls.list.length, 0);
});

test("stops at configured folder limit and marks partial results", async () => {
    const fixture = createDriveFixture({
        rootPages: {
            first: { files: [{ id: FOLDER_ID, name: "Joias", mimeType: "application/vnd.google-apps.folder" }] }
        }
    });
    const search = createGoogleDriveProduct13Diagnostic({
        driveService: fixture.service,
        getRootFolderId: () => ROOT_ID,
        maxFolders: 1
    });

    const result = await search();
    assert.equal(result.truncated, true);
    assert.equal(result.truncatedReason, "folder_limit");
    assert.equal(result.foldersScanned, 1);
});

test("rejects a missing root folder id without making Drive calls", async () => {
    const fixture = createDriveFixture({ rootPages: {} });
    const search = createGoogleDriveProduct13Diagnostic({
        driveService: fixture.service,
        getRootFolderId: () => ""
    });

    await assert.rejects(search(), error => error.code === "DRIVE_ROOT_NOT_CONFIGURED");
    assert.equal(fixture.calls.get.length, 0);
    assert.equal(fixture.calls.list.length, 0);
});

test("the mounted product 13 route requires the diagnostic header before searching", async () => {
    const routeFile = require.resolve("../routes/ml");
    const mockModules = new Map();
    const addMock = (relativePath, exports) => {
        const file = require.resolve(relativePath);
        mockModules.set(file, require.cache[file]);
        require.cache[file] = { id: file, filename: file, loaded: true, exports };
    };
    let searchCalls = 0;
    const restore = () => {
        delete require.cache[routeFile];
        for (const [file, previous] of mockModules) {
            if (previous) require.cache[file] = previous;
            else delete require.cache[file];
        }
    };

    addMock("../controllers/mlController", { login() {}, callback() {}, me() {}, publish() {} });
    addMock("../services/ml/api.service", {});
    addMock("../services/productService", {});
    addMock("../services/ml/publicationDiagnostic.service", {
        createPublicationDiagnostic: () => async () => ({ success: true })
    });
    addMock("../services/googleDriveService", {});
    addMock("./googleDriveProduct13Diagnostic.service", {
        createGoogleDriveProduct13Diagnostic: () => async () => {
            searchCalls++;
            return { success: true, candidates: [] };
        }
    });

    const previousKey = process.env.ML_DIAGNOSTIC_KEY;
    const key = "test-only-diagnostic-key-longer-than-thirty-two-bytes";
    process.env.ML_DIAGNOSTIC_KEY = key;

    try {
        const router = require("../routes/ml");
        const routeLayer = router.stack.find(layer =>
            layer.route?.path === "/diagnostics/drive/product-13" && layer.route.methods.get
        );
        assert.ok(routeLayer);
        assert.equal(routeLayer.route.stack.length, 2);

        const makeResponse = () => ({
            statusCode: 200,
            headers: {},
            body: null,
            set(name, value) { this.headers[name] = value; return this; },
            status(code) { this.statusCode = code; return this; },
            json(body) { this.body = body; return this; }
        });

        const middleware = routeLayer.route.stack[0].handle;
        const handler = routeLayer.route.stack[1].handle;
        const deniedResponse = makeResponse();
        middleware({ get: () => undefined }, deniedResponse, () => assert.fail("missing key passed auth"));
        assert.equal(deniedResponse.statusCode, 404);
        assert.equal(searchCalls, 0);

        const allowedResponse = makeResponse();
        let authorized = false;
        middleware({ get: () => key }, allowedResponse, () => { authorized = true; });
        assert.equal(authorized, true);
        await handler({}, allowedResponse);
        assert.equal(allowedResponse.statusCode, 200);
        assert.equal(allowedResponse.headers["Cache-Control"], "no-store");
        assert.equal(searchCalls, 1);
    } finally {
        if (previousKey === undefined) delete process.env.ML_DIAGNOSTIC_KEY;
        else process.env.ML_DIAGNOSTIC_KEY = previousKey;
        restore();
    }
});
