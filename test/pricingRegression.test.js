// Regression tests for the Phase 3 pricing refactor.
//
// `legacyCalculateOrderPricing` below is a VERBATIM copy of the pricing code from
// controllers/orderController.js on main at commit e2285d7 (before the refactor),
// with only the function renamed. The new services/pricingService.js must produce
// byte-for-byte identical results for every order in the matrix, for both pickup
// and delivery. Do not "fix" the legacy copy; it is the reference.
const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeConfiguration, classifyDrink, calculateNutrition } = require("../services/coffeeService");
const {
    calculateOrderPricing,
    createOrderQuote,
    calculateDrinkPriceBreakdown,
    PRICING_RULES
} = require("../services/pricingService");

// ---- BEGIN verbatim legacy code (main@e2285d7, controllers/orderController.js lines 15-86; line 18, the unrelated status list, omitted) ----
const SERVICE_FEE_BASIS_POINTS = 800;
const TAX_BASIS_POINTS = 1200;
const DELIVERY_FEE_CENTS = 4900;

function badRequest(message) {
    return Object.assign(new Error(message), { statusCode: 400 });
}

function roundBasisPoints(amountCents, basisPoints) {
    return Math.round((amountCents * basisPoints) / 10000);
}

function calculateDrinkPriceCents(configuration) {
    const baseCents = 25000 + Math.max(0, Math.ceil((configuration.volumeMl - 240) / 120)) * 2800;
    const extraShotCents = Math.max(0, configuration.shots - 2) * 5500;
    const milkModifierCents = configuration.milk === "oat" ? 3900 : configuration.milk === "almond" ? 2800 : 0;
    const syrupModifierCents = Object.values(configuration.syrups).reduce((total, pumps) => total + pumps * 2500, 0);
    return baseCents + extraShotCents + milkModifierCents + syrupModifierCents;
}

function legacyCalculateOrderPricing(items, fulfillmentMethod, tipPercent = 15) {
    if (!Array.isArray(items) || items.length < 1 || items.length > 20) {
        throw badRequest("An order must contain between 1 and 20 drinks.");
    }
    if (!["delivery", "pickup"].includes(fulfillmentMethod)) {
        throw badRequest("fulfillmentMethod must be delivery or pickup.");
    }
    if (typeof tipPercent !== "number" || !Number.isFinite(tipPercent) || tipPercent < 0 || tipPercent > 100) {
        throw badRequest("tipPercent must be a number from 0 to 100.");
    }

    const lineItems = items.map((item, index) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
            throw badRequest(`items[${index}] must be an object.`);
        }
        if (Object.keys(item).some((key) => !["name", "configuration"].includes(key))) {
            throw badRequest(`items[${index}] contains an unsupported field.`);
        }
        const configuration = normalizeConfiguration(item.configuration);
        const name =
            typeof item.name === "string" && item.name.trim()
                ? item.name.trim().slice(0, 80)
                : classifyDrink(configuration);
        return {
            name,
            configuration,
            classification: classifyDrink(configuration),
            nutrition: calculateNutrition(configuration),
            price_cents: calculateDrinkPriceCents(configuration)
        };
    });

    const subtotalCents = lineItems.reduce((total, item) => total + item.price_cents, 0);
    const deliveryFeeCents = fulfillmentMethod === "delivery" ? DELIVERY_FEE_CENTS : 0;
    const serviceFeeCents = roundBasisPoints(subtotalCents, SERVICE_FEE_BASIS_POINTS);
    const taxCents = roundBasisPoints(subtotalCents, TAX_BASIS_POINTS);
    const tipCents = Math.round((subtotalCents * tipPercent) / 100);

    return {
        lineItems,
        pricing: {
            subtotal_cents: subtotalCents,
            delivery_fee_cents: deliveryFeeCents,
            service_fee_cents: serviceFeeCents,
            tax_cents: taxCents,
            tip_percent: tipPercent,
            tip_cents: tipCents,
            total_cents: subtotalCents + deliveryFeeCents + serviceFeeCents + taxCents + tipCents
        }
    };
}
// ---- END verbatim legacy code ----

const VOLUMES_ML = [60, 239, 240, 241, 360, 361, 480];
const SHOTS = [1, 2, 3, 4];
const MILKS = ["whole", "skim", "oat", "almond"];
const SYRUP_MIXES = [
    { vanilla: 0, caramel: 0, chocolate: 0 },
    { vanilla: 1, caramel: 0, chocolate: 0 },
    { vanilla: 2, caramel: 3, chocolate: 1 },
    { vanilla: 6, caramel: 6, chocolate: 6 }
];
// Includes awkward custom tips that produce half-centavo values before rounding.
const TIP_PERCENTS = [0, 10, 12.5, 15, 18, 20, 33.3, 66.67, 99.99, 100];
const FULFILLMENT_METHODS = ["pickup", "delivery"];

function buildDrinkMatrix() {
    const drinks = [];
    for (const volumeMl of VOLUMES_ML)
        for (const shots of SHOTS)
            for (const milk of MILKS)
                for (const syrups of SYRUP_MIXES) drinks.push({ configuration: { volumeMl, shots, milk, syrups } });
    return drinks;
}

// Deterministic pseudo-random carts (no Math.random, so failures are reproducible).
function buildCarts(drinks, cartCount) {
    let seed = 20261030;
    const nextIndex = (limit) => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return seed % limit;
    };
    const carts = [];
    for (let cartIndex = 0; cartIndex < cartCount; cartIndex += 1) {
        const size = 1 + nextIndex(PRICING_RULES.maxItemsPerOrder);
        carts.push(Array.from({ length: size }, () => drinks[nextIndex(drinks.length)]));
    }
    return carts;
}

const drinkMatrix = buildDrinkMatrix();

test("every single drink prices identically to the legacy code, pickup and delivery, all tips", () => {
    let comparisons = 0;
    for (const drink of drinkMatrix)
        for (const fulfillmentMethod of FULFILLMENT_METHODS)
            for (const tipPercent of TIP_PERCENTS) {
                assert.deepStrictEqual(
                    calculateOrderPricing([drink], fulfillmentMethod, tipPercent),
                    legacyCalculateOrderPricing([drink], fulfillmentMethod, tipPercent),
                    `drink ${JSON.stringify(drink.configuration)} ${fulfillmentMethod} tip ${tipPercent}`
                );
                comparisons += 1;
            }
    assert.equal(comparisons, drinkMatrix.length * FULFILLMENT_METHODS.length * TIP_PERCENTS.length);
});

test("multi-drink carts (1-20 items) price identically to the legacy code, pickup and delivery", () => {
    for (const cart of buildCarts(drinkMatrix, 200))
        for (const fulfillmentMethod of FULFILLMENT_METHODS)
            for (const tipPercent of TIP_PERCENTS) {
                assert.deepStrictEqual(
                    calculateOrderPricing(cart, fulfillmentMethod, tipPercent),
                    legacyCalculateOrderPricing(cart, fulfillmentMethod, tipPercent)
                );
            }
});

test("default tip and validation errors match the legacy code", () => {
    const drink = drinkMatrix[0];
    assert.deepStrictEqual(calculateOrderPricing([drink], "pickup"), legacyCalculateOrderPricing([drink], "pickup"));
    const invalidCalls = [
        [[], "pickup", 15],
        [Array(21).fill(drink), "pickup", 15],
        [[drink], "drone", 15],
        [[drink], "pickup", -1],
        [[drink], "pickup", 101],
        [[drink], "pickup", Number.NaN],
        [[{ ...drink, price: 1 }], "pickup", 15],
        [[null], "pickup", 15]
    ];
    for (const args of invalidCalls) {
        let legacyError;
        try {
            legacyCalculateOrderPricing(...args);
        } catch (error) {
            legacyError = error;
        }
        assert.ok(legacyError, `legacy should reject ${JSON.stringify(args[1])}`);
        assert.throws(() => calculateOrderPricing(...args), { statusCode: 400, message: legacyError.message });
    }
});

test("the browser quote reports the same totals checkout will save, with a consistent base/modifier split", () => {
    for (const cart of buildCarts(drinkMatrix, 50))
        for (const fulfillmentMethod of FULFILLMENT_METHODS) {
            const saved = calculateOrderPricing(cart, fulfillmentMethod, 12.5);
            const quote = createOrderQuote(cart, fulfillmentMethod, 12.5);
            assert.deepStrictEqual(quote.pricing, {
                subtotalCents: saved.pricing.subtotal_cents,
                deliveryFeeCents: saved.pricing.delivery_fee_cents,
                serviceFeeCents: saved.pricing.service_fee_cents,
                taxCents: saved.pricing.tax_cents,
                tipPercent: saved.pricing.tip_percent,
                tipCents: saved.pricing.tip_cents,
                totalCents: saved.pricing.total_cents
            });
            quote.items.forEach((item, index) => {
                assert.equal(item.priceCents, saved.lineItems[index].price_cents);
                assert.equal(item.basePriceCents + item.modifiersCents, item.priceCents);
                assert.ok(Number.isInteger(item.basePriceCents) && Number.isInteger(item.modifiersCents));
            });
        }
});

test("base/modifier split matches the old browser preview rules", () => {
    const configuration = normalizeConfiguration({
        volumeMl: 361,
        shots: 4,
        milk: "oat",
        syrups: { vanilla: 1, caramel: 0, chocolate: 2 }
    });
    // Old public/js/pricing.js: base ₱250 + 2 size steps × ₱28; modifiers 2 extra shots × ₱55 + oat ₱39 + 3 pumps × ₱25.
    assert.deepStrictEqual(calculateDrinkPriceBreakdown(configuration), {
        baseCents: 25000 + 2 * 2800,
        modifiersCents: 2 * 5500 + 3900 + 3 * 2500,
        totalCents: 25000 + 2 * 2800 + 2 * 5500 + 3900 + 3 * 2500
    });
});
