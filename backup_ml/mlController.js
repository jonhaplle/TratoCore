const publishService = require("../services/ml/publish.service");
const oauthService = require("../services/ml/oauth.service");
const api = require("../services/ml/api.service");

exports.login = (req,res)=>{
    res.redirect(oauthService.getLoginUrl());
};

exports.callback = async(req,res)=>{
    try{
        res.json(await oauthService.callback(req));
    }catch(err){
        res.status(500).json({
            success:false,
            error:err.message
        });
    }
};

exports.me = async(req,res)=>{
    try{
        res.json(await api.getMe());
    }catch(err){
        res.status(500).json({
            success:false,
            error:err.response?.data || err.message
        });
    }
};

exports.publish = async(req,res)=>{
    try{
        res.json(await publishService.publish(req.params.id));
    }catch(err){
        res.status(500).json({
            success:false,
            error:err.message
        });
    }
};

exports.getItem=(req,res)=>res.json({ok:true});
exports.update=(req,res)=>res.json({ok:true});
exports.pause=(req,res)=>res.json({ok:true});
exports.activate=(req,res)=>res.json({ok:true});
