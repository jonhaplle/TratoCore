const express = require("express");
const router = express.Router();

const controller = require("../controllers/mlController");

router.get("/login", controller.login);
router.get("/callback", controller.callback);

router.post("/publish/:id", controller.publish);

module.exports = router;