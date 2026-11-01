const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const createDriveStatusRouter = require("./driveStatus");

async function requestStatus(result) {
    const logged = [];
    const service = {
        testConnection: async () => {
            if (result instanceof Error) throw result;
            return {
                id: "fotos-folder",
                name: "FOTOS",
                mimeType: "application/vnd.google-apps.folder",
                capabilities: { canAddChildren: result }
            };
        }
    };
    const app = express();
    app.use("/api/drive/status", createDriveStatusRouter(service, {
        error: (...args) => logged.push(args.join(" "))
    }));
    const server = app.listen(0, "127.0.0.1");

    try {
        await new Promise((resolve, reject) => {
            server.once("listening", resolve);
            server.once("error", reject);
        });
        const address = server.address();
        const response = await fetch(`http://127.0.0.1:${address.port}/api/drive/status`);
        return {
            status: response.status,
            body: await response.json(),
            logged: logged.join(" ")
        };
    } finally {
        await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
}

for (const value of [true, false, null]) {
    test(`GET /api/drive/status returns canAddChildren=${value}`, async () => {
        const result = await requestStatus(value);
        assert.equal(result.status, 200);
        assert.equal(result.body.read, true);
        assert.equal(result.body.canAddChildren, value);
        assert.equal(result.body.drive, "online");
    });
}

test("GET /api/drive/status sanitizes a 403 permission error", async () => {
    const result = await requestStatus(new Error("403 permissionDenied token=secret-value"));
    const serialized = JSON.stringify({ body: result.body, logged: result.logged });

    assert.equal(result.status, 500);
    assert.deepEqual(result.body, {
        success: false,
        drive: "offline",
        erro: "Falha ao consultar a pasta do Google Drive."
    });
    assert.equal(serialized.includes("secret-value"), false);
    assert.equal(serialized.includes("permissionDenied"), false);
    assert.equal(serialized.includes("token="), false);
});
