const test = require("node:test");
const assert = require("node:assert/strict");
const drive = require("./googleDriveService");

test("legacy Service Account path cannot write to My Drive", async () => {
    await assert.rejects(drive.uploadFile("unused", "unused", "image/jpeg", "unused"), /Service Account uploads are disabled/);
    await assert.rejects(drive.findOrCreateFolder("unused"), /Service Account folder creation is disabled/);
});
