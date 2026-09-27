const express = require("express");
const router = express.Router();
const browser = require("../../browser-engine");

router.get("/status", async (req, res) => {
    try {
        res.json({ success: true, ...await browser.status() });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post("/open", async (req, res) => {
    try {
        const url = String(req.body?.url || "").trim();
        if (!url) return res.status(400).json({ success: false, error: "Informe a URL." });
        const page = await browser.open(url);
        res.json({ success: true, page });
    } catch (error) {
        console.error("[BROWSER] open:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post("/fill", async (req, res) => {
    try {
        const selector = String(req.body?.selector || "").trim();
        const value = req.body?.value ?? "";
        res.json({ success: true, data: await browser.fill(selector, value) });
    } catch (error) {
        console.error("[BROWSER] fill:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post("/click", async (req, res) => {
    try {
        const selector = String(req.body?.selector || "").trim();
        res.json({ success: true, data: await browser.click(selector) });
    } catch (error) {
        console.error("[BROWSER] click:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get("/inspect", async (req, res) => {
    try {
        res.json({ success: true, data: await browser.inspect() });
    } catch (error) {
        console.error("[BROWSER] inspect:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post("/screenshot", async (req, res) => {
    try {
        const result = await browser.screenshot();
        const relative = "/storage/browser/screenshots/" + encodeURIComponent(result.fileName);
        res.json({ success: true, screenshot: { ...result, url: relative } });
    } catch (error) {
        console.error("[BROWSER] screenshot:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post("/close", async (req, res) => {
    try {
        res.json({ success: true, ...(await browser.close()) });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
