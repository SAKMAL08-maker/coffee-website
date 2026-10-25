const express = require("express");
const orderController = require("../controllers/orderController");
const { authenticate, optionalAuthenticate, requireStaff, requireAdmin } = require("../middleware/authenticate");
const { validateRequest } = require("../middleware/validateRequest");
const schemas = require("../schemas/requestSchemas");
const {
    checkoutLimiter,
    trackingLimiter,
    receiptLimiter,
    deliveryReportLimiter,
    adminOrderLimiter
} = require("../middleware/rateLimiters");

const router = express.Router();

router.post("/checkout", checkoutLimiter, validateRequest(schemas.checkout), optionalAuthenticate, orderController.checkout);
router.post("/", checkoutLimiter, validateRequest(schemas.checkout), optionalAuthenticate, orderController.checkout);
router.get("/track/:trackingCode", trackingLimiter, validateRequest(schemas.tracking), orderController.trackOrder);
router.get("/mine", validateRequest(schemas.empty), authenticate, orderController.listMyOrders);
router.post("/:orderId/receipt/retry", receiptLimiter, validateRequest(schemas.receiptRetry), authenticate, orderController.retryReceipt);
router.get("/:orderId/receipt/preview", receiptLimiter, validateRequest(schemas.orderId), authenticate, orderController.viewReceiptImage);
router.get("/:orderId/receipt", receiptLimiter, validateRequest(schemas.orderId), authenticate, orderController.downloadReceipt);
router.post("/:orderId/delivery-report", deliveryReportLimiter, validateRequest(schemas.deliveryReport), authenticate, orderController.reportDelivery);
router.get("/admin/all", adminOrderLimiter, validateRequest(schemas.adminOrders), authenticate, requireAdmin, orderController.listAdminOrders);
router.post("/:orderId/admin/receipt/retry", receiptLimiter, validateRequest(schemas.receiptRetry), authenticate, requireAdmin, orderController.retryAdminReceipt);
router.get("/:orderId/admin/receipt/preview", receiptLimiter, validateRequest(schemas.orderId), authenticate, requireAdmin, orderController.viewAdminReceiptImage);
router.get("/:orderId/admin/receipt", receiptLimiter, validateRequest(schemas.orderId), authenticate, requireAdmin, orderController.downloadAdminReceipt);
router.patch("/:orderId/admin/approve-delivery", adminOrderLimiter, validateRequest(schemas.orderId), authenticate, requireAdmin, orderController.approveDelivery);
router.patch("/:orderId/admin/approve-pickup", adminOrderLimiter, validateRequest(schemas.orderId), authenticate, requireAdmin, orderController.approvePickup);
router.delete("/:orderId/admin", adminOrderLimiter, validateRequest(schemas.orderId), authenticate, requireAdmin, orderController.deleteAdminOrder);
router.patch("/:orderId/status", validateRequest(schemas.status), authenticate, requireStaff, orderController.advanceOrderStatus);

module.exports = router;
