/**
 * Payment rules. Coffee Lab currently accepts cash only, paid when the order is
 * picked up or delivered; nothing is charged online.
 *
 * Kept in its own module so a future method (e.g. an e-wallet) is added here and
 * in a migration that widens orders_payment_method_check, without touching
 * checkout, receipts, or the admin dashboard logic.
 */
const PAYMENT_METHOD = Object.freeze({ CASH: "cash" });
const DEFAULT_PAYMENT_METHOD = PAYMENT_METHOD.CASH;

/** Customer-facing instruction, e.g. "Pay in cash on pickup". */
function describePaymentInstruction(fulfillmentMethod, paymentMethod = DEFAULT_PAYMENT_METHOD) {
    if (paymentMethod !== PAYMENT_METHOD.CASH) return "Payment details will be confirmed by Coffee Lab.";
    return fulfillmentMethod === "pickup" ? "Pay in cash on pickup" : "Pay in cash on delivery";
}

/** Whether an admin may record cash as collected for this order row. */
function canMarkCashCollected(order) {
    return (order.payment_method || DEFAULT_PAYMENT_METHOD) === PAYMENT_METHOD.CASH && !order.cash_collected_at;
}

module.exports = { PAYMENT_METHOD, DEFAULT_PAYMENT_METHOD, describePaymentInstruction, canMarkCashCollected };
