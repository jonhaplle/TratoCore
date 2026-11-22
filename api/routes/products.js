const express = require("express");
const router = express.Router();

const controller = require("../controllers/productsController");

// Autorização para operações de ESCRITA.
//
// Reutiliza o mesmo middleware que já protege a publicação de anúncios:
// compara TRATO_VENDEDOR_ADMIN_KEY no servidor com timingSafeEqual, falha
// fechado (503) quando a variável não está configurada e nunca devolve a
// chave em resposta ou log.
const requireAdminKey = require("../middleware/publishKeyAuth");

// ------------------------------------------------------------------
// LEITURA — permanece pública (o catálogo é consultado pelo frontend
// e por telas que não têm a chave administrativa).
// ------------------------------------------------------------------

router.get("/", controller.getAll);

router.get("/:id", controller.getById);

// ------------------------------------------------------------------
// ESCRITA — exige a chave administrativa.
//
// DELETE em especial: antes desta proteção qualquer cliente com acesso
// à internet podia apagar produtos.
// ------------------------------------------------------------------

router.post("/", requireAdminKey, controller.create);

router.put("/:id", requireAdminKey, controller.update);

router.delete("/:id", requireAdminKey, controller.remove);

router.post("/:id/improve-ai", requireAdminKey, controller.improveWithAI);

router.post("/:id/prepare-listing", requireAdminKey, controller.prepareListing);

module.exports = router;
