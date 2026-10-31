const test = require("node:test");
const assert = require("node:assert/strict");
const {
    ORDER_STATUS,
    isKnownStatus,
    isFinalStatus,
    canStaffAdvance,
    canApproveFulfillment,
    getApprovalStatus,
    canCancel
} = require("../services/orderStatusMachine");

const ALL_STATUSES = Object.values(ORDER_STATUS);

test("delivery orders advance one stage at a time: Received → Crafting → Out for Delivery → Arrived", () => {
    assert.equal(canStaffAdvance("delivery", "Received", "Crafting"), true);
    assert.equal(canStaffAdvance("delivery", "Crafting", "Out for Delivery"), true);
    assert.equal(canStaffAdvance("delivery", "Out for Delivery", "Arrived"), true);

    // Skipping, going backwards, or staying put is rejected.
    assert.equal(canStaffAdvance("delivery", "Received", "Out for Delivery"), false);
    assert.equal(canStaffAdvance("delivery", "Crafting", "Received"), false);
    assert.equal(canStaffAdvance("delivery", "Crafting", "Crafting"), false);
});

test("pickup orders can only go Received → Crafting through the staff endpoint", () => {
    assert.equal(canStaffAdvance("pickup", "Received", "Crafting"), true);
    assert.equal(canStaffAdvance("pickup", "Crafting", "Out for Delivery"), false);
    assert.equal(canStaffAdvance("pickup", "Out for Delivery", "Arrived"), false);
});

test("final statuses never move, which fixes the old 'Delivered → Received' 500 error", () => {
    for (const fulfillmentMethod of ["delivery", "pickup"]) {
        for (const finalStatus of ["Delivered", "Ready for Pickup"]) {
            for (const target of ALL_STATUSES) {
                assert.equal(canStaffAdvance(fulfillmentMethod, finalStatus, target), false);
            }
            assert.equal(canApproveFulfillment(fulfillmentMethod, finalStatus), false);
        }
    }
});

test("admin approval is allowed from any non-final status and targets the method's final status", () => {
    for (const status of ["Received", "Crafting", "Out for Delivery", "Arrived"]) {
        assert.equal(canApproveFulfillment("delivery", status), true);
        assert.equal(canApproveFulfillment("pickup", status), true);
    }
    assert.equal(getApprovalStatus("delivery"), "Delivered");
    assert.equal(getApprovalStatus("pickup"), "Ready for Pickup");
});

test("unknown statuses, fulfillment methods, and prototype keys are rejected", () => {
    assert.equal(isKnownStatus("Shipped"), false);
    assert.equal(isKnownStatus("Crafting"), true);
    assert.equal(isFinalStatus("Delivered"), true);
    assert.equal(isFinalStatus("Arrived"), false);
    assert.equal(canStaffAdvance("drone", "Received", "Crafting"), false);
    assert.equal(canStaffAdvance("delivery", "constructor", "Crafting"), false);
    assert.equal(canStaffAdvance("__proto__", "Received", "Crafting"), false);
    assert.equal(canApproveFulfillment("drone", "Received"), false);
    assert.equal(canApproveFulfillment("toString", "Received"), false);
});

test("orders can be cancelled until they are finished, and a cancelled order is final", () => {
    for (const status of ["Received", "Crafting", "Out for Delivery", "Arrived"])
        assert.equal(canCancel(status), true, status);
    for (const status of ["Delivered", "Ready for Pickup", "Cancelled", "Bogus"])
        assert.equal(canCancel(status), false, status);
    assert.equal(isFinalStatus("Cancelled"), true);
    assert.equal(canApproveFulfillment("delivery", "Cancelled"), false);
    assert.equal(canStaffAdvance("delivery", "Cancelled", "Crafting"), false);
});
