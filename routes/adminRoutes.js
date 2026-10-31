const express = require("express");
const adminController = require("../controllers/adminController");
const { authenticate, requireAdmin } = require("../middleware/authenticate");
const { validateRequest } = require("../middleware/validateRequest");
const schemas = require("../schemas/requestSchemas");
const { adminOrderLimiter, adminApprovalLimiter } = require("../middleware/rateLimiters");

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

// Spreadsheet download of orders in the same range (no customer contact details).
router.get(
    "/orders.csv",
    adminOrderLimiter,
    validateRequest(schemas.adminMetrics),
    authenticate,
    requireAdmin,
    adminController.exportOrdersCsv
);

// Admin access: list admins and approve (or reset) their authenticator setup,
// replacing the terminal-only scripts/admin-mfa-bootstrap.js for day-to-day use.
router.get(
    "/accounts",
    adminOrderLimiter,
    validateRequest(schemas.adminAccounts),
    authenticate,
    requireAdmin,
    adminController.listAccounts
);
router.post(
    "/accounts/:username/approve-setup",
    adminApprovalLimiter,
    validateRequest(schemas.adminApproveSetup),
    authenticate,
    requireAdmin,
    adminController.approveSetup
);

module.exports = router;
