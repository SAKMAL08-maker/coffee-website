const express = require("express");
const adminController = require("../controllers/adminController");
const { authenticate, requireAdmin } = require("../middleware/authenticate");
const { validateRequest } = require("../middleware/validateRequest");
const schemas = require("../schemas/requestSchemas");
const { adminOrderLimiter } = require("../middleware/rateLimiters");

const router = express.Router();

// Dashboard totals and bar-chart data for the admin page.
router.get(
    "/metrics",
    adminOrderLimiter,
    validateRequest(schemas.adminMetrics),
    authenticate,
    requireAdmin,
    adminController.getMetrics
);

module.exports = router;
