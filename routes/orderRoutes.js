const express = require("express");
const orderController = require("../controllers/orderController");
const { authenticate, optionalAuthenticate, requireStaff } = require("../middleware/authenticate");
const { validateRequest } = require("../middleware/validateRequest");
const schemas = require("../schemas/requestSchemas");
const { checkoutLimiter, trackingLimiter } = require("../middleware/rateLimiters");

const router = express.Router();

router.post("/checkout", checkoutLimiter, validateRequest(schemas.checkout), optionalAuthenticate, orderController.checkout);
router.post("/", checkoutLimiter, validateRequest(schemas.checkout), optionalAuthenticate, orderController.checkout);
router.get("/track/:trackingCode", trackingLimiter, validateRequest(schemas.tracking), orderController.trackOrder);
router.get("/mine", validateRequest(schemas.empty), authenticate, orderController.listMyOrders);
router.patch("/:orderId/status", validateRequest(schemas.status), authenticate, requireStaff, orderController.advanceOrderStatus);

module.exports = router;
