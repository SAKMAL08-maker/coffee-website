const express = require("express");
const superadminController = require("../controllers/superadminController");
const { authenticate, requireSuperadmin } = require("../middleware/authenticate");
const { validateRequest } = require("../middleware/validateRequest");
const schemas = require("../schemas/requestSchemas");
const { superadminActionLimiter } = require("../middleware/rateLimiters");

const router = express.Router();

// Account dashboard: every admin and customer, with sign-in status.
router.get(
    "/accounts",
    superadminActionLimiter,
    validateRequest(schemas.superadminAccounts),
    authenticate,
    requireSuperadmin,
    superadminController.getAccounts
);
// Revoke admin rights: the account becomes a customer and its admin sign-in is removed.
router.post(
    "/accounts/:username/demote",
    superadminActionLimiter,
    validateRequest(schemas.superadminAccountAction),
    authenticate,
    requireSuperadmin,
    superadminController.demote
);
router.delete(
    "/accounts/:username",
    superadminActionLimiter,
    validateRequest(schemas.superadminAccountAction),
    authenticate,
    requireSuperadmin,
    superadminController.remove
);

module.exports = router;
