const publishService = require("../services/ml/publish.service");
const oauthService = require("../services/ml/oauth.service");

exports.login = (req, res) => {
    res.redirect(oauthService.getLoginUrl());
};

exports.callback = async (req, res) => {
    try {
        const result = await oauthService.callback(req);
        res.json(result);
    } catch (err) {
        res.status(500).json({
            success: false,
            error: err.message
        });
    }
};

exports.publish = async (req, res) => {
    try {
        const result = await publishService.publish(req.params.id);
        res.json(result);
    } catch (err) {
        res.status(500).json({
            success: false,
            error: err.message
        });
    }
};

exports.getItem = async (req, res) => {
    res.json({ ok: true });
};

exports.update = async (req, res) => {
    res.json({ ok: true });
};

exports.pause = async (req, res) => {
    res.json({ ok: true });
};

exports.activate = async (req, res) => {
    res.json({ ok: true });
};