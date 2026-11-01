const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { PassThrough } = require("stream");
const productImages = require("./productImages");

async function request(router, callback) {
    const app = express();
    app.use("/api/product-images", router);
    const server = app.listen(0, "127.0.0.1");
    await new Promise(resolve => server.once("listening", resolve));
    try { await callback(`http://127.0.0.1:${server.address().port}`); }
    finally { await new Promise(resolve => server.close(resolve)); }
}

test("proxy opens new OAuth-owned Drive images", async () => {
    let legacyCalled = false;
    const oauth = {
        async getFileMetadata(id) { return { id, mimeType: "image/png" }; },
        async getFileStream() { const stream = new PassThrough(); stream.end(Buffer.from("new-image")); return stream; }
    };
    const router = productImages.createProductImagesRouter({
        oauthService: oauth,
        legacyDrive: {
            getDriveClient() { legacyCalled = true; throw new Error("legacy not expected"); },
            getFileStream() { legacyCalled = true; throw new Error("legacy not expected"); }
        }
    });
    await request(router, async base => {
        const response = await fetch(`${base}/api/product-images/drive/new-file-id`);
        assert.equal(response.status, 200);
        assert.equal(response.headers.get("content-type"), "image/png");
        assert.equal(await response.text(), "new-image");
        assert.equal(legacyCalled, false);
    });
});

test("proxy falls back to Service Account for historical images", async () => {
    const oauth = {
        async getFileMetadata() { throw new Error("not visible to drive.file app"); },
        async getFileStream() { throw new Error("not visible to drive.file app"); }
    };
    const legacyDrive = {
        getDriveClient() { return { files: { async get() { return { data: { mimeType: "image/jpeg" } }; } } }; },
        async getFileStream() { const stream = new PassThrough(); stream.end(Buffer.from("old-image")); return stream; }
    };
    const router = productImages.createProductImagesRouter({ oauthService: oauth, legacyDrive });
    await request(router, async base => {
        const response = await fetch(`${base}/api/product-images/drive/old-file-id`);
        assert.equal(response.status, 200);
        assert.equal(response.headers.get("content-type"), "image/jpeg");
        assert.equal(await response.text(), "old-image");
    });
});
