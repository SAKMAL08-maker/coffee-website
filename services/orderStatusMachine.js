/**
 * Order status rules in one place, as a small state machine.
 *
 * Why a table instead of "next index in an array": pickup and delivery orders
 * follow different paths, and the final states are set only by an admin
 * approval. A lookup table makes every allowed move explicit and reviewable,
 * and anything not listed is rejected.
 *
 * The status names match the orders_status_check constraint in
 * supabase/migrations/20261028000000_pickup_approval.sql.
 */
const ORDER_STATUS = Object.freeze({
    RECEIVED: "Received",
    CRAFTING: "Crafting",
    OUT_FOR_DELIVERY: "Out for Delivery",
    ARRIVED: "Arrived",
    DELIVERED: "Delivered",
    READY_FOR_PICKUP: "Ready for Pickup"
});

// Moves staff may make through PATCH /api/orders/:orderId/status, one step at a time.
const STAFF_TRANSITIONS = Object.freeze({
    delivery: Object.freeze({
        [ORDER_STATUS.RECEIVED]: [ORDER_STATUS.CRAFTING],
        [ORDER_STATUS.CRAFTING]: [ORDER_STATUS.OUT_FOR_DELIVERY],
        [ORDER_STATUS.OUT_FOR_DELIVERY]: [ORDER_STATUS.ARRIVED]
    }),
    // Pickup orders never travel; "Ready for Pickup" is set by admin approval.
    pickup: Object.freeze({
        [ORDER_STATUS.RECEIVED]: [ORDER_STATUS.CRAFTING]
    })
});

// The final status each fulfillment method reaches through admin approval.
const APPROVAL_STATUS = Object.freeze({
    delivery: ORDER_STATUS.DELIVERED,
    pickup: ORDER_STATUS.READY_FOR_PICKUP
});

const FINAL_STATUSES = Object.freeze([ORDER_STATUS.DELIVERED, ORDER_STATUS.READY_FOR_PICKUP]);

function isKnownStatus(status) {
    return Object.values(ORDER_STATUS).includes(status);
}

function isFinalStatus(status) {
    return FINAL_STATUSES.includes(status);
}

/** True when staff may move an order of this fulfillment method from `fromStatus` to `toStatus`. */
function canStaffAdvance(fulfillmentMethod, fromStatus, toStatus) {
    const transitions = STAFF_TRANSITIONS[fulfillmentMethod];
    if (!transitions || !Object.hasOwn(transitions, fromStatus)) return false;
    return transitions[fromStatus].includes(toStatus);
}

/**
 * True when an admin may approve fulfillment from `fromStatus`. Approval is an
 * admin override, so it is allowed from any status that isn't already final,
 * matching the behavior before this module existed.
 */
function canApproveFulfillment(fulfillmentMethod, fromStatus) {
    return Object.hasOwn(APPROVAL_STATUS, fulfillmentMethod) && !isFinalStatus(fromStatus);
}

function getApprovalStatus(fulfillmentMethod) {
    return APPROVAL_STATUS[fulfillmentMethod];
}

module.exports = {
    ORDER_STATUS,
    STAFF_TRANSITIONS,
    isKnownStatus,
    isFinalStatus,
    canStaffAdvance,
    canApproveFulfillment,
    getApprovalStatus
};
