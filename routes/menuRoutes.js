const express = require("express");
const menuController = require("../controllers/menuController");
const { authenticate, requireAdmin, requireSuperadmin } = require("../middleware/authenticate");
const { validateRequest } = require("../middleware/validateRequest");
const schemas = require("../schemas/requestSchemas");
const { menuReadLimiter, menuWriteLimiter } = require("../middleware/rateLimiters");

const router = express.Router();

// Public: the builder needs these before anyone signs in.
router.get("/branches", menuReadLimiter, validateRequest(schemas.empty), menuController.listOpenBranches);
router.get("/availability", menuReadLimiter, validateRequest(schemas.menuAvailability), menuController.availability);

router.get(
    "/admin",
    menuReadLimiter,
    validateRequest(schemas.empty),
    authenticate,
    requireAdmin,
    menuController.adminMenu
);
router.put(
    "/admin/sold-out",
    menuWriteLimiter,
    validateRequest(schemas.menuSoldOut),
    authenticate,
    requireAdmin,
    menuController.setSoldOut
);
router.post(
    "/admin/branches",
    menuWriteLimiter,
    validateRequest(schemas.branchCreate),
    authenticate,
    requireSuperadmin,
    menuController.createBranch
);
router.patch(
    "/admin/branches/:branchId",
    menuWriteLimiter,
    validateRequest(schemas.branchUpdate),
    authenticate,
    requireSuperadmin,
    menuController.updateBranch
);

module.exports = router;
