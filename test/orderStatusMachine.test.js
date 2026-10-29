const test = require("node:test");
const assert = require("node:assert/strict");
const { ALLOWED_TRANSITIONS, canTransitionOrderStatus, getAllowedOrderStatusTransitions } = require("../services/orderStatusMachine");

test("allows only the next fulfillment stage", () => {
    assert.equal(canTransitionOrderStatus("Received", "Crafting"), true);
    assert.equal(canTransitionOrderStatus("Crafting", "Out for Delivery"), true);
    assert.equal(canTransitionOrderStatus("Out for Delivery", "Arrived"), true);
    assert.equal(canTransitionOrderStatus("Received", "Arrived"), false);
    assert.equal(canTransitionOrderStatus("Arrived", "Received"), false);
});

test("keeps delivery completion separate from the staff status endpoint", () => {
    assert.equal(canTransitionOrderStatus("Arrived", "Delivered"), false);
    assert.deepEqual(getAllowedOrderStatusTransitions("Delivered"), []);
    assert.deepEqual(getAllowedOrderStatusTransitions("unknown"), []);
    assert.ok(Object.isFrozen(ALLOWED_TRANSITIONS));
});
