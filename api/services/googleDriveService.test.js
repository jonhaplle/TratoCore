const test = require("node:test");
const assert = require("node:assert/strict");

const googleDriveService = require("./googleDriveService");

test("testConnection requests exact folder metadata and returns canAddChildren=true without writing", async () => {
    const calls = [];
    const drive = {
        files: {
            get: async options => {
                calls.push({ method: "get", options });
                return {
                    data: {
                        id: "fotos-folder",
                        name: "FOTOS",
                        mimeType: "application/vnd.google-apps.folder",
                        capabilities: { canAddChildren: true }
                    }
                };
            },
            create: async () => {
                calls.push({ method: "create" });
                throw new Error("Unexpected write");
            }
        }
    };

    const folder = await googleDriveService.testConnection(drive, "fotos-folder");

    assert.deepEqual(calls, [{
        method: "get",
        options: {
            fileId: "fotos-folder",
            fields: "id,name,mimeType,driveId,capabilities(canAddChildren)",
            supportsAllDrives: true
        }
    }]);
    assert.equal(folder.name, "FOTOS");
    assert.equal(folder.capabilities.canAddChildren, true);
});

for (const value of [false, null]) {
    test(`testConnection returns canAddChildren=${value}`, async () => {
        const drive = {
            files: {
                get: async () => ({
                    data: {
                        id: "fotos-folder",
                        name: "FOTOS",
                        capabilities: { canAddChildren: value }
                    }
                })
            }
        };

        const folder = await googleDriveService.testConnection(drive, "fotos-folder");

        assert.equal(folder.capabilities.canAddChildren, value);
    });
}

test("testConnection propagates a simulated permission error", async () => {
    const permissionError = new Error("403 permissionDenied; token=secret-value");
    const drive = {
        files: {
            get: async () => { throw permissionError; }
        }
    };
    await assert.rejects(
        googleDriveService.testConnection(drive, "fotos-folder"),
        error => error === permissionError
    );
});

test("findExistingFolder searches without creating and supports shared drives", async () => {
    const calls = [];
    const drive = {
        files: {
            list: async options => {
                calls.push(options);
                return { data: { files: [{ id: "products-folder", name: "Produtos" }] } };
            },
            create: async () => { throw new Error("Unexpected folder creation"); }
        }
    };

    const folder = await googleDriveService.findExistingFolder(
        "Produtos", "fotos-folder", "shared-drive", drive
    );

    assert.equal(folder.id, "products-folder");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].supportsAllDrives, true);
    assert.equal(calls[0].includeItemsFromAllDrives, true);
    assert.equal(calls[0].corpora, "drive");
    assert.equal(calls[0].driveId, "shared-drive");
});
