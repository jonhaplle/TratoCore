const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { createGoogleDriveOAuthRouter, STATE_COOKIE } = require("./googleDriveOAuth");

async function withServer(service, run) {
    const app = express();
    app.use(express.json());
    app.use("/oauth", createGoogleDriveOAuthRouter({
        service,
        env: { GOOGLE_OAUTH_ADMIN_KEY: "test-admin-key" },
        logger: { error() {} }
    }));
    const server = app.listen(0, "127.0.0.1");
    await new Promise(resolve => server.once("listening", resolve));
    try { await run(`http://127.0.0.1:${server.address().port}`); }
    finally { await new Promise(resolve => server.close(resolve)); }
}

test("OAuth initiation is protected and binds random state to secure HttpOnly cookie", async () => {
    const service = { authorizationUrl: state => `https://accounts.google.test/?state=${state}` };
    await withServer(service, async base => {
        const denied = await fetch(`${base}/oauth/start`, { method: "POST" });
        assert.equal(denied.status, 401);
        const response = await fetch(`${base}/oauth/start`, {
            method: "POST", headers: { Authorization: "Bearer test-admin-key" }
        });
        assert.equal(response.status, 200);
        const cookie = response.headers.get("set-cookie");
        assert.match(cookie, /HttpOnly/i);
        assert.match(cookie, /Secure/i);
        assert.match(cookie, /SameSite=Lax/i);
        const body = await response.json();
        assert.match(body.authorization_url, /state=/);
    });
});

test("callback rejects CSRF state mismatch and accepts matching state without exposing tokens", async () => {
    let completed = 0;
    const service = { async completeAuthorization() { completed++; } };
    await withServer(service, async base => {
        const bad = await fetch(`${base}/oauth/callback?code=secret&state=wrong`, { redirect: "manual", headers: { Cookie: `${STATE_COOKIE}=expected` } });
        assert.equal(bad.status, 303);
        assert.equal(completed, 0);
        const good = await fetch(`${base}/oauth/callback?code=one-time-code&state=expected`, { redirect: "manual", headers: { Cookie: `${STATE_COOKIE}=expected` } });
        assert.equal(good.status, 303);
        assert.equal(completed, 1);
        assert.match(good.headers.get("location"), /oauth=connected/);
    });
});

test("authorization failures use safe response and do not return upstream errors", async () => {
    const service = { authorizationUrl() { throw new Error("client_secret=must-not-leak"); } };
    await withServer(service, async base => {
        const response = await fetch(`${base}/oauth/start`, { method: "POST", headers: { Authorization: "Bearer test-admin-key" } });
        const text = await response.text();
        assert.equal(response.status, 503);
        assert.equal(text.includes("must-not-leak"), false);
    });
});
