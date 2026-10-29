const { getAdminClient } = require("../config/supabase");
const {
    normalizeConfiguration,
    getComposition,
    classifyDrink,
    calculateNutrition
} = require("../services/coffeeService");
const { calculateOrderPricing } = require("../services/pricingService");

function validateBody(body, allowedKeys) {
    if (!body || typeof body !== "object" || Array.isArray(body)
        || Object.keys(body).some((key) => !allowedKeys.includes(key))) {
        throw Object.assign(new Error("Request body is invalid or contains unsupported fields."), { statusCode: 400 });
    }
}

async function createQuote(request, response, next) {
    try {
        validateBody(request.body, ["configuration", "fulfillmentMethod", "tipPercent"]);
        const configuration = normalizeConfiguration(request.body.configuration);
        const composition = getComposition(configuration);
        const fulfillmentMethod = request.body.fulfillmentMethod || "delivery";
        const tipPercent = request.body.tipPercent === undefined ? 15 : request.body.tipPercent;
        const { lineItems, pricing } = await calculateOrderPricing(
            [{ configuration }],
            fulfillmentMethod,
            tipPercent
        );
        response.json({
            configuration,
            classification: classifyDrink(configuration, composition),
            nutrition: calculateNutrition(configuration),
            itemPriceCents: lineItems[0].price_cents,
            pricing
        });
    } catch (error) {
        next(error);
    }
}

async function saveCoffee(request, response, next) {
    try {
        validateBody(request.body, ["name", "configuration"]);
        const name = typeof request.body.name === "string" ? request.body.name.trim() : "Custom Coffee";
        if (!name || name.length > 48) {
            return response.status(400).json({ error: "Coffee name is required and must be 48 characters or fewer." });
        }
        const configuration = normalizeConfiguration(request.body.configuration);
        const composition = getComposition(configuration);
        const { data, error } = await getAdminClient()
            .from("coffees")
            .insert({
                account_id: request.user.id,
                name,
                configuration,
                classification: classifyDrink(configuration, composition),
                nutrition: calculateNutrition(configuration)
            })
            .select("id, name, configuration, classification, nutrition, created_at")
            .single();
        if (error) throw error;
        response.status(201).json({ coffee: data });
    } catch (error) {
        next(error);
    }
}

async function listSavedCoffees(request, response, next) {
    try {
        const { data, error } = await getAdminClient()
            .from("coffees")
            .select("id, name, configuration, classification, nutrition, created_at")
            .eq("account_id", request.user.id)
            .order("created_at", { ascending: false });
        if (error) throw error;
        response.json({ coffees: data });
    } catch (error) {
        next(error);
    }
}

module.exports = { createQuote, saveCoffee, listSavedCoffees };
