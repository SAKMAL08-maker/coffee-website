const BASES = {
    espresso: { label: "Espresso", caffeine: 64, calories: 3, sugar: 0 },
    drip: { label: "Filter coffee", caffeine: 80, calories: 2, sugar: 0 },
    coldBrew: { label: "Cold brew", caffeine: 100, calories: 5, sugar: 0 },
    matcha: { label: "Matcha", caffeine: 70, calories: 6, sugar: 0 }
};

const MILKS = {
    whole: { label: "Whole milk", calories: 0.62, sugar: 0.05 },
    skim: { label: "Skim milk", calories: 0.35, sugar: 0.05 },
    oat: { label: "Oat milk", calories: 0.5, sugar: 0.04 },
    almond: { label: "Almond milk", calories: 0.18, sugar: 0.01 }
};

const SYRUPS = {
    vanilla: { label: "Vanilla syrup", calories: 20, sugar: 5, volumeMl: 7 },
    caramel: { label: "Caramel sauce", calories: 25, sugar: 6, volumeMl: 7 },
    chocolate: { label: "Dark chocolate mocha", calories: 28, sugar: 5, volumeMl: 8 }
};

const SWEETENERS = {
    whiteSugar: { calories: 16, sugar: 4 },
    rawSugar: { calories: 16, sugar: 4 },
    honey: { calories: 21, sugar: 5.7 },
    stevia: { calories: 0, sugar: 0 }
};

const ENUMS = {
    base: Object.keys(BASES),
    caffeineMode: ["regular", "decaf", "half"],
    extraction: ["ristretto", "standard", "lungo"],
    temperature: ["hot", "iced", "blended"],
    iceStyle: ["cube", "coffee", "crushed"],
    milk: Object.keys(MILKS),
    sweeteners: Object.keys(SWEETENERS)
};

const DEFAULT_CONFIGURATION = {
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
};

function createBadRequest(message) {
    return Object.assign(new Error(message), { statusCode: 400 });
}

function validateKeys(value, allowedKeys, label) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw createBadRequest(`${label} must be an object.`);
    }
    const unexpectedKey = Object.keys(value).find((key) => !allowedKeys.includes(key));
    if (unexpectedKey) throw createBadRequest(`${label} contains an unsupported field: ${unexpectedKey}.`);
}

function normalizeConfiguration(input) {
    validateKeys(input, Object.keys(DEFAULT_CONFIGURATION), "configuration");
    if (
        input.syrups !== undefined &&
        (!input.syrups || typeof input.syrups !== "object" || Array.isArray(input.syrups))
    ) {
        throw createBadRequest("configuration.syrups must be an object.");
    }
    if (
        input.toppings !== undefined &&
        (!input.toppings || typeof input.toppings !== "object" || Array.isArray(input.toppings))
    ) {
        throw createBadRequest("configuration.toppings must be an object.");
    }
    if (input.sweeteners !== undefined && !Array.isArray(input.sweeteners)) {
        throw createBadRequest("configuration.sweeteners must be an array.");
    }
    const configuration = {
        ...DEFAULT_CONFIGURATION,
        ...input,
        syrups: { ...DEFAULT_CONFIGURATION.syrups, ...(input.syrups === undefined ? {} : input.syrups) },
        toppings: { ...DEFAULT_CONFIGURATION.toppings, ...(input.toppings === undefined ? {} : input.toppings) },
        sweeteners: input.sweeteners ? [...input.sweeteners] : []
    };

    for (const field of ["base", "caffeineMode", "extraction", "temperature", "iceStyle", "milk"]) {
        if (!ENUMS[field].includes(configuration[field])) {
            throw createBadRequest(`configuration.${field} is not supported.`);
        }
    }

    for (const [field, min, max] of [
        ["volumeMl", 60, 480],
        ["shots", 1, 4],
        ["foam", 0, 100]
    ]) {
        if (!Number.isInteger(configuration[field]) || configuration[field] < min || configuration[field] > max) {
            throw createBadRequest(`configuration.${field} must be an integer from ${min} to ${max}.`);
        }
    }

    validateKeys(configuration.syrups, Object.keys(SYRUPS), "configuration.syrups");
    for (const [name, pumps] of Object.entries(configuration.syrups)) {
        if (!Number.isInteger(pumps) || pumps < 0 || pumps > 6) {
            throw createBadRequest(`configuration.syrups.${name} must be an integer from 0 to 6.`);
        }
    }

    validateKeys(configuration.toppings, ["cinnamon", "whippedCream", "cocoa"], "configuration.toppings");
    for (const [name, enabled] of Object.entries(configuration.toppings)) {
        if (typeof enabled !== "boolean") {
            throw createBadRequest(`configuration.toppings.${name} must be true or false.`);
        }
    }

    if (
        !Array.isArray(configuration.sweeteners) ||
        configuration.sweeteners.some((item) => !ENUMS.sweeteners.includes(item))
    ) {
        throw createBadRequest("configuration.sweeteners contains an unsupported sweetener.");
    }

    return configuration;
}

function getComposition(configuration) {
    const shotVolume = { ristretto: 22, standard: 30, lungo: 40 }[configuration.extraction];
    const baseMl = configuration.base === "espresso" ? configuration.shots * shotVolume : 0;
    const syrupMl = Object.entries(configuration.syrups).reduce(
        (total, [name, pumps]) => total + pumps * SYRUPS[name].volumeMl,
        0
    );
    const milkTotal =
        configuration.base === "espresso"
            ? Math.max(0, configuration.volumeMl - baseMl - syrupMl)
            : configuration.base === "matcha"
              ? Math.max(0, configuration.volumeMl - syrupMl) * 0.3
              : 0;
    const foamMl = ((milkTotal * configuration.foam) / 100) * 0.6;
    const milkMl = milkTotal - foamMl;
    const otherBaseMl =
        configuration.base === "espresso" ? 0 : Math.max(0, configuration.volumeMl - syrupMl - milkTotal);
    return { baseMl, milkMl, foamMl, syrupMl, otherBaseMl };
}

function classifyDrink(configuration, composition = getComposition(configuration)) {
    const hasExtras =
        Object.values(configuration.syrups).some(Boolean) ||
        configuration.sweeteners.length > 0 ||
        Object.values(configuration.toppings).some(Boolean);

    if (configuration.base === "drip" && configuration.temperature === "hot" && !hasExtras) return "Americano";
    if (configuration.base === "matcha") return "Matcha";
    if (configuration.base === "coldBrew") return "Cold Brew";
    if (configuration.base !== "espresso" || configuration.temperature !== "hot" || hasExtras)
        return "Custom Concoction";

    const { baseMl, milkMl, foamMl } = composition;
    if (!baseMl) return "Custom Concoction";
    const ratio = (milkMl + foamMl) / baseMl;
    const foamRatio = foamMl / (milkMl + foamMl || 1);
    if (ratio < 0.65 && foamRatio > 0.45) return "Macchiato";
    if (ratio >= 0.8 && ratio <= 1.2 && foamRatio < 0.3) return "Cortado";
    if (ratio >= 1.4 && ratio <= 2.6 && foamRatio >= 0.38) return "Cappuccino";
    if (ratio >= 1.4 && ratio <= 2.6 && foamRatio < 0.38) return "Flat White";
    if (ratio > 2.6 && foamRatio < 0.48) return "Latte";
    if (ratio < 0.2) return "Espresso";
    return "Custom Concoction";
}

function calculateNutrition(configuration) {
    const composition = getComposition(configuration);
    const base = BASES[configuration.base];
    const caffeineFactor =
        configuration.caffeineMode === "decaf" ? 0.05 : configuration.caffeineMode === "half" ? 0.5 : 1;
    const caffeine =
        configuration.base === "espresso"
            ? base.caffeine * configuration.shots
            : (base.caffeine * configuration.volumeMl) / 240;
    let calories = base.calories + (composition.milkMl * MILKS[configuration.milk].calories) / 100;
    let sugar = (composition.milkMl * MILKS[configuration.milk].sugar) / 100;

    Object.entries(configuration.syrups).forEach(([name, pumps]) => {
        calories += SYRUPS[name].calories * pumps;
        sugar += SYRUPS[name].sugar * pumps;
    });
    configuration.sweeteners.forEach((name) => {
        calories += SWEETENERS[name].calories;
        sugar += SWEETENERS[name].sugar;
    });
    if (configuration.toppings.whippedCream) {
        calories += 50;
        sugar += 3;
    }

    return {
        caffeineMg: Math.round(caffeine * caffeineFactor),
        calories: Math.round(calories),
        sugarGrams: Math.round(sugar * 10) / 10
    };
}

module.exports = {
    BASES,
    MILKS,
    SYRUPS,
    // Every menu option (menuService builds the sold-out switches from these).
    MENU: Object.freeze({ BASES, MILKS, SYRUPS, SWEETENERS }),
    DEFAULT_CONFIGURATION,
    normalizeConfiguration,
    getComposition,
    classifyDrink,
    calculateNutrition
};
