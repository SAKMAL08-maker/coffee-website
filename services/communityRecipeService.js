const crypto = require("crypto");
const { normalizeConfiguration, classifyDrink, calculateNutrition } = require("./coffeeService");

/**
 * Community recipes: customers publish a drink under a short public slug; anyone
 * can open /?recipe=<slug> and order it; the creator earns loyalty points.
 *
 * Royalty rules (all decided here, on the server):
 *   1. A drink earns a royalty only if its configuration is EXACTLY the published
 *      recipe. Attaching a slug to a different drink earns nothing.
 *   2. No self-royalty: ordering your own recipe earns nothing.
 *   3. Points are attached to the order item when the order is created, inside the
 *      same database transaction, so they can never be counted twice.
 *   4. Points count as "earned" only after the order's cash is collected
 *      (see recipe_royalty_summary in the migration), so unpaid orders earn nothing.
 */
const ROYALTY_POINTS_PER_DRINK = 10;
const RECIPE_SLUG_LENGTH = 10;
const SLUG_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const RECIPE_SLUG_PATTERN = /^[A-Za-z0-9]{10}$/;
const MAX_SLUG_ATTEMPTS = 3;
const UNIQUE_VIOLATION = "23505";
const PUBLIC_RECIPE_COLUMNS = "public_slug, name, configuration, classification, nutrition, published_at";

/** Random, unguessable slug. Rejection sampling keeps every character equally likely. */
function createRecipeSlug() {
    let slug = "";
    while (slug.length < RECIPE_SLUG_LENGTH) {
        for (const byte of crypto.randomBytes(RECIPE_SLUG_LENGTH * 2)) {
            // 248 = 4 × 62: bytes at or above it would bias the first characters.
            if (byte < 248 && slug.length < RECIPE_SLUG_LENGTH) slug += SLUG_ALPHABET[byte % 62];
        }
    }
    return slug;
}

function isValidRecipeSlug(slug) {
    return typeof slug === "string" && RECIPE_SLUG_PATTERN.test(slug);
}

/** True when two configurations describe the same drink after normalization. */
function isSameDrink(configurationA, configurationB) {
    try {
        return (
            JSON.stringify(normalizeConfiguration(configurationA)) ===
            JSON.stringify(normalizeConfiguration(configurationB))
        );
    } catch {
        return false;
    }
}

/**
 * Pure royalty decision for each checkout item (same order as `items`).
 * `publishedRecipesBySlug` maps slug → { id, account_id, configuration }.
 * Returns the snake_case keys that create_coffee_order stores on order_items.
 */
function calculateRoyaltyAttributions(items, publishedRecipesBySlug, buyerAccountId) {
    return items.map((item) => {
        const noRoyalty = { source_coffee_id: null, royalty_account_id: null, royalty_points: 0 };
        const recipe = item.recipeSlug ? publishedRecipesBySlug.get(item.recipeSlug) : undefined;
        if (!recipe) return noRoyalty;
        if (!isSameDrink(item.configuration, recipe.configuration)) return noRoyalty;
        const isSelfOrder = Boolean(buyerAccountId) && buyerAccountId === recipe.account_id;
        if (isSelfOrder || !recipe.account_id) return { ...noRoyalty, source_coffee_id: recipe.id };
        return {
            source_coffee_id: recipe.id,
            royalty_account_id: recipe.account_id,
            royalty_points: ROYALTY_POINTS_PER_DRINK
        };
    });
}

/** One query for all slugs in a cart. Unknown or unpublished slugs are simply absent. */
async function findPublishedRecipesBySlugs(supabase, slugs) {
    const validSlugs = [...new Set(slugs.filter(isValidRecipeSlug))];
    if (!validSlugs.length) return new Map();
    const { data, error } = await supabase
        .from("coffees")
        .select("id, account_id, configuration, public_slug")
        .in("public_slug", validSlugs)
        .not("published_at", "is", null);
    if (error) throw error;
    return new Map(data.map((recipe) => [recipe.public_slug, recipe]));
}

/**
 * Royalty attribution for checkout. Royalties are a bonus, never a reason to
 * lose a sale: if the lookup fails, the order proceeds without royalties.
 */
async function resolveRecipeRoyalties(supabase, items, buyerAccountId) {
    const slugs = items.map((item) => item.recipeSlug).filter(Boolean);
    if (!slugs.length) return calculateRoyaltyAttributions(items, new Map(), buyerAccountId);
    try {
        const recipesBySlug = await findPublishedRecipesBySlugs(supabase, slugs);
        return calculateRoyaltyAttributions(items, recipesBySlug, buyerAccountId);
    } catch (error) {
        console.error("Recipe royalty lookup failed; continuing checkout without royalties:", {
            errorName: error.name,
            errorMessage: error.message
        });
        return calculateRoyaltyAttributions(items, new Map(), buyerAccountId);
    }
}

function toPublicRecipe(row) {
    return {
        slug: row.public_slug,
        name: row.name,
        configuration: row.configuration,
        classification: row.classification,
        nutrition: row.nutrition,
        publishedAt: row.published_at,
        creatorUsername: row.coffee_users?.username || null
    };
}

/**
 * Saves the drink to the creator's coffees and publishes it in one insert.
 * Retries on the (astronomically rare) slug collision.
 */
async function publishRecipe(supabase, accountId, { name, configuration }) {
    const normalizedConfiguration = normalizeConfiguration(configuration);
    for (let attempt = 1; attempt <= MAX_SLUG_ATTEMPTS; attempt += 1) {
        const publishedAt = new Date().toISOString();
        const { data, error } = await supabase
            .from("coffees")
            .insert({
                account_id: accountId,
                name,
                configuration: normalizedConfiguration,
                classification: classifyDrink(normalizedConfiguration),
                nutrition: calculateNutrition(normalizedConfiguration),
                public_slug: createRecipeSlug(),
                published_at: publishedAt
            })
            .select(PUBLIC_RECIPE_COLUMNS)
            .single();
        if (!error) return toPublicRecipe(data);
        if (error.code !== UNIQUE_VIOLATION || attempt === MAX_SLUG_ATTEMPTS) throw error;
    }
    throw new Error("Could not allocate a recipe slug.");
}

async function getPublishedRecipe(supabase, slug) {
    const { data, error } = await supabase
        .from("coffees")
        .select(`${PUBLIC_RECIPE_COLUMNS}, coffee_users(username)`)
        .eq("public_slug", slug)
        .not("published_at", "is", null)
        .maybeSingle();
    if (error) throw error;
    return data ? toPublicRecipe(data) : null;
}

/**
 * Makes a recipe private again. The coffee row is kept, so order items keep their
 * source_coffee_id and royalties already earned are unaffected. Only the creator can
 * unpublish; for anyone else the recipe "doesn't exist" (returns false → 404).
 */
async function unpublishRecipe(supabase, accountId, slug) {
    const { data, error } = await supabase
        .from("coffees")
        .update({ public_slug: null, published_at: null, updated_at: new Date().toISOString() })
        .eq("public_slug", slug)
        .eq("account_id", accountId)
        .select("id")
        .maybeSingle();
    if (error) throw error;
    return Boolean(data);
}

async function listCreatorRecipes(supabase, accountId) {
    const [recipesResult, summaryResult] = await Promise.all([
        supabase
            .from("coffees")
            .select(PUBLIC_RECIPE_COLUMNS)
            .eq("account_id", accountId)
            .not("published_at", "is", null)
            .order("published_at", { ascending: false })
            .limit(50),
        supabase.rpc("recipe_royalty_summary", { p_account_id: accountId }).maybeSingle()
    ]);
    if (recipesResult.error) throw recipesResult.error;
    if (summaryResult.error) throw summaryResult.error;
    const summary = summaryResult.data || {};
    return {
        recipes: recipesResult.data.map(toPublicRecipe),
        royalties: {
            earnedPoints: Number(summary.earned_points) || 0,
            pendingPoints: Number(summary.pending_points) || 0,
            earnedDrinks: Number(summary.earned_drinks) || 0,
            pointsPerDrink: ROYALTY_POINTS_PER_DRINK
        }
    };
}

module.exports = {
    ROYALTY_POINTS_PER_DRINK,
    RECIPE_SLUG_PATTERN,
    createRecipeSlug,
    isValidRecipeSlug,
    isSameDrink,
    calculateRoyaltyAttributions,
    resolveRecipeRoyalties,
    publishRecipe,
    getPublishedRecipe,
    unpublishRecipe,
    listCreatorRecipes
};
