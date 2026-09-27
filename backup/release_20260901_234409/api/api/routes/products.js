const express = require("express");
const router = express.Router();

const controller = require("../controllers/productsController");

router.get("/", controller.getAll);

router.get("/:id", controller.getById);

router.post("/", controller.create);

router.put("/:id", controller.update);

router.delete("/:id", controller.remove);

router.post("/:id/improve-ai", controller.improveWithAI);

module.exports = router;