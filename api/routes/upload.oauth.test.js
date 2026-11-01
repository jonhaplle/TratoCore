const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const fs = require("fs");
const os = require("os");
const path = require("path");
const uploadRouter = require("./upload");

const tinyPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/FZkAAAAASUVORK5CYII=", "base64");

async function withServer(router, run) {
    const app = express();
    app.use("/api/upload", router);
    const server = app.listen(0, "127.0.0.1");
    await new Promise(resolve => server.once("listening", resolve));
    try { await run(`http://127.0.0.1:${server.address().port}`); }
    finally { await new Promise(resolve => server.close(resolve)); }
}

test("upload route returns proxy URL only after OAuth Drive confirms a persistent file", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tratocore-upload-test-"));
    const uploads = [];
    const router = uploadRouter.createUploadRouter({
        storageRoot: root,
        renderRuntime: true,
        googleDriveOAuthService: {
            async uploadFile(filePath, name, mimeType) {
                uploads.push({ exists: fs.existsSync(filePath), name, mimeType });
                return { id: "confirmed-drive-id", folder_id: "products-folder", reused_existing: false };
            },
            async deleteFile() {}
        }
    });
    try {
        await withServer(router, async base => {
            const form = new FormData();
            form.append("imagem", new Blob([tinyPng], { type: "image/png" }), "tiny.png");
            const response = await fetch(`${base}/api/upload`, { method: "POST", body: form });
            const body = await response.json();
            assert.equal(response.status, 200);
            assert.equal(body.arquivo.drive_file_id, "confirmed-drive-id");
            assert.equal(body.arquivo.originalUrl, "/api/product-images/drive/confirmed-drive-id");
            assert.deepEqual(uploads, [{ exists: true, name: `${path.parse(body.arquivo.fileName).name}.png`, mimeType: "image/png" }]);
            assert.equal(fs.readdirSync(path.join(root, "originals")).length, 0);
        });
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("Drive failure blocks Render upload and hides provider error details", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tratocore-upload-fail-"));
    const router = uploadRouter.createUploadRouter({
        storageRoot: root,
        renderRuntime: true,
        googleDriveOAuthService: {
            async uploadFile() { throw new Error("refresh_token=secret"); },
            async deleteFile() {}
        }
    });
    try {
        await withServer(router, async base => {
            const form = new FormData();
            form.append("imagem", new Blob([tinyPng], { type: "image/png" }), "tiny.png");
            const response = await fetch(`${base}/api/upload`, { method: "POST", body: form });
            const text = await response.text();
            assert.equal(response.status, 503);
            assert.equal(text.includes("secret"), false);
            assert.equal(fs.readdirSync(path.join(root, "temp")).length, 0);
        });
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
