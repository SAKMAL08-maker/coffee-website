const test = require("node:test");
const assert = require("node:assert/strict");
const { summarizeOrders, shopDateKey, getAdminMetrics, countRows } = require("../services/adminMetricsService");

const NOW = new Date("2026-10-31T04:00:00Z"); // noon in Manila

function order(id, createdAt, overrides = {}) {
    return {
        id,
        created_at: createdAt,
        status: "Received",
        fulfillment_method: "pickup",
        pricing: { total_cents: 20000 },
        ...overrides
    };
}

function item(orderId, configuration, classification = "Latte") {
    return { order_id: orderId, classification, configuration };
}

test("shop days follow Manila time, not UTC", () => {
    // 17:30 UTC on Oct 30 is 01:30 on Oct 31 in Manila.
    assert.equal(shopDateKey("2026-10-30T17:30:00Z"), "2026-10-31");
});

test("summarizes totals and every tab from orders and drinks", () => {
    const orders = [
        order("a", "2026-10-31T01:00:00Z"),
        order("b", "2026-10-30T01:00:00Z", { fulfillment_method: "delivery", pricing: { total_cents: 10000 } })
    ];
    const items = [
        item("a", {
            base: "espresso",
            milk: "oat",
            temperature: "iced",
            caffeineMode: "half",
            syrups: { vanilla: 2, caramel: 0 },
            toppings: { cinnamon: true, cocoa: false },
            sweeteners: ["honey"]
        }),
        item("a", { base: "espresso", milk: "whole", temperature: "hot", caffeineMode: "regular" }, "Cappuccino"),
        item("b", { base: "coldBrew", milk: "whole", temperature: "iced", caffeineMode: "regular" }, "Cold Brew"),
        item("ignored", { base: "matcha" }, "Matcha")
    ];
    const result = summarizeOrders(orders, items, { days: 7, now: NOW });
    const tab = (id) =>
        Object.fromEntries(
            result.tabs.find((candidate) => candidate.id === id).bars.map((bar) => [bar.label, bar.value])
        );

    assert.deepEqual(result.totals, { orders: 2, drinks: 3, revenueCents: 30000, averageOrderCents: 15000 });
    assert.deepEqual(tab("drinkType"), { Latte: 1, Cappuccino: 1, "Cold Brew": 1 });
    assert.deepEqual(tab("base"), { Espresso: 2, "Cold brew": 1 });
    assert.deepEqual(tab("milk"), { "Whole milk": 2, "Oat milk": 1 });
    assert.deepEqual(tab("temperature"), { Iced: 2, Hot: 1 });
    assert.deepEqual(tab("caffeine"), { Regular: 2, "Half-caf": 1 });
    // Only syrups with pumps, toppings that are on, and chosen sweeteners count.
    assert.deepEqual(tab("addOns"), { "Vanilla syrup": 1, Cinnamon: 1, Honey: 1 });
    assert.deepEqual(tab("fulfillment"), { Pickup: 1, Delivery: 1 });

    const ordersPerDay = result.tabs.find((candidate) => candidate.id === "orders").bars;
    assert.equal(ordersPerDay.length, 7, "one bar per day, including empty days");
    assert.deepEqual(ordersPerDay.slice(-2), [
        { label: "2026-10-30", value: 1 },
        { label: "2026-10-31", value: 1 }
    ]);
    assert.equal(result.tabs.find((candidate) => candidate.id === "revenue").bars.at(-1).value, 20000);
});

test("bars are sorted largest first so the chart reads as a ranking", () => {
    const orders = [order("a", "2026-10-31T01:00:00Z")];
    const items = [item("a", { base: "drip" }), item("a", { base: "espresso" }), item("a", { base: "espresso" })];
    const bars = summarizeOrders(orders, items, { days: 7, now: NOW }).tabs.find((tab) => tab.id === "base").bars;
    assert.deepEqual(
        bars.map((bar) => bar.label),
        ["Espresso", "Filter coffee"]
    );
});

test("an empty range returns zeros instead of dividing by zero", () => {
    const result = summarizeOrders([], [], { days: 30, now: NOW });
    assert.equal(result.totals.averageOrderCents, 0);
    assert.equal(result.tabs.find((tab) => tab.id === "orders").bars.length, 30);
});

test("before the migration: falls back to counting in Node and pages past 1000 orders", async () => {
    const allOrders = Array.from({ length: 1500 }, (_, index) => order(`o${index}`, "2026-10-31T01:00:00Z"));
    const requestedRanges = [];
    const fakeSupabase = {
        rpc: async () => ({ data: null, error: { code: "PGRST202", message: "Could not find admin_order_metrics" } }),
        from(table) {
            const query = {
                select: () => query,
                gte: () => query,
                in: () => query,
                order: () => query,
                range(from, to) {
                    if (table === "orders") requestedRanges.push([from, to]);
                    const rows = table === "orders" ? allOrders.slice(from, to + 1) : [];
                    return Promise.resolve({ data: rows, error: null });
                }
            };
            return query;
        }
    };
    const result = await getAdminMetrics(fakeSupabase, { days: 7, now: NOW });
    assert.equal(result.totals.orders, 1500);
    assert.equal(result.source, "node");
    assert.deepEqual(requestedRanges, [
        [0, 999],
        [1000, 1999]
    ]);
});

test("after the migration: one Postgres call, no rows downloaded, same labels", async () => {
    const orders = [order("a", "2026-10-31T01:00:00Z")];
    const items = [item("a", { base: "espresso", milk: "oat", syrups: { caramel: 1 }, sweeteners: ["stevia"] })];
    let rpcArgs;
    const fakeSupabase = {
        rpc: async (name, args) => {
            rpcArgs = { name, ...args };
            // The SQL function returns the same raw shape countRows builds.
            return { data: countRows(orders, items), error: null };
        },
        from: () => assert.fail("rows must not be downloaded when the function exists")
    };
    const result = await getAdminMetrics(fakeSupabase, { days: 7, now: NOW });
    assert.equal(result.source, "postgres");
    assert.equal(rpcArgs.name, "admin_order_metrics");
    assert.equal(rpcArgs.p_time_zone, "Asia/Manila");
    assert.equal(rpcArgs.p_since, "2026-10-24T04:00:00.000Z");
    assert.deepEqual(result, { ...summarizeOrders(orders, items, { days: 7, now: NOW }), source: "postgres" });
});

test("other database errors are not hidden by the fallback", async () => {
    const fakeSupabase = { rpc: async () => ({ data: null, error: { code: "57014", message: "timeout" } }) };
    await assert.rejects(getAdminMetrics(fakeSupabase, { days: 7, now: NOW }), { code: "57014" });
});
