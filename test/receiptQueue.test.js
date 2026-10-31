const test = require("node:test");
const assert = require("node:assert/strict");
const { enqueueReceipt, sweepPendingReceipts, forTests } = require("../services/receiptQueue");

test.afterEach(() => forTests.setBuilder(null));

test("queued receipts are built once each, and a request mid-build reruns it afterwards", async () => {
    const built = [];
    let release;
    const gate = new Promise((resolve) => (release = resolve));
    forTests.setBuilder(async (orderId) => {
        built.push(orderId);
        if (built.length === 1) await gate;
        return "available";
    });
    enqueueReceipt("a");
    enqueueReceipt("b"); // two build at once
    enqueueReceipt("w");
    enqueueReceipt("w"); // still waiting: collapses
    enqueueReceipt("a"); // mid-build (e.g. cash collected): runs again after
    release();
    await forTests.drain();
    assert.deepEqual(built.sort(), ["a", "a", "b", "w"]);
});

test("a failing receipt is retried, then given up without throwing", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    let attempts = 0;
    forTests.setBuilder(async () => {
        attempts += 1;
        throw new Error("B2 down");
    });
    const errors = t.mock.method(console, "error", () => {});
    enqueueReceipt("c");
    for (let tick = 0; tick < 5; tick += 1) {
        await new Promise((resolve) => setImmediate(resolve));
        t.mock.timers.tick(10000);
    }
    await forTests.drain();
    assert.equal(attempts, 3);
    assert.equal(errors.mock.callCount(), 1);
});

test("the sweeper re-queues only signed-in, recent, still-pending, not-cancelled orders", async () => {
    const filters = [];
    const builder = {
        select: () => builder,
        eq: (...args) => filters.push(["eq", ...args]) && builder,
        not: (...args) => filters.push(["not", ...args]) && builder,
        neq: (...args) => filters.push(["neq", ...args]) && builder,
        lt: (column) => filters.push(["lt", column]) && builder,
        gt: (column) => filters.push(["gt", column]) && builder,
        limit: async () => ({ data: [{ id: "d" }], error: null })
    };
    const built = [];
    forTests.setBuilder(async (orderId) => built.push(orderId));
    assert.equal(await sweepPendingReceipts({ from: () => builder }), 1);
    await forTests.drain();
    assert.deepEqual(built, ["d"]);
    assert.deepEqual(filters, [
        ["eq", "receipt_status", "pending"],
        ["not", "account_id", "is", null],
        ["neq", "status", "Cancelled"],
        ["lt", "created_at"],
        ["gt", "created_at"]
    ]);
});
