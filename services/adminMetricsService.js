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

function increment(counter, label, amount = 1) {
    if (!label) return;
    counter.set(label, (counter.get(label) || 0) + amount);
}

function toBars(counter) {
    return [...counter.entries()]
        .map(([label, value]) => ({ label, value }))
        .sort((left, right) => right.value - left.value || left.label.localeCompare(right.label));
}

function dailyBars(counter, days, now) {
    const bars = [];
    for (let offset = days - 1; offset >= 0; offset -= 1) {
        const key = shopDateKey(new Date(now.getTime() - offset * 24 * 60 * 60 * 1000).toISOString());
        bars.push({ label: key, value: counter.get(key) || 0 });
    }
    return bars;
}

function summarizeOrders(orders, items, { days, now = new Date() }) {
    // Orders have no cancelled status, so every order in the range counts.
    const countedOrders = orders;
    const countedIds = new Set(orders.map((order) => order.id));
    const countedItems = items.filter((item) => countedIds.has(item.order_id));

    const ordersByDay = new Map();
    const revenueByDay = new Map();
    const fulfillment = new Map();
    const status = new Map();
    let revenueCents = 0;
    for (const order of countedOrders) {
        const totalCents = Number(order.pricing?.total_cents) || 0;
        const day = shopDateKey(order.created_at);
        revenueCents += totalCents;
        increment(ordersByDay, day);
        increment(revenueByDay, day, totalCents);
        increment(fulfillment, LABELS.fulfillment[order.fulfillment_method] || order.fulfillment_method);
        increment(status, order.status);
    }

    const drinkType = new Map();
    const base = new Map();
    const milk = new Map();
    const temperature = new Map();
    const caffeine = new Map();
    const addOns = new Map();
    for (const item of countedItems) {
        const configuration = item.configuration || {};
        increment(drinkType, item.classification || "Unclassified");
        increment(base, BASES[configuration.base]?.label || configuration.base);
        increment(milk, MILKS[configuration.milk]?.label || configuration.milk);
        increment(temperature, LABELS.temperature[configuration.temperature] || configuration.temperature);
        increment(caffeine, LABELS.caffeineMode[configuration.caffeineMode] || configuration.caffeineMode);
        for (const [syrup, pumps] of Object.entries(configuration.syrups || {})) {
            if (Number(pumps) > 0) increment(addOns, SYRUPS[syrup]?.label || syrup);
        }
        for (const [topping, isOn] of Object.entries(configuration.toppings || {})) {
            if (isOn) increment(addOns, LABELS.toppings[topping] || topping);
        }
        for (const sweetener of configuration.sweeteners || []) {
            increment(addOns, LABELS.sweeteners[sweetener] || sweetener);
        }
    }

    return {
        days,
        generatedAt: now.toISOString(),
        totals: {
            orders: countedOrders.length,
            drinks: countedItems.length,
            revenueCents,
            averageOrderCents: countedOrders.length ? Math.round(revenueCents / countedOrders.length) : 0
        },
        // Each tab is one single-series bar chart; "unit" tells the UI how to format values.
        tabs: [
            { id: "orders", title: "Orders per day", unit: "orders", bars: dailyBars(ordersByDay, days, now) },
            { id: "revenue", title: "Sales per day", unit: "cents", bars: dailyBars(revenueByDay, days, now) },
            { id: "drinkType", title: "Drink type", unit: "drinks", bars: toBars(drinkType) },
            { id: "base", title: "Coffee base", unit: "drinks", bars: toBars(base) },
            { id: "milk", title: "Milk", unit: "drinks", bars: toBars(milk) },
            { id: "temperature", title: "Hot, iced or blended", unit: "drinks", bars: toBars(temperature) },
            { id: "addOns", title: "Add-ons", unit: "drinks", bars: toBars(addOns) },
            { id: "caffeine", title: "Caffeine", unit: "drinks", bars: toBars(caffeine) },
            { id: "fulfillment", title: "Pickup vs delivery", unit: "orders", bars: toBars(fulfillment) },
            { id: "status", title: "Order status", unit: "orders", bars: toBars(status) }
        ]
    };
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

async function getAdminMetrics(supabase, { days = 30, now = new Date() } = {}) {
    const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
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
    return summarizeOrders(orders, items, { days, now });
}

module.exports = { RANGE_DAYS, shopDateKey, summarizeOrders, getAdminMetrics };
