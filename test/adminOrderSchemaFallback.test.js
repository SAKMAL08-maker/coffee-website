const test = require("node:test");
const assert = require("node:assert/strict");

// Simulates a Supabase project where some migrations haven't been applied yet:
// any select that mentions a "missing" column fails like PostgREST does.
const supabaseConfigPath = require.resolve("../config/supabase");
const fakeSchema = { missingColumns: [], selectedColumnSets: [], orderCalls: [] };
const savedOrder = {
    id: "c5c0c718-6e68-4a0f-b490-eaa4897bb4b1",
    tracking_code: "a".repeat(48),
    status: "Received",
    fulfillment_method: "pickup",
    customer: { name: "Customer" },
    pricing: { total_cents: 33750 },
    created_at: "2026-10-30T12:00:00.000Z",
    order_items: []
};
function createFakeSupabaseClient() {
    return {
        from() {
            let columns = "";
            const query = {
                select(selectedColumns, options) {
                    columns = selectedColumns;
                    // Head-only count queries (the view counts) aren't part of the schema fallback.
                    if (!options?.head) fakeSchema.selectedColumnSets.push(selectedColumns);
                    return query;
                },
                order: (column, options) => {
                    fakeSchema.orderCalls.push([column, options]);
                    return query;
                },
                or: () => query,
                not: () => query,
                in: () => query,
                // Count queries are awaited directly.
                then: (resolve) => resolve({ count: 1, error: null }),
                async range() {
                    const missing = fakeSchema.missingColumns.find((column) => columns.includes(column));
                    if (missing) {
                        return {
                            data: null,
                            count: null,
                            error: { code: "42703", message: `column orders.${missing} does not exist` }
                        };
                    }
                    const row = { ...savedOrder };
                    if (columns.includes("payment_method"))
                        Object.assign(row, { payment_method: "cash", cash_collected_at: null });
                    return { data: [row], count: 1, error: null };
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

const { listAdminOrders } = require("../controllers/orderController");

async function callListAdminOrders(query = {}) {
    let body;
    let forwardedError;
    await listAdminOrders(
        { query: { page: 1, ...query } },
        {
            status() {
                return this;
            },
            json(payload) {
                body = payload;
            }
        },
        (error) => {
            forwardedError = error;
        }
    );
    if (forwardedError) throw forwardedError;
    return body;
}

test.beforeEach((t) => {
    fakeSchema.selectedColumnSets = [];
    t.mock.method(console, "warn", () => {});
});

test("after the cash migration: one query, cash fields included, no warning", async () => {
    fakeSchema.missingColumns = [];
    const body = await callListAdminOrders();
    assert.equal(fakeSchema.selectedColumnSets.length, 1);
    assert.equal(body.schemaWarning, null);
    assert.equal(body.orders[0].paymentMethod, "cash");
    assert.ok("cashCollectedAt" in body.orders[0]);
});

test("before the cash migration: falls back, keeps approval columns, omits cashCollectedAt", async () => {
    fakeSchema.missingColumns = ["branch_id", "payment_method", "cash_collected_at"];
    const body = await callListAdminOrders();
    assert.equal(fakeSchema.selectedColumnSets.length, 3);
    assert.match(fakeSchema.selectedColumnSets[2], /pickup_approved_at/);
    assert.doesNotMatch(fakeSchema.selectedColumnSets[2], /payment_method/);
    assert.match(body.schemaWarning, /latest Supabase migrations/);
    assert.equal(body.orders[0].paymentMethod, "cash");
    // JSON drops undefined, so the dashboard sees no cashCollectedAt key and hides the button.
    assert.equal("cashCollectedAt" in JSON.parse(JSON.stringify(body.orders[0])), false);
});

test("before the receipt/approval migrations too: falls back to the base columns", async () => {
    fakeSchema.missingColumns = ["branch_id", "payment_method", "receipt_status"];
    const body = await callListAdminOrders();
    assert.equal(fakeSchema.selectedColumnSets.length, 4);
    assert.equal(body.orders.length, 1);
    assert.equal(body.orders[0].receiptStatus, "unavailable");
});

test("before the branches migration only: one quiet fallback, cash fields kept, no warning", async () => {
    fakeSchema.missingColumns = ["branch_id"];
    const body = await callListAdminOrders();
    assert.equal(fakeSchema.selectedColumnSets.length, 2);
    assert.match(fakeSchema.selectedColumnSets[0], /branch:branches\(name\)/);
    assert.match(fakeSchema.selectedColumnSets[1], /payment_method/);
    assert.equal(body.schemaWarning, null);
    assert.equal(body.orders[0].branchName, null);
    assert.ok("cashCollectedAt" in body.orders[0]);
});

test("every view lists the newest orders first", async () => {
    fakeSchema.missingColumns = [];
    for (const view of ["active", "done", "all"]) {
        fakeSchema.orderCalls = [];
        await callListAdminOrders({ view });
        assert.deepEqual(fakeSchema.orderCalls, [["created_at", { ascending: false }]], view);
    }
});
