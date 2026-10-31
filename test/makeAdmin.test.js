const test = require("node:test");
const assert = require("node:assert/strict");
const { makeAdmin } = require("../services/superadminService");

// Chainable stand-in for the Supabase client. maybeSingle() answers from a queue
// (the account lookup first, then each update), plain awaits succeed.
function fakeSupabase({ rows, createUserError = null }) {
    const calls = { updates: [], deletes: [], createdUsers: [], deletedUsers: [] };
    const supabase = {
        calls,
        from(table) {
            const query = {
                select: () => query,
                eq: () => query,
                is: () => query,
                update: (values) => (calls.updates.push(values), query),
                delete: () => (calls.deletes.push(table), query),
                maybeSingle: async () => ({ data: rows.shift() ?? null, error: null }),
                then: (resolve) => resolve({ error: null })
            };
            return query;
        },
        auth: {
            admin: {
                async createUser(options) {
                    calls.createdUsers.push(options);
                    return createUserError
                        ? { data: null, error: createUserError }
                        : { data: { user: { id: "auth-new" } }, error: null };
                },
                async deleteUser(id) {
                    calls.deletedUsers.push(id);
                    return { error: null };
                },
                mfa: { listFactors: async () => ({ data: { factors: [] }, error: null }) }
            }
        }
    };
    return supabase;
}

const actor = { username: "Super_Admin" };
const customer = { id: "c-1", username: "maria", role: "customer", supabase_auth_user_id: null };
const NOW = Date.parse("2026-10-31T00:00:00Z");

test("making a customer an admin links a sign-in, ends their sessions and approves setup", async () => {
    const supabase = fakeSupabase({ rows: [customer, { id: "c-1" }, { id: "c-1" }] });
    const result = await makeAdmin(supabase, { actor, username: "Maria", email: "maria@coffeelab.test", now: NOW });

    assert.deepEqual(result, { username: "maria", role: "admin", setupExpiresAt: "2026-11-01T00:00:00.000Z" });
    const [created] = supabase.calls.createdUsers;
    assert.equal(created.email, "maria@coffeelab.test");
    assert.equal(created.email_confirm, true);
    assert.ok(created.password.length >= 32, "a random password nobody sees; their own is adopted at first sign-in");
    assert.equal(supabase.calls.updates[0].role, "admin");
    assert.equal(supabase.calls.updates[0].supabase_auth_user_id, "auth-new");
    assert.ok(supabase.calls.deletes.includes("coffee_sessions"));
    assert.equal(supabase.calls.updates.at(-1).admin_mfa_setup_preapproved, true, "no key to type");
});

test("only customers can be made admins, and never yourself or the superadmin", async () => {
    await assert.rejects(
        makeAdmin(fakeSupabase({ rows: [{ ...customer, role: "admin" }] }), {
            actor,
            username: "maria",
            email: "a@b.co"
        }),
        { statusCode: 409 }
    );
    await assert.rejects(makeAdmin(fakeSupabase({ rows: [] }), { actor, username: "super_admin", email: "a@b.co" }), {
        statusCode: 400
    });
    await assert.rejects(
        makeAdmin(fakeSupabase({ rows: [{ ...customer, role: "superadmin" }] }), {
            actor,
            username: "maria",
            email: "a@b.co"
        }),
        { statusCode: 403 }
    );
});

test("an email already in use is refused and nothing changes", async () => {
    const supabase = fakeSupabase({ rows: [customer], createUserError: { code: "email_exists", status: 422 } });
    await assert.rejects(makeAdmin(supabase, { actor, username: "maria", email: "taken@coffeelab.test" }), {
        statusCode: 409
    });
    assert.deepEqual(supabase.calls.updates, []);
});

test("if the account changed meanwhile, the new sign-in is removed again", async () => {
    const supabase = fakeSupabase({ rows: [customer, null] });
    await assert.rejects(makeAdmin(supabase, { actor, username: "maria", email: "maria@coffeelab.test" }), {
        statusCode: 409
    });
    assert.deepEqual(supabase.calls.deletedUsers, ["auth-new"]);
});
