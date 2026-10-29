const test = require("node:test");
const assert = require("node:assert/strict");
const { createCashCollectionUpdate } = require("../services/cashCollectionService");

test("builds a cash collection update with the admin and timestamp", () => {
    assert.deepEqual(
        createCashCollectionUpdate({ payment_method: "cash" }, "admin-id", "2026-10-30T00:00:00.000Z"),
        {
            cash_collected_at: "2026-10-30T00:00:00.000Z",
            cash_collected_by: "admin-id",
            updated_at: "2026-10-30T00:00:00.000Z"
        }
    );
});

test("rejects missing, non-cash, and already-collected orders", () => {
    assert.throws(() => createCashCollectionUpdate(null, "admin-id"), { statusCode: 404 });
    assert.throws(() => createCashCollectionUpdate({ payment_method: "card" }, "admin-id"), { statusCode: 409 });
    assert.throws(() => createCashCollectionUpdate({ payment_method: "cash", cash_collected_at: "yesterday" }, "admin-id"), { statusCode: 409 });
    assert.throws(() => createCashCollectionUpdate({ payment_method: "cash" }, ""), { statusCode: 403 });
});
