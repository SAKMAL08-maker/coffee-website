const test = require("node:test");
const assert = require("node:assert/strict");

// Replace the real Supabase config module before anything requires it, so these
// tests never reach a real database even when a local .env is present.
// (node --test runs each test file in its own process, so this cannot leak.)
const supabaseConfigPath = require.resolve("../config/supabase");
let nextQueryOutcome = { error: null };
function createFakeSupabaseClient() {
    const query = {
        select: () => query,
        limit: () => query,
        abortSignal: () => (nextQueryOutcome instanceof Error
            ? Promise.reject(nextQueryOutcome)
            : Promise.resolve(nextQueryOutcome))
    };
    return { from: () => query };
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

const { checkDatabaseHealth } = require("../services/healthService");
const { app } = require("../server");

function silenceConsoleError(t) {
    t.mock.method(console, "error", () => {});
}

test("checkDatabaseHealth reports healthy when the query succeeds", async () => {
    const result = await checkDatabaseHealth(() => {
        const query = { select: () => query, limit: () => query, abortSignal: async () => ({ error: null }) };
        return {
            from(table) {
                assert.equal(table, "coffee_users");
                return query;
            }
        };
    });
    assert.deepEqual(result, { healthy: true });
});

test("checkDatabaseHealth reports unhealthy on a Supabase error, a thrown error, or missing config", async (t) => {
    silenceConsoleError(t);
    nextQueryOutcome = { error: { name: "PostgrestError", message: "relation does not exist" } };
    assert.deepEqual(await checkDatabaseHealth(createFakeSupabaseClient), { healthy: false });

    nextQueryOutcome = Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    assert.deepEqual(await checkDatabaseHealth(createFakeSupabaseClient), { healthy: false });

    const missingConfig = () => { throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env."); };
    assert.deepEqual(await checkDatabaseHealth(missingConfig), { healthy: false });
});

test("GET /healthz returns 200/503 with a generic body, works cross-site, and rejects query params", async (t) => {
    silenceConsoleError(t);
    const server = app.listen(0);
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    try {
        nextQueryOutcome = { error: null };
        const healthy = await fetch(`${baseUrl}/healthz`, { headers: { "Sec-Fetch-Site": "cross-site" } });
        assert.equal(healthy.status, 200);
        assert.equal(healthy.headers.get("cache-control"), "no-store");
        assert.deepEqual(await healthy.json(), { status: "ok" });

        nextQueryOutcome = { error: { name: "PostgrestError", message: "secret internal detail" } };
        const unhealthy = await fetch(`${baseUrl}/healthz`);
        assert.equal(unhealthy.status, 503);
        const unhealthyBody = await unhealthy.text();
        assert.equal(unhealthyBody, JSON.stringify({ status: "unavailable" }));
        assert.doesNotMatch(unhealthyBody, /secret internal detail/);

        const withQuery = await fetch(`${baseUrl}/healthz?debug=1`);
        assert.equal(withQuery.status, 400);
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
});
