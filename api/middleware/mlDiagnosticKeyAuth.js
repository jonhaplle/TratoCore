const crypto = require("crypto");

const HEADER_NAME = "x-ml-diagnostic-key";
const MIN_KEY_BYTES = 32;

function matchesDiagnosticKey(candidate, expected) {
    if (typeof candidate !== "string" || typeof expected !== "string") return false;
    if (Buffer.byteLength(expected, "utf8") < MIN_KEY_BYTES) return false;
    if (!candidate || Buffer.byteLength(candidate, "utf8") > 4096) return false;

    const candidateDigest = crypto.createHash("sha256").update(candidate, "utf8").digest();
    const expectedDigest = crypto.createHash("sha256").update(expected, "utf8").digest();
    return crypto.timingSafeEqual(candidateDigest, expectedDigest);
}

module.exports = function requireMlDiagnosticKey(req, res, next) {
    res.set("Cache-Control", "no-store");

    const expected = process.env.ML_DIAGNOSTIC_KEY;
    const supplied = req.get(HEADER_NAME);

    if (!matchesDiagnosticKey(supplied, expected)) {
        return res.status(404).json({ success: false, error: "Not found." });
    }

    return next();
};

module.exports.matchesDiagnosticKey = matchesDiagnosticKey;
