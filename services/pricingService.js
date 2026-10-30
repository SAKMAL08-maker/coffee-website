const { normalizeConfiguration, classifyDrink, calculateNutrition } = require("./coffeeService");

/**
 * The single source of truth for Coffee Lab prices (see docs/adr/0001-server-side-pricing.md).
 *
 * Every amount is an integer number of centavos (₱1.00 = 100). Integers avoid
 * floating-point drift (0.1 + 0.2 !== 0.3), and each fee is rounded exactly
 * once, so the total shown before checkout is the total that gets saved.
 *
 * Checkout and the public quote endpoint both call this module, and the browser
 * only displays what the quote endpoint returns, so a price change here is the
 * only change needed anywhere.
 */
const PRICING_RULES = Object.freeze({
    baseDrinkCents: 25000,
    baseVolumeMl: 240,
    // Each started 120 ml above the base size costs one step.
    volumeStepMl: 120,
    volumeStepCents: 2800,
    includedShots: 2,
    extraShotCents: 5500,
    milkSurchargeCents: Object.freeze({ oat: 3900, almond: 2800 }),
    syrupPumpCents: 2500,
    deliveryFeeCents: 4900,
    // Basis points: 800 = 8.00%. Keeps percentage math in integers.
    serviceFeeBasisPoints: 800,
    taxBasisPoints: 1200,
    defaultTipPercent: 15,
    minItemsPerOrder: 1,
    maxItemsPerOrder: 20
});

const FULFILLMENT_METHODS = Object.freeze(["delivery", "pickup"]);
// recipeSlug never affects price; it only attributes a community-recipe royalty (communityRecipeService).
const ALLOWED_ITEM_FIELDS = Object.freeze(["name", "configuration", "recipeSlug"]);

function createBadRequest(message) {
    return Object.assign(new Error(message), { statusCode: 400 });
}

function applyBasisPoints(amountCents, basisPoints) {
    return Math.round((amountCents * basisPoints) / 10000);
}

/**
 * Splits a normalized drink's price into the size-based base price and the
 * add-on modifiers, matching the two lines shown in the customizer.
 */
function calculateDrinkPriceBreakdown(configuration) {
    const extraVolumeSteps = Math.max(
        0,
        Math.ceil((configuration.volumeMl - PRICING_RULES.baseVolumeMl) / PRICING_RULES.volumeStepMl)
    );
    const baseCents = PRICING_RULES.baseDrinkCents + extraVolumeSteps * PRICING_RULES.volumeStepCents;

    const extraShotCents =
        Math.max(0, configuration.shots - PRICING_RULES.includedShots) * PRICING_RULES.extraShotCents;
    const milkCents = PRICING_RULES.milkSurchargeCents[configuration.milk] || 0;
    const syrupCents = Object.values(configuration.syrups).reduce(
        (total, pumps) => total + pumps * PRICING_RULES.syrupPumpCents,
        0
    );
    const modifiersCents = extraShotCents + milkCents + syrupCents;

    return { baseCents, modifiersCents, totalCents: baseCents + modifiersCents };
}

function calculateDrinkPriceCents(configuration) {
    return calculateDrinkPriceBreakdown(configuration).totalCents;
}

function assertValidOrderInput(items, fulfillmentMethod, tipPercent) {
    if (
        !Array.isArray(items) ||
        items.length < PRICING_RULES.minItemsPerOrder ||
        items.length > PRICING_RULES.maxItemsPerOrder
    ) {
        throw createBadRequest(
            `An order must contain between ${PRICING_RULES.minItemsPerOrder} and ${PRICING_RULES.maxItemsPerOrder} drinks.`
        );
    }
    if (!FULFILLMENT_METHODS.includes(fulfillmentMethod)) {
        throw createBadRequest("fulfillmentMethod must be delivery or pickup.");
    }
    if (typeof tipPercent !== "number" || !Number.isFinite(tipPercent) || tipPercent < 0 || tipPercent > 100) {
        throw createBadRequest("tipPercent must be a number from 0 to 100.");
    }
}

function buildLineItem(item, index) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
        throw createBadRequest(`items[${index}] must be an object.`);
    }
    // Rejecting unknown keys (e.g. "price") makes it explicit that the browser
    // can never influence what a drink costs.
    if (Object.keys(item).some((key) => !ALLOWED_ITEM_FIELDS.includes(key))) {
        throw createBadRequest(`items[${index}] contains an unsupported field.`);
    }
    const configuration = normalizeConfiguration(item.configuration);
    const classification = classifyDrink(configuration);
    const name = typeof item.name === "string" && item.name.trim() ? item.name.trim().slice(0, 80) : classification;
    // This shape is passed straight to the create_coffee_order database function; keep keys stable.
    return {
        name,
        configuration,
        classification,
        nutrition: calculateNutrition(configuration),
        price_cents: calculateDrinkPriceCents(configuration)
    };
}

/**
 * Prices a whole order. Returns database-shaped (snake_case) line items and
 * totals, exactly as checkout persists them.
 */
function calculateOrderPricing(items, fulfillmentMethod, tipPercent = PRICING_RULES.defaultTipPercent) {
    assertValidOrderInput(items, fulfillmentMethod, tipPercent);
    const lineItems = items.map(buildLineItem);

    const subtotalCents = lineItems.reduce((total, item) => total + item.price_cents, 0);
    const deliveryFeeCents = fulfillmentMethod === "delivery" ? PRICING_RULES.deliveryFeeCents : 0;
    const serviceFeeCents = applyBasisPoints(subtotalCents, PRICING_RULES.serviceFeeBasisPoints);
    const taxCents = applyBasisPoints(subtotalCents, PRICING_RULES.taxBasisPoints);
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

/**
 * Same calculation as checkout, shaped for the browser (camelCase, plus the
 * base/modifier split per drink). Used by POST /api/orders/quote.
 */
function createOrderQuote(items, fulfillmentMethod, tipPercent = PRICING_RULES.defaultTipPercent) {
    const { lineItems, pricing } = calculateOrderPricing(items, fulfillmentMethod, tipPercent);
    return {
        items: lineItems.map((lineItem) => {
            const breakdown = calculateDrinkPriceBreakdown(lineItem.configuration);
            return {
                name: lineItem.name,
                classification: lineItem.classification,
                basePriceCents: breakdown.baseCents,
                modifiersCents: breakdown.modifiersCents,
                priceCents: lineItem.price_cents
            };
        }),
        pricing: {
            subtotalCents: pricing.subtotal_cents,
            deliveryFeeCents: pricing.delivery_fee_cents,
            serviceFeeCents: pricing.service_fee_cents,
            taxCents: pricing.tax_cents,
            tipPercent: pricing.tip_percent,
            tipCents: pricing.tip_cents,
            totalCents: pricing.total_cents
        }
    };
}

module.exports = {
    PRICING_RULES,
    calculateDrinkPriceBreakdown,
    calculateDrinkPriceCents,
    calculateOrderPricing,
    createOrderQuote
};
