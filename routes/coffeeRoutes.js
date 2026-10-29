const express = require("express");
const coffeeController = require("../controllers/coffeeController");
const { authenticate, requireAdmin } = require("../middleware/authenticate");
const menuController = require("../controllers/menuController");
const { validateRequest } = require("../middleware/validateRequest");
const schemas = require("../schemas/requestSchemas");
const { quoteLimiter, savedWriteLimiter, menuPriceLimiter } = require("../middleware/rateLimiters");

const router = express.Router();

router.post("/quote", quoteLimiter, validateRequest(schemas.quote), coffeeController.createQuote);
router.get("/menu", quoteLimiter, validateRequest(schemas.empty), menuController.listPublicMenu);
router.get("/admin/menu", menuPriceLimiter, validateRequest(schemas.empty), authenticate, requireAdmin, menuController.listAdminMenu);
router.patch("/admin/menu/prices/:priceKey", menuPriceLimiter, validateRequest(schemas.menuPrice), authenticate, requireAdmin, menuController.updateAdminMenuPrice);
router.get("/saved", validateRequest(schemas.empty), authenticate, coffeeController.listSavedCoffees);
router.post("/", savedWriteLimiter, validateRequest(schemas.savedRecipe), authenticate, coffeeController.saveCoffee);

module.exports = router;
