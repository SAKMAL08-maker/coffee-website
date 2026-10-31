const { BASES, MILKS, SYRUPS } = require("./coffeeService");

const SHOP_TIME_ZONE = "Asia/Manila";
const RANGE_DAYS = [7, 30, 90];
const PAGE_SIZE = 1000;

const LABELS = {
    temperature: { hot: "Hot", iced: "Iced", blended: "Blended" },
    caffeineMode: { regular: "Regular", half: "Half-caf", decaf: "Decaf" },
    fulfillment: { pickup: "Pickup", delivery: "Delivery" },
    toppings: { cinnamon: "Cinnamon", whippedCream: "Whipped cream", cocoa: "Cocoa" },
    sweeteners: { whiteSugar: "White sugar", rawSugar: "Raw sugar", honey: "Honey", stevia: "Stevia" }
};

function shopDateKey(isoTimestamp) {
    // en-CA formats as YYYY-MM-DD.
    return new Intl.DateTimeFormat("en-CA", { timeZone: SHOP_TIME_ZONE }).format(new Date(isoTimestamp));
}

function increment(counts, key, amount = 1) {
    if (key === undefined || key === null || key === "") return;
    counts[key] = (counts[key] || 0) + amount;
}

/**
 * Counts orders and drinks by raw key. Returns the same shape as the
 * admin_order_metrics Postgres function, so both paths share buildMetrics.
 */
function countRows(allOrders, items) {
    // Cancelled orders are not sales (the Postgres function excludes them too).
    const orders = allOrders.filter((order) => order.status !== "Cancelled");
    const orderIds = new Set(orders.map((order) => order.id));
    const rangedItems = items.filter((item) => orderIds.has(item.order_id));
    const raw = {
        orders: orders.length,
        drinks: rangedItems.length,
        revenueCents: 0,
        ordersByDay: {},
        revenueByDay: {},
        fulfillment: {},
        status: {},
        drinkType: {},
        base: {},
        milk: {},
        temperature: {},
        caffeineMode: {},
        addOns: {}
    };
    for (const order of orders) {
        const totalCents = Number(order.pricing?.total_cents) || 0;
        const day = shopDateKey(order.created_at);
        raw.revenueCents += totalCents;
        increment(raw.ordersByDay, day);
        increment(raw.revenueByDay, day, totalCents);
        increment(raw.fulfillment, order.fulfillment_method);
        increment(raw.status, order.status);
    }
    for (const item of rangedItems) {
        const configuration = item.configuration || {};
        increment(raw.drinkType, item.classification || "Unclassified");
        increment(raw.base, configuration.base);
        increment(raw.milk, configuration.milk);
        increment(raw.temperature, configuration.temperature);
        increment(raw.caffeineMode, configuration.caffeineMode);
        for (const [syrup, pumps] of Object.entries(configuration.syrups || {})) {
            if (typeof pumps === "number" && pumps > 0) increment(raw.addOns, syrup);
        }
        for (const [topping, isOn] of Object.entries(configuration.toppings || {})) {
            if (isOn === true) increment(raw.addOns, topping);
        }
        for (const sweetener of Array.isArray(configuration.sweeteners) ? configuration.sweeteners : []) {
            increment(raw.addOns, sweetener);
        }
    }
    return raw;
}

function addOnLabel(key) {
    return SYRUPS[key]?.label || LABELS.toppings[key] || LABELS.sweeteners[key] || key;
}

// Turns raw-key counts into labelled bars, largest first (labels can merge keys).
function toBars(counts, labelFor = (key) => key) {
    const labelled = new Map();
    for (const [key, value] of Object.entries(counts || {})) {
        const label = labelFor(key);
        labelled.set(label, (labelled.get(label) || 0) + Number(value));
    }
    return [...labelled.entries()]
        .map(([label, value]) => ({ label, value }))
        .sort((left, right) => right.value - left.value || left.label.localeCompare(right.label));
}

function dailyBars(counts, days, now) {
    const bars = [];
    for (let offset = days - 1; offset >= 0; offset -= 1) {
        const key = shopDateKey(new Date(now.getTime() - offset * 24 * 60 * 60 * 1000).toISOString());
        bars.push({ label: key, value: Number(counts?.[key]) || 0 });
    }
    return bars;
}

function buildMetrics(raw, { days, now = new Date() }) {
    const orders = Number(raw.orders) || 0;
    const revenueCents = Number(raw.revenueCents) || 0;
    return {
        days,
        generatedAt: now.toISOString(),
        totals: {
            orders,
            drinks: Number(raw.drinks) || 0,
            revenueCents,
            averageOrderCents: orders ? Math.round(revenueCents / orders) : 0
        },
        // Each tab is one single-series bar chart; "unit" tells the UI how to format values.
        tabs: [
            { id: "orders", title: "Orders per day", unit: "orders", bars: dailyBars(raw.ordersByDay, days, now) },
            { id: "revenue", title: "Sales per day", unit: "cents", bars: dailyBars(raw.revenueByDay, days, now) },
            { id: "drinkType", title: "Drink type", unit: "drinks", bars: toBars(raw.drinkType) },
            {
                id: "base",
                title: "Coffee base",
                unit: "drinks",
                bars: toBars(raw.base, (key) => BASES[key]?.label || key)
            },
            { id: "milk", title: "Milk", unit: "drinks", bars: toBars(raw.milk, (key) => MILKS[key]?.label || key) },
            {
                id: "temperature",
                title: "Hot, iced or blended",
                unit: "drinks",
                bars: toBars(raw.temperature, (key) => LABELS.temperature[key] || key)
            },
            { id: "addOns", title: "Add-ons", unit: "drinks", bars: toBars(raw.addOns, addOnLabel) },
            {
                id: "caffeine",
                title: "Caffeine",
                unit: "drinks",
                bars: toBars(raw.caffeineMode, (key) => LABELS.caffeineMode[key] || key)
            },
            {
                id: "fulfillment",
                title: "Pickup vs delivery",
                unit: "orders",
                bars: toBars(raw.fulfillment, (key) => LABELS.fulfillment[key] || key)
            },
            { id: "status", title: "Order status", unit: "orders", bars: toBars(raw.status) }
        ]
    };
}

// Orders have no cancelled status, so every order in the range counts.
function summarizeOrders(orders, items, options) {
    return buildMetrics(countRows(orders, items), options);
}

async function fetchAllPages(buildQuery) {
    const rows = [];
    for (let from = 0; ; from += PAGE_SIZE) {
        const { data, error } = await buildQuery().range(from, from + PAGE_SIZE - 1);
        if (error) throw error;
        rows.push(...data);
        if (data.length < PAGE_SIZE) return rows;
    }
}

async function countRowsInNode(supabase, since) {
    const orders = await fetchAllPages(() =>
        supabase
            .from("orders")
            .select("id, created_at, status, fulfillment_method, pricing")
            .gte("created_at", since)
            .order("created_at", { ascending: true })
    );
    const items = [];
    const orderIds = orders.map((order) => order.id);
    // Chunk the id list so the request URL stays short.
    for (let index = 0; index < orderIds.length; index += 200) {
        const chunk = orderIds.slice(index, index + 200);
        items.push(
            ...(await fetchAllPages(() =>
                supabase
                    .from("order_items")
                    .select("order_id, configuration, classification")
                    .in("order_id", chunk)
                    .order("id", { ascending: true })
            ))
        );
    }
    return countRows(orders, items);
}

// PGRST202: PostgREST can't find the function (migration not applied yet).
function isMissingMetricsFunction(error) {
    return error?.code === "PGRST202" || /admin_order_metrics/.test(error?.message || "");
}

async function getAdminMetrics(supabase, { days = 30, now = new Date() } = {}) {
    const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase.rpc("admin_order_metrics", {
        p_since: since,
        p_time_zone: SHOP_TIME_ZONE
    });
    if (!error) return { ...buildMetrics(data, { days, now }), source: "postgres" };
    if (!isMissingMetricsFunction(error)) throw error;
    console.warn("admin_order_metrics is missing; counting in Node. Apply the latest Supabase migrations.");
    return { ...buildMetrics(await countRowsInNode(supabase, since), { days, now }), source: "node" };
}

module.exports = { RANGE_DAYS, shopDateKey, countRows, buildMetrics, summarizeOrders, getAdminMetrics };
