const test = require("node:test");
const assert = require("node:assert/strict");
const { createTtlCache } = require("../services/ttlCache");

test("reuses a value until it expires, then loads again", async () => {
    let clock = 0;
    let loads = 0;
    const cache = createTtlCache(1000, () => clock);
    const load = async () => ++loads;
    assert.equal(await cache.get("k", load), 1);
    clock = 999;
    assert.equal(await cache.get("k", load), 1, "still fresh");
    clock = 1001;
    assert.equal(await cache.get("k", load), 2, "expired, reloaded");
    assert.equal(await cache.get("other", load), 3, "keys are separate");
});

test("callers at the same moment share one load", async () => {
    let loads = 0;
    let release;
    const cache = createTtlCache(1000);
    const load = () => (loads++, new Promise((resolve) => (release = resolve)));
    const first = cache.get("k", load);
    const second = cache.get("k", load);
    release("value");
    assert.deepEqual(await Promise.all([first, second]), ["value", "value"]);
    assert.equal(loads, 1);
});

test("failures are not cached", async () => {
    const cache = createTtlCache(1000);
    await assert.rejects(
        cache.get("k", async () => {
            throw new Error("database down");
        }),
        /database down/
    );
    assert.equal(await cache.get("k", async () => "recovered"), "recovered");
});
