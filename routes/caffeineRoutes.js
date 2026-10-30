const express = require("express");
const caffeineController = require("../controllers/caffeineController");
const { authenticate } = require("../middleware/authenticate");
const { validateRequest } = require("../middleware/validateRequest");
const schemas = require("../schemas/requestSchemas");
const { caffeineCheckLimiter, savedWriteLimiter } = require("../middleware/rateLimiters");

const router = express.Router();

router.post(
    "/check",
    caffeineCheckLimiter,
    validateRequest(schemas.caffeineCheck),
    authenticate,
    caffeineController.checkDrink
);
router.put(
    "/settings",
    savedWriteLimiter,
    validateRequest(schemas.caffeineSettings),
    authenticate,
    caffeineController.updateSettings
);

module.exports = router;
