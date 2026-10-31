const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { rateLimit } = require("express-rate-limit");
const { PostgresRateLimitStore } = require("../middleware/postgresRateLimitStore");
const { createStore } = require("../middleware/rateLimiters");

// Stands in for Postgres: one counter table shared by every "server".
function fakeDatabase({ failing = false } = {}) {
    const rows = new Map();
    const calls = [];
    const client = {
        async rpc(name, args) {
            calls.push([name, args]);
            if (failing) return { data: null, error: { code: "08006", message: "connection failure" } };
            if (name === "rate_limit_hit") {
                const row = rows.get(args.p_key) || { hits: 0, reset_at: new Date(Date.now() + args.p_window_ms) };
                row.hits += 1;
                rows.set(args.p_key, row);
                return { data: [{ total_hits: row.hits, reset_at: row.reset_at.toISOString() }], error: null };
            }
            if (name === "rate_limit_decrement") rows.get(args.p_key).hits -= 1;
            if (name === "rate_limit_reset") rows.delete(args.p_key);
            return { data: null, error: null };
        }
    };
    return { client, rows, calls };
}

// One "server instance": its own Express app and limiter, pointing at the shared database.
async function startInstance(database, limit, prefix = "authLimiter") {
    const app = express();
    app.set("trust proxy", false);
    app.use(
        rateLimit({
            windowMs: 60_000,
            limit,
            store: new PostgresRateLimitStore(prefix, () => database.client),
            passOnStoreError: true,
            handler: (request, response) => response.status(429).json({ error: "Too many requests." })
        })
    );
    app.get("/", (request, response) => response.json({ ok: true }));
    const server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    return { url: `http://127.0.0.1:${server.address().port}/`, close: () => server.close() };
}

test("two server instances share one limit instead of each allowing the full amount", async (t) => {
    const database = fakeDatabase();
    const first = await startInstance(database, 3);
    const second = await startInstance(database, 3);
    t.after(() => (first.close(), second.close()));

    const statuses = [];
    for (const instance of [first, second, first, second]) statuses.push((await fetch(instance.url)).status);
    // With in-memory stores this would be 200, 200, 200, 200 (3 allowed per instance).
    assert.deepEqual(statuses, [200, 200, 200, 429]);
});

test("each limiter counts under its own prefix", async () => {
    const database = fakeDatabase();
    const login = new PostgresRateLimitStore("authLimiter", () => database.client);
    const checkout = new PostgresRateLimitStore("checkoutLimiter", () => database.client);
    login.init({ windowMs: 1000 });
    checkout.init({ windowMs: 1000 });
    await login.increment("1.2.3.4");
    const result = await checkout.increment("1.2.3.4");
    assert.equal(result.totalHits, 1);
    assert.ok(result.resetTime instanceof Date);
    assert.deepEqual([...database.rows.keys()], ["authLimiter:1.2.3.4", "checkoutLimiter:1.2.3.4"]);
    await login.decrement("1.2.3.4");
    await login.resetKey("1.2.3.4");
    assert.deepEqual([...database.rows.keys()], ["checkoutLimiter:1.2.3.4"]);
});

test("if the database is unreachable, requests pass instead of the site going down", async (t) => {
    const instance = await startInstance(fakeDatabase({ failing: true }), 1);
    t.after(() => instance.close());
    const originalError = console.error;
    console.error = () => {};
    try {
        assert.equal((await fetch(instance.url)).status, 200);
        assert.equal((await fetch(instance.url)).status, 200);
    } finally {
        console.error = originalError;
    }
});

test("off by default: only RATE_LIMIT_STORE=postgres switches stores", () => {
    assert.equal(createStore("authLimiter", {}), undefined);
    assert.equal(createStore("authLimiter", { RATE_LIMIT_STORE: "memory" }), undefined);
    assert.equal(createStore(undefined, { RATE_LIMIT_STORE: "postgres" }), undefined, "unnamed limiters stay local");
    assert.ok(createStore("authLimiter", { RATE_LIMIT_STORE: "postgres" }) instanceof PostgresRateLimitStore);
});
