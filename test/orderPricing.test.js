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
        subtotalCents: 450,
        deliveryFeeCents: 249,
        serviceFeeCents: 36,
        taxCents: 37,
        tipPercent: 15,
        tipCents: 68,
        totalCents: 840
    });
    assert.equal(result.lineItems[0].priceCents, 450);
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
    assert.equal(result.lineItems[0].priceCents, 720);
    assert.equal(result.pricing.deliveryFeeCents, 0);
    assert.equal(result.pricing.tipCents, 0);
    assert.equal(result.pricing.totalCents, 837);
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
