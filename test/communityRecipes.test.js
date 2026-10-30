const test = require("node:test");
const assert = require("node:assert/strict");

// Fake Supabase: a coffees table holding published recipes, plus a recorder for
// create_coffee_order so tests can see exactly which royalties checkout would save.
const supabaseConfigPath = require.resolve("../config/supabase");
const CREATOR_ID = "0b6f1f4e-2c1d-4c55-9a51-6f7f3d2a9e11";
const BUYER_ID = "7a1e3c55-8d0b-4b8e-9f43-2b9c6d1e0a77";
const RECIPE_ID = "5f2d8c1a-3b4e-4f60-8a7b-9c0d1e2f3a4b";
const RECIPE_SLUG = "Ab3dEf7hJk";
const recipeConfiguration = {
    base: "espresso",
    shots: 3,
    milk: "oat",
    syrups: { vanilla: 2, caramel: 0, chocolate: 0 }
};
const fakeDatabase = { recipes: [], orderCalls: [], failRecipeLookup: false, sessionUserId: null };

function createFakeSupabaseClient() {
    return {
        from(table) {
            const query = {
                filters: {},
                select: () => query,
                in(column, values) {
                    query.filters.in = values;
                    return query;
                },
                not: () => query,
                eq(column, value) {
                    query.filters[column] = value;
                    return query;
                },
                order: () => query,
                limit: () => query,
                async then(resolve) {
                    if (table !== "coffees") return resolve({ data: [], error: null });
                    if (fakeDatabase.failRecipeLookup) return resolve({ data: null, error: new Error("db down") });
                    const rows = fakeDatabase.recipes.filter((recipe) => query.filters.in.includes(recipe.public_slug));
                    return resolve({ data: rows, error: null });
                },
                update(values) {
                    query.pendingUpdate = values;
                    return query;
                },
                async maybeSingle() {
                    const row = fakeDatabase.recipes.find(
                        (recipe) =>
                            recipe.public_slug === query.filters.public_slug &&
                            (query.filters.account_id === undefined || recipe.account_id === query.filters.account_id)
                    );
                    if (query.pendingUpdate) {
                        if (row) Object.assign(row, query.pendingUpdate);
                        return { data: row ? { id: row.id } : null, error: null };
                    }
                    return { data: row ? { ...row, coffee_users: { username: "creator" } } : null, error: null };
                }
            };
            return query;
        },
        async rpc(name, parameters) {
            fakeDatabase.orderCalls.push({ name, parameters });
            return { data: "9d6c8b7a-1e2f-4a3b-8c5d-6e7f8a9b0c1d", error: null };
        }
    };
}
require.cache[supabaseConfigPath] = {
    id: supabaseConfigPath,
    filename: supabaseConfigPath,
    loaded: true,
    exports: {
        getAdminClient: createFakeSupabaseClient,
        createServerAuthClient: createFakeSupabaseClient,
        assertSupabaseConfig() {}
    }
};

const {
    ROYALTY_POINTS_PER_DRINK,
    createRecipeSlug,
    isValidRecipeSlug,
    isSameDrink,
    calculateRoyaltyAttributions
} = require("../services/communityRecipeService");
const { buildRecipeShareUrl, createRecipeQrSvg } = require("../services/recipeQrCode");
const { checkout } = require("../controllers/orderController");
const { app } = require("../server");

const publishedRecipe = { id: RECIPE_ID, account_id: CREATOR_ID, configuration: recipeConfiguration };
const recipesBySlug = new Map([[RECIPE_SLUG, publishedRecipe]]);

test.beforeEach((t) => {
    // Checkout tries to build a receipt, which fails against this fake database; that path is tested elsewhere.
    t.mock.method(console, "error", () => {});
    fakeDatabase.recipes = [
        {
            ...publishedRecipe,
            public_slug: RECIPE_SLUG,
            name: "Oat vanilla triple",
            classification: "Latte",
            nutrition: {},
            published_at: "2026-10-30T10:00:00.000Z"
        }
    ];
    fakeDatabase.orderCalls = [];
    fakeDatabase.failRecipeLookup = false;
});

test("slugs are 10 random alphanumerics and validated strictly", () => {
    const slugs = new Set(Array.from({ length: 500 }, createRecipeSlug));
    assert.equal(slugs.size, 500);
    for (const slug of slugs) assert.ok(isValidRecipeSlug(slug), slug);
    for (const bad of ["short", "Ab3dEf7hJk1", "Ab3dEf7hJ!", "../etc/pas", "", null, 12345]) {
        assert.equal(isValidRecipeSlug(bad), false, String(bad));
    }
});

test("same drink regardless of key order or omitted defaults", () => {
    const reordered = { syrups: { chocolate: 0, vanilla: 2 }, milk: "oat", shots: 3, base: "espresso" };
    assert.ok(isSameDrink(recipeConfiguration, reordered));
    assert.equal(isSameDrink(recipeConfiguration, { ...recipeConfiguration, shots: 4 }), false);
    assert.equal(isSameDrink(recipeConfiguration, { base: "not-a-base" }), false);
});

test("another customer ordering the exact recipe earns the creator a royalty", () => {
    const [attribution] = calculateRoyaltyAttributions(
        [{ configuration: recipeConfiguration, recipeSlug: RECIPE_SLUG }],
        recipesBySlug,
        BUYER_ID
    );
    assert.deepEqual(attribution, {
        source_coffee_id: RECIPE_ID,
        royalty_account_id: CREATOR_ID,
        royalty_points: ROYALTY_POINTS_PER_DRINK
    });
});

test("guests ordering a shared recipe also earn the creator a royalty", () => {
    const [attribution] = calculateRoyaltyAttributions(
        [{ configuration: recipeConfiguration, recipeSlug: RECIPE_SLUG }],
        recipesBySlug,
        null
    );
    assert.equal(attribution.royalty_points, ROYALTY_POINTS_PER_DRINK);
});

test("no self-royalty: the creator ordering their own recipe earns nothing", () => {
    const [attribution] = calculateRoyaltyAttributions(
        [{ configuration: recipeConfiguration, recipeSlug: RECIPE_SLUG }],
        recipesBySlug,
        CREATOR_ID
    );
    assert.deepEqual(attribution, { source_coffee_id: RECIPE_ID, royalty_account_id: null, royalty_points: 0 });
});

test("a modified drink, unknown slug, or missing slug earns nothing", () => {
    const attributions = calculateRoyaltyAttributions(
        [
            { configuration: { ...recipeConfiguration, shots: 4 }, recipeSlug: RECIPE_SLUG },
            { configuration: recipeConfiguration, recipeSlug: "Zz9yXx8wVv" },
            { configuration: recipeConfiguration }
        ],
        recipesBySlug,
        BUYER_ID
    );
    for (const attribution of attributions) {
        assert.deepEqual(attribution, { source_coffee_id: null, royalty_account_id: null, royalty_points: 0 });
    }
});

test("each drink earns separately, so two of the recipe earn two royalties", () => {
    const item = { configuration: recipeConfiguration, recipeSlug: RECIPE_SLUG };
    const total = calculateRoyaltyAttributions([item, item], recipesBySlug, BUYER_ID).reduce(
        (sum, attribution) => sum + attribution.royalty_points,
        0
    );
    assert.equal(total, ROYALTY_POINTS_PER_DRINK * 2);
});

test("share URL prefers PUBLIC_APP_URL over the request host; QR is an SVG", () => {
    assert.equal(
        buildRecipeShareUrl(RECIPE_SLUG, "http://evil.example", "https://coffee.example/"),
        `https://coffee.example/?recipe=${RECIPE_SLUG}`
    );
    assert.equal(
        buildRecipeShareUrl(RECIPE_SLUG, "http://localhost:3000", ""),
        `http://localhost:3000/?recipe=${RECIPE_SLUG}`
    );
    assert.match(createRecipeQrSvg(`https://coffee.example/?recipe=${RECIPE_SLUG}`), /^<svg[\s\S]*<\/svg>$/);
});

async function callCheckout(items, user) {
    let forwardedError;
    const response = {
        statusCode: 200,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(payload) {
            this.body = payload;
            return this;
        }
    };
    await checkout(
        {
            body: {
                items,
                fulfillmentMethod: "pickup",
                tipPercent: 0,
                customer: { name: "Buyer", phone: "09170000000" }
            },
            user
        },
        response,
        (error) => {
            forwardedError = error;
        }
    );
    if (forwardedError) throw forwardedError;
    return fakeDatabase.orderCalls.at(-1).parameters.item_data;
}

test("checkout saves the royalty on the order item, in the same RPC as the order", async () => {
    const [savedItem] = await callCheckout([{ configuration: recipeConfiguration, recipeSlug: RECIPE_SLUG }], {
        id: BUYER_ID
    });
    assert.equal(fakeDatabase.orderCalls.length, 1);
    assert.equal(savedItem.royalty_account_id, CREATOR_ID);
    assert.equal(savedItem.royalty_points, ROYALTY_POINTS_PER_DRINK);
    assert.equal(savedItem.source_coffee_id, RECIPE_ID);
    assert.equal(savedItem.recipeSlug, undefined, "the raw client field is not stored");
});

test("checkout price is identical with or without a recipe slug", async () => {
    const [withSlug] = await callCheckout([{ configuration: recipeConfiguration, recipeSlug: RECIPE_SLUG }], {
        id: BUYER_ID
    });
    const [withoutSlug] = await callCheckout([{ configuration: recipeConfiguration }], { id: BUYER_ID });
    assert.equal(withSlug.price_cents, withoutSlug.price_cents);
});

test("checkout still succeeds without royalties if the recipe lookup fails", async () => {
    fakeDatabase.failRecipeLookup = true;
    const [savedItem] = await callCheckout([{ configuration: recipeConfiguration, recipeSlug: RECIPE_SLUG }], {
        id: BUYER_ID
    });
    assert.equal(savedItem.royalty_points, 0);
    assert.equal(fakeDatabase.orderCalls.length, 1);
});

test("recipe routes: public read, QR, validation, auth, rate limits", async () => {
    const server = app.listen(0);
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    try {
        const found = await fetch(`${baseUrl}/api/recipes/${RECIPE_SLUG}`);
        assert.equal(found.status, 200);
        assert.ok(found.headers.get("ratelimit-policy"));
        const { recipe } = await found.json();
        assert.equal(recipe.slug, RECIPE_SLUG);
        assert.equal(recipe.creatorUsername, "creator");
        assert.match(recipe.shareUrl, new RegExp(`\\?recipe=${RECIPE_SLUG}$`));
        assert.equal(recipe.account_id, undefined, "creator account id is never exposed");
        assert.equal(recipe.id, undefined, "internal coffee id is never exposed");

        const qr = await fetch(`${baseUrl}/api/recipes/${RECIPE_SLUG}/qr.svg`);
        assert.equal(qr.status, 200);
        assert.match(qr.headers.get("content-type"), /image\/svg\+xml/);

        assert.equal((await fetch(`${baseUrl}/api/recipes/Zz9yXx8wVv`)).status, 404);
        assert.equal((await fetch(`${baseUrl}/api/recipes/Zz9yXx8wVv/qr.svg`)).status, 404);
        assert.equal((await fetch(`${baseUrl}/api/recipes/bad-slug`)).status, 400);
        assert.equal((await fetch(`${baseUrl}/api/recipes/mine`)).status, 401);

        const publish = await fetch(`${baseUrl}/api/recipes`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: "Mine", configuration: recipeConfiguration })
        });
        assert.equal(publish.status, 401);

        const smuggledSlug = await fetch(`${baseUrl}/api/orders/quote`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                items: [{ configuration: recipeConfiguration, recipeSlug: "../../etc" }],
                fulfillmentMethod: "pickup"
            })
        });
        assert.equal(smuggledSlug.status, 400);
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
});

test("only the creator can unpublish; the recipe then disappears from public links", async () => {
    const { unpublishRecipe, getPublishedRecipe } = require("../services/communityRecipeService");
    const { getAdminClient } = require("../config/supabase");
    const supabase = getAdminClient();

    assert.equal(await unpublishRecipe(supabase, BUYER_ID, RECIPE_SLUG), false, "a non-owner cannot unpublish");
    assert.ok(await getPublishedRecipe(supabase, RECIPE_SLUG));

    assert.equal(await unpublishRecipe(supabase, CREATOR_ID, RECIPE_SLUG), true);
    assert.equal(fakeDatabase.recipes[0].public_slug, null);
    assert.equal(fakeDatabase.recipes[0].published_at, null, "slug and published_at cleared together (DB check)");
    assert.equal(fakeDatabase.recipes[0].id, RECIPE_ID, "the row is kept so earned royalties stay attributed");
    assert.equal(await getPublishedRecipe(supabase, RECIPE_SLUG), null);
});

test("DELETE /api/recipes/:slug requires authentication", async () => {
    const server = app.listen(0);
    try {
        const response = await fetch(`http://127.0.0.1:${server.address().port}/api/recipes/${RECIPE_SLUG}`, {
            method: "DELETE"
        });
        assert.equal(response.status, 401);
        assert.ok(response.headers.get("ratelimit-policy"));
        assert.ok(fakeDatabase.recipes[0].public_slug, "nothing changed");
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
});
