const Coffee = require("../models/Coffee");
const {
    normalizeConfiguration,
    getComposition,
    classifyDrink,
    calculateNutrition
} = require("../services/coffeeService");

function validateQuoteRequest(body) {
    if (!body || typeof body !== "object" || Array.isArray(body)
        || Object.keys(body).some((key) => key !== "configuration")) {
        throw Object.assign(new Error("Request must contain only a configuration object."), { statusCode: 400 });
    }
}

async function createQuote(request, response, next) {
    try {
        validateQuoteRequest(request.body);
        const configuration = normalizeConfiguration(request.body.configuration);
        const composition = getComposition(configuration);
        response.json({
            configuration,
            classification: classifyDrink(configuration, composition),
            nutrition: calculateNutrition(configuration)
        });
    } catch (error) {
        next(error);
    }
}

async function saveCoffee(request, response, next) {
    try {
        if (!request.body || typeof request.body !== "object" || Array.isArray(request.body)
            || Object.keys(request.body).some((key) => !["name", "configuration"].includes(key))) {
            throw Object.assign(new Error("Request contains an unsupported field."), { statusCode: 400 });
        }
        const configuration = normalizeConfiguration(request.body.configuration);
        const composition = getComposition(configuration);
        const coffee = await Coffee.create({
            userId: request.user.id,
            name: typeof request.body.name === "string" ? request.body.name.trim() : "Custom Coffee",
            configuration,
            classification: classifyDrink(configuration, composition),
            nutrition: calculateNutrition(configuration)
        });
        response.status(201).json({ coffee });
    } catch (error) {
        next(error);
    }
}

async function listSavedCoffees(request, response, next) {
    try {
        const coffees = await Coffee.find({ userId: request.user.id }).sort({ createdAt: -1 });
        response.json({ coffees });
    } catch (error) {
        next(error);
    }
}

module.exports = { createQuote, saveCoffee, listSavedCoffees };
