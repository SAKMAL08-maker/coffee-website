const { getAdminClient } = require("../config/supabase");

const CACHE_TTL_MS = 60_000;
const DEFAULT_MENU_PRICES = Object.freeze({
    base_price_cents: 25000,
    volume_step_cents: 2800,
    extra_shot_cents: 5500,
    oat_milk_cents: 3900,
    almond_milk_cents: 2800,
    syrup_pump_cents: 2500,
    delivery_fee_cents: 4900,
    service_fee_basis_points: 800,
    tax_basis_points: 1200
});
const ALLOWED_PRICE_KEYS = new Set(Object.keys(DEFAULT_MENU_PRICES));
const DEFAULT_INGREDIENTS = Object.freeze([
    { ingredient_key: "espresso", label: "Espresso", category: "base", metadata: { caffeineMg: 64 } },
    { ingredient_key: "drip", label: "Filter coffee", category: "base", metadata: { caffeineMg: 80 } },
    { ingredient_key: "coldBrew", label: "Cold brew", category: "base", metadata: { caffeineMg: 100 } },
    { ingredient_key: "matcha", label: "Matcha", category: "base", metadata: { caffeineMg: 70 } },
    { ingredient_key: "whole", label: "Whole milk", category: "milk", metadata: {} },
    { ingredient_key: "skim", label: "Skim milk", category: "milk", metadata: {} },
    { ingredient_key: "oat", label: "Oat milk", category: "milk", metadata: {} },
    { ingredient_key: "almond", label: "Almond milk", category: "milk", metadata: {} },
    { ingredient_key: "vanilla", label: "Vanilla syrup", category: "syrup", metadata: {} },
    { ingredient_key: "caramel", label: "Caramel sauce", category: "syrup", metadata: {} },
    { ingredient_key: "chocolate", label: "Dark chocolate mocha", category: "syrup", metadata: {} },
    { ingredient_key: "whiteSugar", label: "White sugar", category: "sweetener", metadata: { calories: 16, sugar: 4 } },
    { ingredient_key: "rawSugar", label: "Raw sugar", category: "sweetener", metadata: { calories: 16, sugar: 4 } },
    { ingredient_key: "honey", label: "Honey", category: "sweetener", metadata: { calories: 21, sugar: 5.7 } },
    { ingredient_key: "stevia", label: "Stevia", category: "sweetener", metadata: { calories: 0, sugar: 0 } },
    { ingredient_key: "cinnamon", label: "Cinnamon", category: "topping", metadata: {} },
    { ingredient_key: "whippedCream", label: "Whipped cream", category: "topping", metadata: {} },
    { ingredient_key: "cocoa", label: "Cocoa", category: "topping", metadata: {} }
]);
let cachedCatalog;
let cacheExpiresAt = 0;

async function getMenuCatalog(now = Date.now()) {
    if (cachedCatalog && now < cacheExpiresAt) return cachedCatalog;
    try {
        const supabase = getAdminClient();
        const [pricesResult, ingredientsResult] = await Promise.all([
            supabase.from("menu_prices").select("price_key, value"),
            supabase.from("ingredients").select("ingredient_key, label, category, metadata, is_available")
                .eq("is_available", true)
        ]);
        if (pricesResult.error) throw pricesResult.error;
        if (ingredientsResult.error) throw ingredientsResult.error;
        const prices = { ...DEFAULT_MENU_PRICES };
        for (const row of pricesResult.data || []) {
            if (ALLOWED_PRICE_KEYS.has(row.price_key) && Number.isInteger(row.value) && row.value >= 0) {
                prices[row.price_key] = row.value;
            }
        }
        cachedCatalog = {
            source: "database",
            prices,
            ingredients: ingredientsResult.data?.length ? ingredientsResult.data : DEFAULT_INGREDIENTS
        };
    } catch {
        // Preserve demo checkout if the optional menu tables are not yet migrated or unavailable.
        cachedCatalog = { source: "fallback", prices: { ...DEFAULT_MENU_PRICES }, ingredients: DEFAULT_INGREDIENTS };
    }
    cacheExpiresAt = now + CACHE_TTL_MS;
    return cachedCatalog;
}

async function getMenuPricing() {
    return (await getMenuCatalog()).prices;
}

async function updateMenuPrice(priceKey, value) {
    if (!ALLOWED_PRICE_KEYS.has(priceKey)) {
        throw Object.assign(new Error("Unsupported menu price key."), { statusCode: 400 });
    }
    if (!Number.isInteger(value) || value < 0 || value > 10000000) {
        throw Object.assign(new Error("Price value must be an integer between 0 and 10000000."), { statusCode: 400 });
    }
    const { error } = await getAdminClient().from("menu_prices").upsert({
        price_key: priceKey,
        value,
        updated_at: new Date().toISOString()
    }, { onConflict: "price_key" });
    if (error) throw error;
    cachedCatalog = undefined;
    cacheExpiresAt = 0;
    return getMenuCatalog();
}

function clearMenuCatalogCache() {
    cachedCatalog = undefined;
    cacheExpiresAt = 0;
}

module.exports = {
    CACHE_TTL_MS,
    DEFAULT_MENU_PRICES,
    ALLOWED_PRICE_KEYS,
    getMenuCatalog,
    getMenuPricing,
    updateMenuPrice,
    clearMenuCatalogCache
};
