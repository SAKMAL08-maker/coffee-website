const test = require("node:test");
const assert = require("node:assert/strict");
const menu = require("../services/menuService");
const { normalizeConfiguration } = require("../services/coffeeService");

const MAIN = { id: "11111111-1111-4111-8111-111111111111", slug: "main", name: "Coffee Lab Main", is_active: true };
const MAKATI = { id: "22222222-2222-4222-8222-222222222222", slug: "makati", name: "Makati", is_active: true };
const CLOSED = { id: "33333333-3333-4333-8333-333333333333", slug: "qc", name: "QC", is_active: false };

/** branches: rows for "branches"; soldOut: rows for "menu_sold_out"; writes are recorded. */
function fakeSupabase({ branches = [MAIN], soldOut = [], branchError = null } = {}) {
    const writes = [];
    return {
        writes,
        from(table) {
            const op = { table, filters: [] };
            const result = () => {
                if (table === "branches" && !op.write)
                    return { data: branchError ? null : branches, error: branchError };
                if (table === "menu_sold_out" && !op.write) return { data: soldOut, error: null };
                writes.push(op);
                return { data: { ...MAKATI, ...op.values }, error: null };
            };
            const builder = {
                select: () => builder,
                order: () => builder,
                eq: (column, value) => op.filters.push([column, value]) && builder,
                insert: (values) => Object.assign(op, { write: "insert", values }) && builder,
                update: (values) => Object.assign(op, { write: "update", values }) && builder,
                upsert: (values) => Object.assign(op, { write: "upsert", values }) && builder,
                delete: () => Object.assign(op, { write: "delete" }) && builder,
                single: async () => result(),
                then: (resolve, reject) => Promise.resolve(result()).then(resolve, reject)
            };
            return builder;
        }
    };
}

test.beforeEach(() => menu.clearCaches());

test("a drink uses only what it's actually made with", () => {
    const latte = normalizeConfiguration({
        base: "espresso",
        milk: "oat",
        caffeineMode: "half",
        syrups: { vanilla: 2 },
        sweeteners: ["honey"],
        toppings: { cocoa: true }
    });
    assert.deepEqual(menu.optionsUsedBy(latte).sort(), [
        "base:espresso",
        "beans:decaf",
        "milk:oat",
        "sweetener:honey",
        "syrup:vanilla",
        "topping:cocoa"
    ]);
    // Cold brew has no milk, so "milk:whole" (the default) isn't used.
    assert.deepEqual(menu.optionsUsedBy(normalizeConfiguration({ base: "coldBrew" })), ["base:coldBrew"]);
    // Every key used by any drink is one admins can switch.
    const keys = new Set(menu.MENU_OPTIONS.map((option) => option.key));
    for (const key of menu.optionsUsedBy(latte)) assert.ok(keys.has(key), key);
});

test("checkout refuses a drink that uses something sold out, naming the item and the option", () => {
    const lineItems = [
        { name: "Matcha Latte", configuration: normalizeConfiguration({ base: "matcha", milk: "almond" }) }
    ];
    assert.throws(() => menu.assertAvailable(lineItems, new Set(["milk:almond"]), MAIN), {
        statusCode: 409,
        message: /Almond milk is sold out at Coffee Lab Main right now, so "Matcha Latte"/
    });
    assert.doesNotThrow(() => menu.assertAvailable(lineItems, new Set(["milk:oat"]), MAIN));
});

test("one open branch is chosen automatically; with several the customer must choose an open one", async () => {
    assert.equal((await menu.resolveOrderBranch(fakeSupabase({ branches: [MAIN, CLOSED] }))).id, MAIN.id);
    menu.clearCaches();
    const several = fakeSupabase({ branches: [MAIN, MAKATI, CLOSED] });
    await assert.rejects(menu.resolveOrderBranch(several), { statusCode: 400, message: /Choose which branch/ });
    assert.equal((await menu.resolveOrderBranch(several, MAKATI.id)).name, "Makati");
    await assert.rejects(menu.resolveOrderBranch(several, CLOSED.id), /isn't taking orders/);
});

test("before the migration there are no branches and orders go through as before", async () => {
    const missing = fakeSupabase({ branchError: { code: "PGRST205", message: "table not found" } });
    assert.equal(await menu.resolveOrderBranch(missing), null);
    assert.deepEqual([...(await menu.getSoldOut(missing, null))], []);
});

test("sold-out switches: known options only, upsert to switch off, delete to switch back on", async () => {
    const supabase = fakeSupabase();
    await assert.rejects(
        menu.setSoldOut(supabase, { branchId: MAIN.id, option: "milk:goat", soldOut: true, actorId: "a" }),
        { statusCode: 400 }
    );
    await menu.setSoldOut(supabase, { branchId: MAIN.id, option: "milk:oat", soldOut: true, actorId: "a" });
    await menu.setSoldOut(supabase, { branchId: MAIN.id, option: "milk:oat", soldOut: false, actorId: "a" });
    assert.deepEqual(
        supabase.writes.map((write) => write.write),
        ["upsert", "delete"]
    );
    assert.equal(supabase.writes[0].values.option_key, "milk:oat");
    assert.deepEqual(supabase.writes[1].filters, [
        ["branch_id", MAIN.id],
        ["option_key", "milk:oat"]
    ]);
});

test("branches: readable unique slugs, and the last open branch can't be closed", async () => {
    assert.equal(menu.slugify("  Coffee Lab — BGC 5th Ave! "), "coffee-lab-bgc-5th-ave");
    const supabase = fakeSupabase({ branches: [MAIN, { ...MAKATI, slug: "makati" }] });
    await menu.createBranch(supabase, { name: "Makati" });
    assert.equal(supabase.writes[0].values.slug, "makati-2");

    menu.clearCaches();
    const single = fakeSupabase({ branches: [MAIN, CLOSED] });
    await assert.rejects(menu.updateBranch(single, MAIN.id, { isActive: false }), { statusCode: 409 });
    await menu.updateBranch(single, CLOSED.id, { isActive: true });
    assert.equal(single.writes[0].values.is_active, true);
});
