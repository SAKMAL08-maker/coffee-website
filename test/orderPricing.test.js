const test = require("node:test");
const assert = require("node:assert/strict");
const { calculateOrderPricing } = require("../services/pricingService");

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
    assert.throws(() => calculateOrderPricing([{ ...standardEspresso, price: 0 }], "delivery"), {
        statusCode: 400,
        message: /unsupported field/
    });
});

test("rejects invalid tip percentages", () => {
    assert.throws(() => calculateOrderPricing([standardEspresso], "delivery", 101), {
        statusCode: 400,
        message: /tipPercent/
    });
});

test("only charges for what is in the cup: no shots outside espresso, no milk in filter or cold brew", () => {
    const drink = (overrides) => ({ configuration: { ...standardEspresso.configuration, ...overrides } });
    const subtotal = (overrides) => calculateOrderPricing([drink(overrides)], "pickup", 0).pricing.subtotal_cents;
    // Espresso still pays for extra shots and oat milk.
    assert.equal(subtotal({ shots: 4, milk: "oat" }), 25000 + 2 * 5500 + 3900);
    // A cold brew or filter coffee is the same price however the hidden sliders are set.
    assert.equal(subtotal({ base: "coldBrew", shots: 4, milk: "oat" }), 25000);
    assert.equal(subtotal({ base: "drip", shots: 4, milk: "almond" }), 25000);
    // Matcha has milk but no shots.
    assert.equal(subtotal({ base: "matcha", shots: 4, milk: "oat" }), 25000 + 3900);
});
