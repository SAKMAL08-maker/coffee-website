const test = require("node:test");
const assert = require("node:assert/strict");

// Fake Supabase: today's orders for the customer, and their saved cutoff.
const supabaseConfigPath = require.resolve("../config/supabase");
const ACCOUNT_ID = "0b6f1f4e-2c1d-4c55-9a51-6f7f3d2a9e11";
const fakeDatabase = { orders: [], cutoffTime: null, queries: [] };
function createFakeSupabaseClient() {
    return {
        from(table) {
            const query = {
                filters: [],
                select: () => query,
                eq(column, value) {
                    query.filters.push(["eq", column, value]);
                    return query;
                },
                gte(column, value) {
                    query.filters.push(["gte", column, value]);
                    return query;
                },
                update(values) {
                    query.update = values;
                    return query;
                },
                async then(resolve) {
                    fakeDatabase.queries.push({ table, filters: query.filters });
                    resolve({ data: fakeDatabase.orders, error: null });
                },
                async maybeSingle() {
                    return { data: { caffeine_cutoff_time: fakeDatabase.cutoffTime }, error: null };
                },
                async single() {
                    fakeDatabase.cutoffTime = query.update.caffeine_cutoff_time;
                    return { data: { caffeine_cutoff_time: fakeDatabase.cutoffTime }, error: null };
                }
            };
            return query;
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
    DAILY_CAFFEINE_LIMIT_MG,
    getShopClock,
    parseCutoffMinutes,
    formatCutoff,
    sumCaffeineMg,
    evaluateDrink,
    checkDrinkForCustomer,
    saveCutoffTime
} = require("../services/caffeineGuardianService");
const { calculateNutrition, normalizeConfiguration } = require("../services/coffeeService");
const { app } = require("../server");

// 3 espresso shots = 192 mg regular, 96 mg half-caf.
const tripleShot = { base: "espresso", shots: 3 };
// 10:00 and 16:00 in Manila (UTC+8).
const MORNING = new Date("2026-10-30T02:00:00.000Z");
const AFTERNOON = new Date("2026-10-30T08:00:00.000Z");

test.beforeEach(() => {
    fakeDatabase.orders = [];
    fakeDatabase.cutoffTime = null;
    fakeDatabase.queries = [];
});

test("drink caffeine comes from the same nutrition function checkout stores", () => {
    const result = evaluateDrink({ configuration: tripleShot, todayMg: 0, cutoffTime: null, now: MORNING });
    assert.equal(result.drinkMg, calculateNutrition(normalizeConfiguration(tripleShot)).caffeineMg);
    assert.equal(result.drinkMg, 192);
});

test("'today' starts at midnight Manila time, not the server's UTC midnight", () => {
    // 23:30 UTC on Oct 29 is already 07:30 on Oct 30 in Manila.
    const clock = getShopClock(new Date("2026-10-29T23:30:00.000Z"));
    assert.equal(clock.startOfDayIso, "2026-10-29T16:00:00.000Z");
    assert.equal(clock.minutesSinceMidnight, 7 * 60 + 30);
});

test("cutoff times parse from the browser and from Postgres, and reject junk", () => {
    assert.equal(parseCutoffMinutes("15:00"), 900);
    assert.equal(parseCutoffMinutes("15:00:00"), 900);
    assert.equal(parseCutoffMinutes(null), null);
    assert.equal(parseCutoffMinutes("25:00"), null);
    assert.equal(formatCutoff("09:30:00"), "09:30");
});

test("daily total ignores missing or invalid caffeine values", () => {
    assert.equal(
        sumCaffeineMg([
            { nutrition: { caffeineMg: 128 } },
            { nutrition: { caffeineMg: 64 } },
            { nutrition: {} },
            { nutrition: { caffeineMg: "lots" } },
            { nutrition: { caffeineMg: -50 } },
            null
        ]),
        192
    );
});

test("no warning under the limit and before the cutoff", () => {
    const result = evaluateDrink({ configuration: tripleShot, todayMg: 100, cutoffTime: "15:00", now: MORNING });
    assert.deepEqual(result.reasons, []);
    assert.equal(result.suggestion, null);
    assert.equal(result.projectedMg, 292);
});

test("over the daily limit suggests half-caf with the exact saving", () => {
    const result = evaluateDrink({ configuration: tripleShot, todayMg: 300, cutoffTime: null, now: MORNING });
    assert.deepEqual(result.reasons, ["over-daily-limit"]);
    assert.deepEqual(result.suggestion, { caffeineMode: "half", drinkMg: 96, projectedMg: 396, savesMg: 96 });
});

test("exactly at the limit is allowed; one mg over warns", () => {
    const atLimit = evaluateDrink({
        configuration: tripleShot,
        todayMg: DAILY_CAFFEINE_LIMIT_MG - 192,
        cutoffTime: null,
        now: MORNING
    });
    assert.deepEqual(atLimit.reasons, []);
    const over = evaluateDrink({
        configuration: tripleShot,
        todayMg: DAILY_CAFFEINE_LIMIT_MG - 191,
        cutoffTime: null,
        now: MORNING
    });
    assert.deepEqual(over.reasons, ["over-daily-limit"]);
});

test("past the personal cutoff (Manila time) suggests half-caf", () => {
    const result = evaluateDrink({ configuration: tripleShot, todayMg: 0, cutoffTime: "15:00:00", now: AFTERNOON });
    assert.deepEqual(result.reasons, ["past-cutoff"]);
    assert.equal(result.suggestion.caffeineMode, "half");
    assert.equal(result.cutoffTime, "15:00");
});

test("already half-caf or decaf: no half-caf suggestion offered", () => {
    for (const caffeineMode of ["half", "decaf"]) {
        const result = evaluateDrink({
            configuration: { ...tripleShot, caffeineMode },
            todayMg: 500,
            cutoffTime: "15:00",
            now: AFTERNOON
        });
        assert.equal(result.suggestion, null, caffeineMode);
    }
});

test("today's total only reads this customer's orders since Manila midnight", async () => {
    fakeDatabase.orders = [
        { order_items: [{ nutrition: { caffeineMg: 128 } }, { nutrition: { caffeineMg: 64 } }] },
        { order_items: [{ nutrition: { caffeineMg: 150 } }] }
    ];
    fakeDatabase.cutoffTime = "15:00:00";
    const result = await checkDrinkForCustomer(
        createFakeSupabaseClient(),
        ACCOUNT_ID,
        { configuration: tripleShot },
        AFTERNOON
    );
    assert.equal(result.todayMg, 342);
    assert.deepEqual(result.reasons, ["over-daily-limit", "past-cutoff"]);
    const ordersQuery = fakeDatabase.queries.find((query) => query.table === "orders");
    assert.deepEqual(ordersQuery.filters, [
        ["eq", "account_id", ACCOUNT_ID],
        ["gte", "created_at", "2026-10-29T16:00:00.000Z"]
    ]);
});

test("saving and clearing the cutoff", async () => {
    assert.equal(await saveCutoffTime(createFakeSupabaseClient(), ACCOUNT_ID, "14:30"), "14:30");
    assert.equal(await saveCutoffTime(createFakeSupabaseClient(), ACCOUNT_ID, null), null);
});

test("caffeine routes: authenticated, validated, rate-limited", async () => {
    const server = app.listen(0);
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const send = (method, path, body) =>
        fetch(`${baseUrl}${path}`, {
            method,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
        });
    try {
        const check = await send("POST", "/api/caffeine/check", { configuration: tripleShot });
        assert.equal(check.status, 401);
        assert.ok(check.headers.get("ratelimit-policy"));
        assert.equal((await send("PUT", "/api/caffeine/settings", { cutoffTime: "15:00" })).status, 401);
        assert.equal((await send("PUT", "/api/caffeine/settings", { cutoffTime: "3pm" })).status, 400);
        assert.equal((await send("PUT", "/api/caffeine/settings", { cutoffTime: "24:00" })).status, 400);
        assert.equal(
            (await send("POST", "/api/caffeine/check", { configuration: tripleShot, todayMg: 0 })).status,
            400,
            "the client cannot supply its own total"
        );
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
});

test("drinks in the basket count too: three 3-shots trigger the half-caf offer", () => {
    // Two 3-shot espressos already in the basket (192 mg each), nothing ordered yet today.
    const result = evaluateDrink({
        configuration: tripleShot,
        todayMg: 0,
        basketConfigurations: [tripleShot, tripleShot],
        cutoffTime: null,
        now: MORNING
    });
    assert.equal(result.basketMg, 384);
    assert.equal(result.projectedMg, 576);
    assert.deepEqual(result.reasons, ["over-daily-limit"]);
    assert.deepEqual(result.suggestion, { caffeineMode: "half", drinkMg: 96, projectedMg: 480, savesMg: 96 });
});

test("basket caffeine is recalculated on the server from each drink", () => {
    const result = evaluateDrink({
        configuration: { base: "espresso", shots: 1 },
        todayMg: 100,
        basketConfigurations: [{ base: "espresso", shots: 2, caffeineMode: "decaf" }, { base: "coldBrew" }],
        cutoffTime: null,
        now: MORNING
    });
    const expectedBasketMg =
        calculateNutrition(normalizeConfiguration({ base: "espresso", shots: 2, caffeineMode: "decaf" })).caffeineMg +
        calculateNutrition(normalizeConfiguration({ base: "coldBrew" })).caffeineMg;
    assert.equal(result.basketMg, expectedBasketMg);
    assert.equal(result.projectedMg, 100 + expectedBasketMg + result.drinkMg);
});

test("check route rejects a basket with smuggled numbers or more than 20 drinks", async () => {
    const server = app.listen(0);
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const check = (body) =>
        fetch(`${baseUrl}/api/caffeine/check`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
        });
    try {
        assert.equal((await check({ configuration: tripleShot, basket: [{ caffeineMg: 0 }] })).status, 400);
        assert.equal((await check({ configuration: tripleShot, basket: Array(21).fill(tripleShot) })).status, 400);
        // A valid basket passes validation and only then hits authentication.
        assert.equal((await check({ configuration: tripleShot, basket: [tripleShot] })).status, 401);
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
});
