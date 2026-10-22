const test = require("node:test");
const assert = require("node:assert/strict");
const { calculateOrderPricing } = require("../controllers/orderController");

const standardEspresso = {
    configuration: {
        base: "espresso",
        caffeineMode: "regular",
        volumeMl: 240,
        shots: 2,
        extraction: "standard",
        temperature: "hot",
        iceStyle: "cube",
        milk: "whole",
        foam: 25,
        syrups: { vanilla: 0, caramel: 0, chocolate: 0 },
        sweeteners: [],
        toppings: { cinnamon: false, whippedCream: false, cocoa: false }
    }
};

test("calculates delivery checkout totals in integer cents", () => {
    const result = calculateOrderPricing([standardEspresso], "delivery", 15);
    assert.deepEqual(result.pricing, {
        subtotal_cents: 25000,
        delivery_fee_cents: 4900,
        service_fee_cents: 2000,
        tax_cents: 3000,
        tip_percent: 15,
        tip_cents: 3750,
        total_cents: 38650
    });
    assert.equal(result.lineItems[0].price_cents, 25000);
    assert.equal(result.lineItems[0].classification, "Latte");
    assert.equal(typeof result.lineItems[0].nutrition.caffeineMg, "number");
});

test("adds premium modifiers and omits delivery fee for pickup", () => {
    const premiumDrink = {
        name: "Oat extra-shot mocha",
        configuration: {
            ...standardEspresso.configuration,
            shots: 3,
            milk: "oat",
            syrups: { vanilla: 2, caramel: 0, chocolate: 0 }
        }
    };
    const result = calculateOrderPricing([premiumDrink], "pickup", 0);
    assert.equal(result.lineItems[0].price_cents, 39400);
    assert.equal(result.pricing.delivery_fee_cents, 0);
    assert.equal(result.pricing.tip_cents, 0);
    assert.equal(result.pricing.total_cents, 47280);
});

test("rejects unsupported client-supplied price fields", () => {
    assert.throws(
        () => calculateOrderPricing([{ ...standardEspresso, price: 0 }], "delivery"),
        { statusCode: 400, message: /unsupported field/ }
    );
});

test("rejects invalid tip percentages", () => {
    assert.throws(
        () => calculateOrderPricing([standardEspresso], "delivery", 101),
        { statusCode: 400, message: /tipPercent/ }
    );
});
