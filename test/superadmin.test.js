const test = require("node:test");
const assert = require("node:assert/strict");
const { hashPassword } = require("../services/accountSecurity");
const {
    normalizeAnswer,
    hashAnswers,
    signInSuperadmin,
    demoteAdmin,
    deleteAccount
} = require("../services/superadminService");
const { requireAdmin, requireSuperadmin } = require("../middleware/authenticate");

const ANSWERS = { birthday: "01022000", favoriteDog: "Rex", favoriteColor: "Blue" };

// In-memory stand-in for the two tables and the lockout functions.
async function fakeDatabase({ locked = false, failedAttempts = 0 } = {}) {
    const state = {
        account: {
            id: "sa-1",
            username: "Super_Admin",
            role: "superadmin",
            created_at: "2026-10-31T00:00:00Z",
            password_hash: await hashPassword("correct horse")
        },
        security: { ...(await hashAnswers(ANSWERS)), failed_attempts: failedAttempts, locked },
        rpcCalls: []
    };
    const supabase = {
        from(table) {
            const query = {
                select: () => query,
                eq: () => query,
                maybeSingle: async () => ({
                    data: table === "coffee_users" ? state.account : state.security,
                    error: null
                })
            };
            return query;
        },
        async rpc(name) {
            state.rpcCalls.push(name);
            if (name === "superadmin_record_failure") {
                state.security.failed_attempts += 1;
                state.security.locked = state.security.locked || state.security.failed_attempts >= 3;
                return {
                    data: [{ failed_attempts: state.security.failed_attempts, locked: state.security.locked }],
                    error: null
                };
            }
            state.security.failed_attempts = 0;
            return { data: null, error: null };
        }
    };
    return { supabase, state };
}

test("answers ignore case and spacing; the birthday matches by digits", () => {
    assert.equal(normalizeAnswer("text", "  Light   BLUE "), "light blue");
    assert.equal(normalizeAnswer("birthday", "01/02/2000"), "01022000");
});

test("the right password and all three answers sign in and reset the count", async () => {
    const { supabase, state } = await fakeDatabase({ failedAttempts: 2 });
    const result = await signInSuperadmin(supabase, {
        password: "correct horse",
        birthday: "01-02-2000",
        favoriteDog: "rex",
        favoriteColor: " BLUE "
    });
    assert.equal(result.user.username, "Super_Admin");
    assert.equal(result.user.password_hash, undefined, "the hash never leaves the service");
    assert.deepEqual(state.rpcCalls, ["superadmin_record_success"]);
    assert.equal(state.security.failed_attempts, 0);
});

test("any one wrong answer fails, and the third failure locks the account", async () => {
    const { supabase, state } = await fakeDatabase();
    const wrong = { password: "correct horse", ...ANSWERS, favoriteColor: "Green" };
    assert.deepEqual(await signInSuperadmin(supabase, wrong), { locked: false, attemptsLeft: 2 });
    assert.deepEqual(await signInSuperadmin(supabase, { ...wrong, password: "nope" }), {
        locked: false,
        attemptsLeft: 1
    });
    assert.deepEqual(await signInSuperadmin(supabase, wrong), { locked: true, attemptsLeft: 0 });
    // Once locked, even the correct details are refused without counting again.
    const before = state.rpcCalls.length;
    const correct = await signInSuperadmin(supabase, { password: "correct horse", ...ANSWERS });
    assert.deepEqual(correct, { locked: true, attemptsLeft: 0 });
    assert.equal(state.rpcCalls.length, before);
});

test("no superadmin account means a plain failure, nothing recorded", async () => {
    const supabase = {
        from: () => {
            const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: null }) };
            return query;
        },
        rpc: async () => assert.fail("nothing to record")
    };
    assert.deepEqual(await signInSuperadmin(supabase, { password: "x", ...ANSWERS }), {
        locked: false,
        attemptsLeft: null
    });
});

function accountsDatabase(account, { deleteError = null } = {}) {
    const calls = { updates: [], deletes: [], deletedAuthUsers: [] };
    const supabase = {
        calls,
        from(table) {
            const query = {
                select: () => query,
                eq: () => query,
                maybeSingle: async () => ({ data: account, error: null }),
                update: (values) => (calls.updates.push(values), query),
                delete: () => (calls.deletes.push(table), query),
                then: (resolve) =>
                    resolve({ error: table === "coffee_users" && calls.deletes.length ? deleteError : null })
            };
            return query;
        },
        auth: {
            admin: { deleteUser: async (id) => (calls.deletedAuthUsers.push(id), { error: null }) }
        }
    };
    return supabase;
}

const actor = { username: "Super_Admin" };
const admin = { id: "a-1", username: "arthur_admin", role: "admin", supabase_auth_user_id: "auth-1" };

test("demoting an admin makes them a customer and removes their admin sign-in", async () => {
    const supabase = accountsDatabase(admin);
    assert.deepEqual(await demoteAdmin(supabase, { actor, username: "Arthur_Admin" }), {
        username: "arthur_admin",
        role: "customer"
    });
    assert.equal(supabase.calls.updates[0].role, "customer");
    assert.equal(supabase.calls.updates[0].supabase_auth_user_id, null);
    assert.deepEqual(supabase.calls.deletedAuthUsers, ["auth-1"]);
    assert.ok(supabase.calls.deletes.includes("coffee_sessions"), "their sessions end too");
});

test("guards: not yourself, not the superadmin, only admins can be demoted", async () => {
    await assert.rejects(demoteAdmin(accountsDatabase(admin), { actor, username: "super_admin" }), {
        statusCode: 400
    });
    await assert.rejects(
        deleteAccount(accountsDatabase({ ...admin, role: "superadmin" }), { actor, username: "other" }),
        { statusCode: 403 }
    );
    await assert.rejects(
        demoteAdmin(accountsDatabase({ ...admin, role: "customer" }), { actor, username: "arthur_admin" }),
        { statusCode: 409 }
    );
});

test("deleting an admin who approved orders is refused so history stays intact", async () => {
    const supabase = accountsDatabase(admin, { deleteError: { code: "23503", message: "fk" } });
    await assert.rejects(deleteAccount(supabase, { actor, username: "arthur_admin" }), { statusCode: 409 });
    assert.deepEqual(supabase.calls.deletedAuthUsers, [], "sign-in is kept when the delete didn't happen");
});

function runGuard(guard, request) {
    let status = 200;
    let passed = false;
    guard(request, { status: (code) => ((status = code), { json: () => {} }) }, () => (passed = true));
    return passed ? "next" : status;
}

test("superadmin sessions pass admin checks; nothing else gets superadmin powers", () => {
    const superadmin = { user: { role: "superadmin" }, authMethod: "superadmin-session" };
    assert.equal(runGuard(requireAdmin, superadmin), "next");
    assert.equal(runGuard(requireSuperadmin, superadmin), "next");
    const verifiedAdmin = { user: { role: "admin" }, authMethod: "supabase-mfa", aal: "aal2" };
    assert.equal(runGuard(requireAdmin, verifiedAdmin), "next");
    assert.equal(runGuard(requireSuperadmin, verifiedAdmin), 403);
    // A superadmin role without the superadmin sign-in method is not trusted.
    assert.equal(runGuard(requireAdmin, { user: { role: "superadmin" }, authMethod: "coffee-session" }), 403);
    assert.equal(runGuard(requireSuperadmin, { user: { role: "customer" }, authMethod: "coffee-session" }), 403);
});
