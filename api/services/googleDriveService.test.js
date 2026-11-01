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
            fields: "id,name,mimeType,capabilities(canAddChildren)"
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
