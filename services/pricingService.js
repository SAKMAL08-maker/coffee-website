const { normalizeConfiguration, classifyDrink, calculateNutrition } = require("./coffeeService");

const SERVICE_FEE_BASIS_POINTS = 800;
const TAX_BASIS_POINTS = 1200;
const DELIVERY_FEE_CENTS = 4900;

function badRequest(message) {
    return Object.assign(new Error(message), { statusCode: 400 });
}

function roundBasisPoints(amountCents, basisPoints) {
    return Math.round(amountCents * basisPoints / 10000);
}

function calculateDrinkPriceCents(configuration) {
    const baseCents = 25000 + Math.max(0, Math.ceil((configuration.volumeMl - 240) / 120)) * 2800;
    const extraShotCents = Math.max(0, configuration.shots - 2) * 5500;
    const milkModifierCents = configuration.milk === "oat" ? 3900 : configuration.milk === "almond" ? 2800 : 0;
    const syrupModifierCents = Object.values(configuration.syrups).reduce((total, pumps) => total + pumps * 2500, 0);
    return baseCents + extraShotCents + milkModifierCents + syrupModifierCents;
}

function calculateOrderPricing(items, fulfillmentMethod, tipPercent = 15) {
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
        const name = typeof item.name === "string" && item.name.trim()
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
    const tipCents = Math.round(subtotalCents * tipPercent / 100);

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

module.exports = { calculateDrinkPriceCents, calculateOrderPricing };
