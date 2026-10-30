const test = require("node:test");
const assert = require("node:assert/strict");

// Fake Supabase client: records every update so tests can assert exactly what
// would be written. Installed before the app loads so no real database is used.
const supabaseConfigPath = require.resolve("../config/supabase");
const fakeDatabase = { order: null, updates: [], updateMatches: true };
function createFakeSupabaseClient() {
    return {
        from() {
            const query = {
                filters: [],
                pendingUpdate: null,
                select() {
                    return query;
                },
                eq(column, value) {
                    query.filters.push(["eq", column, value]);
                    return query;
                },
                is(column, value) {
                    query.filters.push(["is", column, value]);
                    return query;
                },
                update(values) {
                    query.pendingUpdate = values;
                    return query;
                },
                async maybeSingle() {
                    if (!query.pendingUpdate) return { data: fakeDatabase.order, error: null };
                    fakeDatabase.updates.push({ values: query.pendingUpdate, filters: query.filters });
                    if (!fakeDatabase.updateMatches) return { data: null, error: null };
                    return {
                        data: { id: fakeDatabase.order.id, cash_collected_at: query.pendingUpdate.cash_collected_at },
                        error: null
                    };
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

const { describePaymentInstruction, canMarkCashCollected } = require("../services/paymentService");
const { createReceiptImage } = require("../services/receiptImage");
const { markCashCollected } = require("../controllers/orderController");
const { app } = require("../server");

const ORDER_ID = "c5c0c718-6e68-4a0f-b490-eaa4897bb4b1";
const ADMIN_ID = "0b6f1f4e-2c1d-4c55-9a51-6f7f3d2a9e11";

function createResponseRecorder() {
    return {
        statusCode: 200,
        body: undefined,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(payload) {
            this.body = payload;
            return this;
        }
    };
}

async function callMarkCashCollected() {
    const response = createResponseRecorder();
    let forwardedError;
    await markCashCollected({ params: { orderId: ORDER_ID }, user: { id: ADMIN_ID } }, response, (error) => {
        forwardedError = error;
    });
    if (forwardedError) throw forwardedError;
    return response;
}

test.beforeEach(() => {
    fakeDatabase.order = { id: ORDER_ID, payment_method: "cash", cash_collected_at: null };
    fakeDatabase.updates = [];
    fakeDatabase.updateMatches = true;
});

test("payment instruction names the fulfillment method and defaults to cash", () => {
    assert.equal(describePaymentInstruction("pickup", "cash"), "Pay in cash on pickup");
    assert.equal(describePaymentInstruction("delivery", "cash"), "Pay in cash on delivery");
    assert.equal(describePaymentInstruction("delivery"), "Pay in cash on delivery");
});

test("cash can be marked collected once, only for cash orders", () => {
    assert.equal(canMarkCashCollected({ payment_method: "cash", cash_collected_at: null }), true);
    assert.equal(canMarkCashCollected({ cash_collected_at: null }), true);
    assert.equal(canMarkCashCollected({ payment_method: "cash", cash_collected_at: "2026-10-30T00:00:00Z" }), false);
    assert.equal(canMarkCashCollected({ payment_method: "card", cash_collected_at: null }), false);
});

test("delivery receipt image shows the cash-on-delivery instruction", () => {
    const image = createReceiptImage({
        id: ORDER_ID,
        customer: { name: "Customer" },
        fulfillment_method: "delivery",
        delivery_address: "1 Example St",
        payment_method: "cash",
        created_at: "2026-10-30T12:00:00.000Z",
        pricing: { subtotal_cents: 25000, delivery_fee_cents: 4900, total_cents: 29900 },
        order_items: [{ name: "Latte", price_cents: 25000 }]
    }).toString("utf8");
    assert.match(image, /Pay in cash on delivery/);
    assert.match(image, /TOTAL DUE/);
});

test("markCashCollected records who and when, guarded so it can only happen once", async () => {
    const response = await callMarkCashCollected();
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.order.id, ORDER_ID);
    assert.equal(fakeDatabase.updates.length, 1);
    const [{ values, filters }] = fakeDatabase.updates;
    assert.equal(values.cash_collected_by, ADMIN_ID);
    assert.ok(!Number.isNaN(Date.parse(values.cash_collected_at)));
    assert.equal(values.cash_collected_at, values.updated_at);
    assert.deepEqual(filters, [
        ["eq", "id", ORDER_ID],
        ["is", "cash_collected_at", null]
    ]);
});

test("markCashCollected returns 409 when already collected and does not write", async () => {
    fakeDatabase.order.cash_collected_at = "2026-10-30T09:00:00.000Z";
    const response = await callMarkCashCollected();
    assert.equal(response.statusCode, 409);
    assert.equal(fakeDatabase.updates.length, 0);
});

test("markCashCollected returns 409 when another admin wins the race", async () => {
    fakeDatabase.updateMatches = false;
    const response = await callMarkCashCollected();
    assert.equal(response.statusCode, 409);
    assert.deepEqual(response.body, { error: "Order changed; refresh and try again." });
});

test("markCashCollected returns 404 for an unknown order", async () => {
    fakeDatabase.order = null;
    const response = await callMarkCashCollected();
    assert.equal(response.statusCode, 404);
});

test("PATCH /cash-collected: rate-limited, validated, and requires authentication", async () => {
    const server = app.listen(0);
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const patch = (path, body) =>
        fetch(`${baseUrl}${path}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
        });
    try {
        const unauthenticated = await patch(`/api/orders/${ORDER_ID}/admin/cash-collected`, {});
        assert.equal(unauthenticated.status, 401);
        assert.ok(unauthenticated.headers.get("ratelimit-policy"), "rate limiter applied");

        const badId = await patch("/api/orders/not-a-uuid/admin/cash-collected", {});
        assert.equal(badId.status, 400);

        // The client can't supply who or when.
        const spoofed = await patch(`/api/orders/${ORDER_ID}/admin/cash-collected`, {
            cashCollectedBy: ADMIN_ID
        });
        assert.equal(spoofed.status, 400);
        assert.equal(fakeDatabase.updates.length, 0);
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
});
