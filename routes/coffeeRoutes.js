const express = require("express");
const coffeeController = require("../controllers/coffeeController");
const { authenticate } = require("../middleware/authenticate");

const router = express.Router();

router.post("/quote", coffeeController.createQuote);
router.get("/saved", authenticate, coffeeController.listSavedCoffees);
router.post("/", authenticate, coffeeController.saveCoffee);

module.exports = router;
