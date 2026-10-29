const test = require("node:test");
const assert = require("node:assert/strict");
const requireKey = require("./mlDiagnosticKeyAuth");
const { matchesDiagnosticKey } = requireKey;

test("diagnostic key accepts an exact configured key with sufficient entropy length", () => {
    const key = "a-secure-diagnostic-key-that-is-at-least-32-chars";
    assert.equal(matchesDiagnosticKey(key, key), true);
});

test("diagnostic key rejects missing, short, or incorrect keys", () => {
    assert.equal(matchesDiagnosticKey(undefined, "a-secure-diagnostic-key-that-is-at-least-32-chars"), false);
    assert.equal(matchesDiagnosticKey("short", "short"), false);
    assert.equal(matchesDiagnosticKey("different-secure-diagnostic-key-value", "a-secure-diagnostic-key-that-is-at-least-32-chars"), false);
});

test("diagnostic middleware hides the route when key is missing or incorrect", () => {
    const previous = process.env.ML_DIAGNOSTIC_KEY;
    process.env.ML_DIAGNOSTIC_KEY = "a-secure-diagnostic-key-that-is-at-least-32-chars";

    for (const supplied of [undefined, "incorrect-key-value-that-is-long-enough-123"]) {
        const state = { next: false, status: 200, payload: null, headers: {} };
        const req = { get: () => supplied };
        const res = {
            set(name, value) { state.headers[name] = value; return this; },
            status(code) { state.status = code; return this; },
            json(payload) { state.payload = payload; return this; }
        };

        requireKey(req, res, () => { state.next = true; });
        assert.equal(state.status, 404);
        assert.equal(state.next, false);
        assert.equal(state.headers["Cache-Control"], "no-store");
        assert.equal(state.payload.error, "Not found.");
    }

    if (previous === undefined) delete process.env.ML_DIAGNOSTIC_KEY;
    else process.env.ML_DIAGNOSTIC_KEY = previous;
});

test("diagnostic middleware permits only a matching configured key", () => {
    const previous = process.env.ML_DIAGNOSTIC_KEY;
    const key = "a-secure-diagnostic-key-that-is-at-least-32-chars";
    process.env.ML_DIAGNOSTIC_KEY = key;
    let nextCalled = false;
    const req = { get: () => key };
    const res = { set() { return this; }, status() { return this; }, json() { return this; } };

    requireKey(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, true);

    if (previous === undefined) delete process.env.ML_DIAGNOSTIC_KEY;
    else process.env.ML_DIAGNOSTIC_KEY = previous;
});
