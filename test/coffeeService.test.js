const test = require("node:test");
const assert = require("node:assert/strict");
const {
    DEFAULT_CONFIGURATION,
    normalizeConfiguration,
    classifyDrink,
    calculateNutrition
} = require("../services/coffeeService");

test("normalizes defaults and computes a latte quote", () => {
    const configuration = normalizeConfiguration({});
    assert.equal(configuration.volumeMl, 240);
    assert.equal(classifyDrink(configuration), "Latte");
    assert.deepEqual(calculateNutrition(configuration), {
        caffeineMg: 128,
        calories: 4,
        sugarGrams: 0.1
    });
});

test("rejects invalid nested values rather than silently defaulting them", () => {
    assert.throws(() => normalizeConfiguration({ syrups: null }), /syrups must be an object/);
    assert.throws(() => normalizeConfiguration({ toppings: { cinnamon: "yes" } }), /must be true or false/);
    assert.throws(() => normalizeConfiguration({ volumeMl: 900 }), /volumeMl must be an integer/);
});

test("does not mutate the shared configuration defaults", () => {
    const configuration = normalizeConfiguration({ syrups: { vanilla: 2 } });
    configuration.syrups.vanilla = 4;
    assert.equal(DEFAULT_CONFIGURATION.syrups.vanilla, 0);
});
