const test = require("node:test");
const assert = require("node:assert/strict");

// Simulates a Supabase project where some migrations haven't been applied yet:
// any select that mentions a "missing" column fails like PostgREST does.
const supabaseConfigPath = require.resolve("../config/supabase");
const fakeSchema = { missingColumns: [], selectedColumnSets: [] };
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
                select(selectedColumns) {
                    columns = selectedColumns;
                    fakeSchema.selectedColumnSets.push(selectedColumns);
                    return query;
                },
                order: () => query,
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

async function callListAdminOrders() {
    let body;
    let forwardedError;
    await listAdminOrders(
        { query: { page: 1 } },
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
    fakeSchema.missingColumns = ["payment_method", "cash_collected_at"];
    const body = await callListAdminOrders();
    assert.equal(fakeSchema.selectedColumnSets.length, 2);
    assert.match(fakeSchema.selectedColumnSets[1], /pickup_approved_at/);
    assert.doesNotMatch(fakeSchema.selectedColumnSets[1], /payment_method/);
    assert.match(body.schemaWarning, /latest Supabase migrations/);
    assert.equal(body.orders[0].paymentMethod, "cash");
    // JSON drops undefined, so the dashboard sees no cashCollectedAt key and hides the button.
    assert.equal("cashCollectedAt" in JSON.parse(JSON.stringify(body.orders[0])), false);
});

test("before the receipt/approval migrations too: falls back to the base columns", async () => {
    fakeSchema.missingColumns = ["payment_method", "receipt_status"];
    const body = await callListAdminOrders();
    assert.equal(fakeSchema.selectedColumnSets.length, 3);
    assert.equal(body.orders.length, 1);
    assert.equal(body.orders[0].receiptStatus, "unavailable");
});
