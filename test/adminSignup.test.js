const test = require("node:test");
const assert = require("node:assert/strict");
const schemas = require("../schemas/requestSchemas");
const {
    PENDING_ADMIN_ROLE,
    MAX_PENDING_REQUESTS,
    requestAdminAccount,
    approveAdminRequest
} = require("../services/adminSignupService");

// Chainable stand-in for the Supabase client: every query resolves to the next
// queued maybeSingle() result, and plain awaits succeed unless told otherwise.
function fakeSupabase({ pendingCount = 0, rows = [], createUserError = null } = {}) {
    const calls = { updates: [], deletes: 0, createdUsers: [], deletedUsers: [], confirmed: [], rpc: [] };
    const supabase = {
        calls,
        from() {
            const query = {
                select: () => query,
                eq: () => query,
                is: () => query,
                update: (values) => (calls.updates.push(values), query),
                delete: () => (calls.deletes++, query),
                maybeSingle: async () => ({ data: rows.shift() ?? null, error: null }),
                then: (resolve) => resolve({ count: pendingCount, error: null })
            };
            return query;
        },
        async rpc(name, args) {
            calls.rpc.push({ name, args });
            return { data: "account-1", error: null };
        },
        auth: {
            admin: {
                async createUser(options) {
                    calls.createdUsers.push(options);
                    return createUserError
                        ? { data: null, error: createUserError }
                        : { data: { user: { id: "auth-1" } }, error: null };
                },
                async deleteUser(id) {
                    calls.deletedUsers.push(id);
                    return { error: null };
                },
                async updateUserById(id, values) {
                    calls.confirmed.push({ id, values });
                    return { error: null };
                },
                mfa: { listFactors: async () => ({ data: { factors: [] }, error: null }) }
            }
        }
    };
    return supabase;
}

const request = { username: "new_admin", email: "new@coffeelab.test", password: "a long enough password" };

test("an admin request waits as pending_admin with an unconfirmed sign-in", async () => {
    const supabase = fakeSupabase();
    assert.deepEqual(await requestAdminAccount(supabase, request), {
        username: "new_admin",
        role: PENDING_ADMIN_ROLE
    });
    assert.equal(supabase.calls.createdUsers[0].email_confirm, false, "Supabase sign-in stays unusable");
    assert.equal(supabase.calls.updates[0].role, PENDING_ADMIN_ROLE);
    assert.equal(supabase.calls.updates[0].supabase_auth_user_id, "auth-1");
});

test("a used email is refused and the reserved username is released", async () => {
    const supabase = fakeSupabase({ createUserError: { code: "email_exists", status: 422 } });
    await assert.rejects(requestAdminAccount(supabase, request), { statusCode: 409 });
    assert.equal(supabase.calls.deletes, 1);
});

test("requests stop being accepted while too many are waiting", async () => {
    const supabase = fakeSupabase({ pendingCount: MAX_PENDING_REQUESTS });
    await assert.rejects(requestAdminAccount(supabase, request), { statusCode: 429 });
    assert.equal(supabase.calls.rpc.length, 0, "nothing is created");
});

test("approving confirms the sign-in, makes an admin and approves authenticator setup", async () => {
    const pending = {
        id: "account-1",
        username: "new_admin",
        role: PENDING_ADMIN_ROLE,
        supabase_auth_user_id: "auth-1"
    };
    const supabase = fakeSupabase({ rows: [pending, { id: "account-1" }, { id: "account-1" }] });
    const result = await approveAdminRequest(supabase, {
        username: "New_Admin",
        now: Date.parse("2026-10-31T00:00:00Z")
    });
    assert.equal(result.role, "admin");
    assert.equal(result.setupExpiresAt, "2026-11-01T00:00:00.000Z");
    assert.deepEqual(supabase.calls.confirmed, [{ id: "auth-1", values: { email_confirm: true } }]);
    assert.equal(supabase.calls.updates[0].role, "admin");
});

test("only pending requests can be approved", async () => {
    const customer = { id: "c-1", username: "someone", role: "customer", supabase_auth_user_id: null };
    await assert.rejects(approveAdminRequest(fakeSupabase({ rows: [customer] }), { username: "someone" }), {
        statusCode: 404
    });
    await assert.rejects(approveAdminRequest(fakeSupabase(), { username: "nobody" }), { statusCode: 404 });
});

test("sign-up defaults to a customer; the Admin tab needs an email", () => {
    const body = schemas.signup.body;
    assert.equal(body.parse({ username: "abc", password: "x".repeat(12) }).accountType, "customer");
    assert.equal(body.safeParse({ username: "abc", password: "x".repeat(12), accountType: "admin" }).success, false);
    const admin = body.parse({ ...request, email: " New@CoffeeLab.test ", accountType: "admin" });
    assert.equal(admin.email, "new@coffeelab.test");
    assert.equal(body.safeParse({ ...request, accountType: "staff" }).success, false);
});
