const { normalizeConfiguration, classifyDrink, calculateNutrition } = require("./coffeeService");
const { DEFAULT_MENU_PRICES, getMenuPricing } = require("./menuPricingService");

function badRequest(message) {
    return Object.assign(new Error(message), { statusCode: 400 });
}

function roundBasisPoints(amountCents, basisPoints) {
    return Math.round(amountCents * basisPoints / 10000);
}

function calculateDrinkPriceCents(configuration, prices = DEFAULT_MENU_PRICES) {
    const baseCents = prices.base_price_cents
        + Math.max(0, Math.ceil((configuration.volumeMl - 240) / 120)) * prices.volume_step_cents;
    const extraShotCents = Math.max(0, configuration.shots - 2) * prices.extra_shot_cents;
    const milkModifierCents = configuration.milk === "oat" ? prices.oat_milk_cents
        : configuration.milk === "almond" ? prices.almond_milk_cents : 0;
    const syrupModifierCents = Object.values(configuration.syrups)
        .reduce((total, pumps) => total + pumps * prices.syrup_pump_cents, 0);
    return baseCents + extraShotCents + milkModifierCents + syrupModifierCents;
}

async function calculateOrderPricing(items, fulfillmentMethod, tipPercent = 15) {
    if (!Array.isArray(items) || items.length < 1 || items.length > 20) {
        throw badRequest("An order must contain between 1 and 20 drinks.");
    }
    if (!["delivery", "pickup"].includes(fulfillmentMethod)) {
        throw badRequest("fulfillmentMethod must be delivery or pickup.");
    }
    if (typeof tipPercent !== "number" || !Number.isFinite(tipPercent) || tipPercent < 0 || tipPercent > 100) {
        throw badRequest("tipPercent must be a number from 0 to 100.");
    }

    const menuPrices = await getMenuPricing();
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
            price_cents: calculateDrinkPriceCents(configuration, menuPrices)
        };
    });

    const subtotalCents = lineItems.reduce((total, item) => total + item.price_cents, 0);
    const deliveryFeeCents = fulfillmentMethod === "delivery" ? menuPrices.delivery_fee_cents : 0;
    const serviceFeeCents = roundBasisPoints(subtotalCents, menuPrices.service_fee_basis_points);
    const taxCents = roundBasisPoints(subtotalCents, menuPrices.tax_basis_points);
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
