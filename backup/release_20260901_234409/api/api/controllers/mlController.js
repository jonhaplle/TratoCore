const publishService = require("../services/ml/publish.service");
const oauthService = require("../services/ml/oauth.service");
const api = require("../services/ml/api.service");

exports.login = (req, res) => {

    res.redirect(oauthService.getLoginUrl());

};

exports.callback = async (req, res) => {

    try {

        const result = await oauthService.callback(req);

        res.json(result);

    } catch (err) {

        console.error("====================================");
        console.error("ERRO CALLBACK OAUTH");
        console.error("====================================");

        console.error(err.response?.data || err);

        res.status(500).json({
            success: false,
            error: err.response?.data || err.message
        });

    }

};

exports.me = async (req, res) => {

    try {

        const me = await api.getMe();

        res.json(me);

    } catch (err) {

        console.error("====================================");
        console.error("ERRO CONSULTA USUÁRIO");
        console.error("====================================");

        console.error(err.response?.data || err);

        res.status(500).json({
            success: false,
            error: err.response?.data || err.message
        });

    }

};

exports.publish = async (req, res) => {

    try {

        console.log("====================================");
        console.log("PUBLICAÇÃO SOLICITADA");
        console.log("Produto:", req.params.id);
        console.log("====================================");

        const result = await publishService.publish(
            req.params.id,
            req.body?.attributeOverrides || {}
        );

        res.json(result);

    } catch (err) {

        console.error("====================================");
        console.error("ERRO PUBLICAÇÃO");
        console.error("====================================");

        if (err.code === "ML_MISSING_ATTRIBUTES") {
            return res.status(422).json({
                success: false,
                code: err.code,
                message: err.message,
                needs_input: true,
                missing: err.missing || [],
                stage: err.publishStage || null
            });
        }

        if (err.response) {

            console.log("HTTP:", err.response.status);

            console.dir(err.response.data, {
                depth: null
            });

            return res.status(err.response.status).json({
                success: false,
                error: err.response.data,
                stage: err.publishStage || null,
                http: err.response.status
            });

        }

        console.error(err.stack || err.message);

        return res.status(500).json({
            success: false,
            error: err.message,
            stage: err.publishStage || null,
            http: 500
        });

    }

};

exports.getItem = (req, res) => {

    res.json({
        ok: true
    });

};

exports.update = (req, res) => {

    res.json({
        ok: true
    });

};

exports.pause = (req, res) => {

    res.json({
        ok: true
    });

};

exports.activate = (req, res) => {

    res.json({
        ok: true
    });

};