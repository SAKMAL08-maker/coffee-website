const express = require("express");
const coffeeController = require("../controllers/coffeeController");
const { authenticate } = require("../middleware/authenticate");
const { validateRequest } = require("../middleware/validateRequest");
const schemas = require("../schemas/requestSchemas");
const { quoteLimiter, savedWriteLimiter } = require("../middleware/rateLimiters");

const router = express.Router();

router.post("/quote", quoteLimiter, validateRequest(schemas.quote), coffeeController.createQuote);
router.get("/saved", validateRequest(schemas.empty), authenticate, coffeeController.listSavedCoffees);
router.post("/", savedWriteLimiter, validateRequest(schemas.savedRecipe), authenticate, coffeeController.saveCoffee);

module.exports = router;
