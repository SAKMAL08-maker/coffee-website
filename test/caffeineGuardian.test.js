const test = require("node:test");
const assert = require("node:assert/strict");
const { getManilaDayWindow, sumCaffeineMg, isAfterCutoff } = require("../services/caffeineGuardian");

test("calculates the current day window in Manila time", () => {
    assert.deepEqual(getManilaDayWindow(new Date("2026-10-30T10:00:00.000Z")), {
        start: "2026-10-29T16:00:00.000Z",
        end: "2026-10-30T16:00:00.000Z"
    });
});

test("sums caffeine only from recorded order item nutrition", () => {
    assert.equal(sumCaffeineMg([
        { order_items: [{ nutrition: { caffeineMg: 80 } }, { nutrition: { caffeineMg: 45 } }] },
        { order_items: [{ nutrition: { caffeineMg: "25" } }, { nutrition: {} }] }
    ]), 150);
    assert.equal(sumCaffeineMg([]), 0);
});

test("suggests half-caf at or after a valid cutoff in Manila time", () => {
    assert.equal(isAfterCutoff("18:00", new Date("2026-10-30T10:00:00.000Z")), true);
    assert.equal(isAfterCutoff("18:01", new Date("2026-10-30T10:00:00.000Z")), false);
    assert.equal(isAfterCutoff(null, new Date("2026-10-30T10:00:00.000Z")), false);
});
