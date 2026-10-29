const ORDER_STATUSES = ["Received", "Crafting", "Out for Delivery", "Arrived", "Delivered"];

const ALLOWED_TRANSITIONS = Object.freeze({
    Received: Object.freeze(["Crafting"]),
    Crafting: Object.freeze(["Out for Delivery"]),
    "Out for Delivery": Object.freeze(["Arrived"]),
    Arrived: Object.freeze([]),
    Delivered: Object.freeze([])
});

function canTransitionOrderStatus(currentStatus, nextStatus) {
    return (ALLOWED_TRANSITIONS[currentStatus] || []).includes(nextStatus);
}

function getAllowedOrderStatusTransitions(status) {
    return [...(ALLOWED_TRANSITIONS[status] || [])];
}

module.exports = { ORDER_STATUSES, ALLOWED_TRANSITIONS, canTransitionOrderStatus, getAllowedOrderStatusTransitions };
