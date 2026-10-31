const test = require("node:test");
const assert = require("node:assert/strict");
const { calculateOrderPricing, createOrderQuote } = require("../services/pricingService");
const {
    FREE_DRINK_POINTS,
    POINTS_PER_PURCHASED_DRINK,
    getLoyaltyBalance,
    withPurchasePoints,
    isInsufficientPointsError
} = require("../services/loyaltyService");
const { buildReceiptLines } = require("../services/receiptModel");

const small = { configuration: { volumeMl: 240 } }; // ₱250
const large = { configuration: { volumeMl: 480, milk: "oat" } }; // ₱250 + 2 × ₱28 + ₱39 = ₱345

test("a reward makes the most expensive drink free, before the service fee and VAT", () => {
    const { lineItems, pricing } = calculateOrderPricing([small, large], "pickup", 0, { redeemFreeDrink: true });
    assert.deepEqual(
        lineItems.map((item) => item.redeemed_points || 0),
        [0, FREE_DRINK_POINTS]
    );
    assert.equal(pricing.subtotal_cents, 25000 + 34500, "the drink keeps its price on the order");
    assert.equal(pricing.reward_discount_cents, 34500);
    assert.equal(pricing.service_fee_cents, 2000, "8% of the ₱250 still paid for");
    assert.equal(pricing.total_cents, 27000);
    assert.equal(pricing.tax_cents, Math.round((27000 * 1200) / 11200));

    const without = calculateOrderPricing([small, large], "pickup", 0);
    assert.equal(without.pricing.reward_discount_cents, undefined);
    assert.ok(without.lineItems.every((item) => !item.redeemed_points));
});

test("the quote shows the same reward the order will save", () => {
    const quote = createOrderQuote([large, small], "delivery", 0, { redeemFreeDrink: true });
    const saved = calculateOrderPricing([large, small], "delivery", 0, { redeemFreeDrink: true });
    assert.equal(quote.pricing.rewardDiscountCents, saved.pricing.reward_discount_cents);
    assert.equal(quote.pricing.totalCents, saved.pricing.total_cents);
    assert.deepEqual(
        quote.items.map((item) => item.isFreeReward),
        [true, false]
    );
});

test("customers earn points on each paid-for drink, not on the free one; guests earn none", () => {
    const { lineItems } = calculateOrderPricing([small, large, small], "pickup", 0, { redeemFreeDrink: true });
    assert.deepEqual(
        withPurchasePoints(lineItems, "account-1").map((item) => item.purchase_points),
        [POINTS_PER_PURCHASED_DRINK, 0, POINTS_PER_PURCHASED_DRINK]
    );
    assert.deepEqual(
        withPurchasePoints(lineItems, null).map((item) => item.purchase_points),
        [0, 0, 0]
    );
});

test("the balance is earned minus redeemed, and a missing database function means zero, not an error", async () => {
    const rpc = (data, error = null) => ({ rpc: () => ({ maybeSingle: async () => ({ data, error }) }) });
    assert.deepEqual(
        await getLoyaltyBalance(rpc({ earned_points: 130, pending_points: 20, redeemed_points: 100 }), "a"),
        { earned: 130, pending: 20, redeemed: 100, available: 30, freeDrinkPoints: 100 }
    );
    assert.equal((await getLoyaltyBalance(rpc(null, { code: "PGRST202" }), "a")).available, 0);
    await assert.rejects(getLoyaltyBalance(rpc(null, { code: "57014", message: "timeout" }), "a"));
    assert.ok(isInsufficientPointsError({ message: "loyalty:insufficient_points (has 40, needs 100)" }));
    assert.ok(!isInsufficientPointsError({ message: "duplicate key" }));
});

test("the receipt shows the reward as a discount line and VAT on what was actually paid", () => {
    const { lineItems, pricing } = calculateOrderPricing([small, large], "pickup", 0, { redeemFreeDrink: true });
    const text = buildReceiptLines({
        tracking_code: "abc123def456",
        fulfillment_method: "pickup",
        created_at: "2026-10-31T05:00:00Z",
        customer: { name: "Juan" },
        pricing,
        order_items: lineItems
    })
        .map((line) => `${line.left || ""} ${line.right || ""}`)
        .join("\n");
    assert.match(text, /Free drink reward \(100 pts\)\s+-345\.00/);
    assert.match(text, /TOTAL DUE\s+PHP 270\.00/);
    assert.match(text, /VATable sales\s+241\.07/);
    assert.match(text, /VAT amount \(12%\)\s+28\.93/);
});
