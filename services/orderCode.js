/**
 * The order number people see: "CL-" plus the last 6 characters of the tracking code.
 * The same rule is used on the customer and admin screens (public/js/app.js, admin.js),
 * so a receipt, the tracking page and the admin list always show the same number.
 * Older callers without a tracking code fall back to the order id.
 */
function displayOrderCode(order = {}) {
    const source = order.tracking_code || order.trackingCode;
    if (source) return `CL-${String(source).slice(-6).toUpperCase()}`;
    return `CL-${String(order.id || "")
        .slice(0, 8)
        .toUpperCase()}`;
}

module.exports = { displayOrderCode };
