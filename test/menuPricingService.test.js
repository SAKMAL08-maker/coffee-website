const test = require("node:test");
const assert = require("node:assert/strict");
const { calculateDrinkPriceCents } = require("../services/pricingService");
const { DEFAULT_MENU_PRICES, ALLOWED_PRICE_KEYS, CACHE_TTL_MS } = require("../services/menuPricingService");

const baseDrink = {
    volumeMl: 240,
    shots: 2,
    milk: "whole",
    syrups: { vanilla: 0, caramel: 0, chocolate: 0 }
};

test("preserves existing hardcoded prices as safe fallback defaults", () => {
    assert.equal(calculateDrinkPriceCents(baseDrink), 25000);
    assert.equal(DEFAULT_MENU_PRICES.delivery_fee_cents, 4900);
    assert.equal(DEFAULT_MENU_PRICES.service_fee_basis_points, 800);
    assert.equal(DEFAULT_MENU_PRICES.tax_basis_points, 1200);
    assert.ok(CACHE_TTL_MS > 0);
});

test("pricing formula accepts a menu-price override and restricts editable keys", () => {
    assert.equal(calculateDrinkPriceCents(baseDrink, {
        ...DEFAULT_MENU_PRICES,
        base_price_cents: 30000
    }), 30000);
    assert.equal(ALLOWED_PRICE_KEYS.has("base_price_cents"), true);
    assert.equal(ALLOWED_PRICE_KEYS.has("arbitrary_sql"), false);
});
