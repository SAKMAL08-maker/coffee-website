const express = require("express");
const healthController = require("../controllers/healthController");
const { validateRequest } = require("../middleware/validateRequest");
const schemas = require("../schemas/requestSchemas");
const { healthLimiter } = require("../middleware/rateLimiters");

const router = express.Router();

// Rate-limited because every hit runs a database query; a pinger needs at most
// one request every few minutes, so the limit only bites on abuse.
router.get("/", healthLimiter, validateRequest(schemas.empty), healthController.getHealth);

module.exports = router;
