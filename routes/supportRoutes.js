const express = require("express");
const supportController = require("../controllers/supportController");
const { authenticate, requireAdmin } = require("../middleware/authenticate");
const { validateRequest } = require("../middleware/validateRequest");
const schemas = require("../schemas/requestSchemas");
const { supportReadLimiter, supportWriteLimiter, supportTicketLimiter } = require("../middleware/rateLimiters");

const router = express.Router();

// Customer: their own tickets.
router.get("/tickets", supportReadLimiter, validateRequest(schemas.empty), authenticate, supportController.listMine);
router.post(
    "/tickets",
    supportTicketLimiter,
    validateRequest(schemas.supportTicketCreate),
    authenticate,
    supportController.create
);
// Staff: every ticket.
router.get(
    "/admin/tickets",
    supportReadLimiter,
    validateRequest(schemas.supportStaffList),
    authenticate,
    requireAdmin,
    supportController.listForStaff
);
// One ticket: its customer or staff (checked in services/supportService.js).
router.get(
    "/tickets/:ticketId/messages",
    supportReadLimiter,
    validateRequest(schemas.supportMessages),
    authenticate,
    supportController.messages
);
router.post(
    "/tickets/:ticketId/messages",
    supportWriteLimiter,
    validateRequest(schemas.supportReply),
    authenticate,
    supportController.reply
);
router.patch(
    "/tickets/:ticketId",
    supportWriteLimiter,
    validateRequest(schemas.supportTicketStatus),
    authenticate,
    supportController.setStatus
);

module.exports = router;
