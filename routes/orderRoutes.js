const express = require("express");
const orderController = require("../controllers/orderController");
const { authenticate, optionalAuthenticate, requireStaff } = require("../middleware/authenticate");

const router = express.Router();

router.post("/checkout", optionalAuthenticate, orderController.checkout);
router.post("/", optionalAuthenticate, orderController.checkout);
router.get("/track/:trackingCode", orderController.trackOrder);
router.get("/mine", authenticate, orderController.listMyOrders);
router.patch("/:orderId/status", authenticate, requireStaff, orderController.advanceOrderStatus);

module.exports = router;
