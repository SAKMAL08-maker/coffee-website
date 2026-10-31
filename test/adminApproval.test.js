const test = require("node:test");
const assert = require("node:assert/strict");
const {
    canApprove,
    describeSetupState,
    approveAdminSetup,
    listAdminAccounts,
    provisionAdminSetup,
    APPROVED_SETUP_TTL_MS
} = require("../services/adminApprovalService");
const { hasPreapprovedSetup, hashSetupToken } = require("../services/adminMfa");

const NOW = Date.parse("2026-10-31T00:00:00Z");
const LATER = new Date(NOW + 60_000).toISOString();
const EARLIER = new Date(NOW - 60_000).toISOString();
const HASH = "a".repeat(64);

// Minimal Supabase stand-in: records updates and serves one coffee_users row.
function fakeSupabase({ account, factors = [], missingPreapprovalColumn = false }) {
    const calls = { updates: [], deletedFactors: [] };
    const supabase = {
        calls,
        from() {
            const filters = [];
            let values = null;
            const query = {
                select: () => query,
                eq: (column, value) => (filters.push([column, value]), query),
                is: () => query,
                gt: () => query,
                order: () => Promise.resolve({ data: account ? [account] : [], error: null }),
                update(nextValues) {
                    values = nextValues;
                    if (missingPreapprovalColumn && "admin_mfa_setup_preapproved" in nextValues) {
                        const error = {
                            code: "PGRST204",
                            message: "Could not find the 'admin_mfa_setup_preapproved' column"
                        };
                        // Every filter keeps chaining; awaiting it (or maybeSingle) yields the error.
                        const failed = {
                            select: () => failed,
                            eq: () => failed,
                            is: () => failed,
                            gt: () => failed,
                            maybeSingle: () => Promise.resolve({ data: null, error }),
                            then: (resolve) => resolve({ data: null, error })
                        };
                        return failed;
                    }
                    calls.updates.push(nextValues);
                    return query;
                },
                maybeSingle: () => Promise.resolve({ data: values ? { id: account.id } : account, error: null }),
                then: (resolve) => resolve({ data: null, error: null })
            };
            return query;
        },
        auth: {
            admin: {
                mfa: {
                    listFactors: async () => ({ data: { factors }, error: null }),
                    deleteFactor: async ({ id }) => (calls.deletedFactors.push(id), { error: null })
                }
            }
        }
    };
    return supabase;
}

const linkedAdmin = (overrides = {}) => ({
    id: "admin-2",
    username: "arthur_admin",
    role: "admin",
    supabase_auth_user_id: "auth-2",
    admin_mfa_factor_id: null,
    admin_mfa_pending_factor_id: null,
    admin_mfa_setup_token_hash: null,
    admin_mfa_setup_token_expires_at: null,
    ...overrides
});

test("approver allow-list: unset means any verified admin; set means only those names", () => {
    assert.equal(canApprove("anyone", ""), true);
    assert.equal(canApprove("Owner_Admin", "owner_admin, second"), true);
    assert.equal(canApprove("arthur_admin", "owner_admin"), false);
});

test("setup states shown in the admin page", () => {
    assert.equal(describeSetupState(linkedAdmin({ admin_mfa_factor_id: "f1" }), NOW), "active");
    assert.equal(describeSetupState(linkedAdmin(), NOW), "needs-approval");
    const approved = { admin_mfa_setup_token_hash: HASH, admin_mfa_setup_token_expires_at: LATER };
    assert.equal(describeSetupState(linkedAdmin(approved), NOW), "setup-approved");
    assert.equal(
        describeSetupState(linkedAdmin({ ...approved, admin_mfa_pending_factor_id: "f2" }), NOW),
        "setup-in-progress"
    );
    const expired = { admin_mfa_setup_token_hash: HASH, admin_mfa_setup_token_expires_at: EARLIER };
    assert.equal(describeSetupState(linkedAdmin(expired), NOW), "needs-approval");
});

test("approval skips the typed key only while it is active and flagged", () => {
    const base = { admin_mfa_setup_token_hash: HASH, admin_mfa_setup_token_expires_at: LATER };
    assert.equal(hasPreapprovedSetup({ ...base, admin_mfa_setup_preapproved: true }, NOW), true);
    assert.equal(hasPreapprovedSetup({ ...base, admin_mfa_setup_preapproved: false }, NOW), false);
    assert.equal(
        hasPreapprovedSetup(
            { ...base, admin_mfa_setup_token_expires_at: EARLIER, admin_mfa_setup_preapproved: true },
            NOW
        ),
        false,
        "expired approval"
    );
    assert.equal(
        hasPreapprovedSetup({ admin_mfa_setup_preapproved: true, admin_mfa_setup_token_hash: null }, NOW),
        false,
        "flag alone is not enough"
    );
});

test("approving a new admin clears factors and stores a 24-hour, key-free authorization", async () => {
    const supabase = fakeSupabase({ account: linkedAdmin(), factors: [{ id: "stale" }] });
    const result = await approveAdminSetup(supabase, {
        approver: { username: "owner_admin" },
        username: "Arthur_Admin",
        now: NOW
    });
    assert.equal(result.setupToken, null, "no key is ever shown for an in-app approval");
    assert.equal(result.expiresAt, new Date(NOW + APPROVED_SETUP_TTL_MS).toISOString());
    assert.deepEqual(supabase.calls.deletedFactors, ["stale"]);
    const finalUpdate = supabase.calls.updates.at(-1);
    assert.equal(finalUpdate.admin_mfa_setup_preapproved, true);
    assert.match(finalUpdate.admin_mfa_setup_token_hash, /^[a-f0-9]{64}$/);
});

test("approval refuses self, non-admins, unlinked admins, and active authenticators without reset", async () => {
    const approver = { username: "owner_admin" };
    await assert.rejects(
        approveAdminSetup(fakeSupabase({ account: linkedAdmin() }), { approver, username: "OWNER_ADMIN" }),
        { statusCode: 400 }
    );
    await assert.rejects(
        approveAdminSetup(fakeSupabase({ account: linkedAdmin({ role: "customer" }) }), {
            approver,
            username: "arthur_admin"
        }),
        { statusCode: 404 }
    );
    await assert.rejects(
        approveAdminSetup(fakeSupabase({ account: linkedAdmin({ supabase_auth_user_id: null }) }), {
            approver,
            username: "arthur_admin"
        }),
        { statusCode: 409 }
    );
    const active = fakeSupabase({ account: linkedAdmin({ admin_mfa_factor_id: "f1" }), factors: [{ id: "f1" }] });
    await assert.rejects(approveAdminSetup(active, { approver, username: "arthur_admin" }), { statusCode: 409 });
    assert.deepEqual(active.calls.deletedFactors, [], "nothing is deleted without an explicit reset");
    await approveAdminSetup(active, { approver, username: "arthur_admin", resetExisting: true, now: NOW });
    assert.deepEqual(active.calls.deletedFactors, ["f1"]);
});

test("allow-list blocks admins who are not approvers", async () => {
    const previous = process.env.ADMIN_APPROVER_USERNAMES;
    process.env.ADMIN_APPROVER_USERNAMES = "owner_admin";
    try {
        await assert.rejects(
            approveAdminSetup(fakeSupabase({ account: linkedAdmin() }), {
                approver: { username: "someone_else" },
                username: "arthur_admin"
            }),
            { statusCode: 403 }
        );
    } finally {
        if (previous === undefined) delete process.env.ADMIN_APPROVER_USERNAMES;
        else process.env.ADMIN_APPROVER_USERNAMES = previous;
    }
});

test("the terminal script still issues a typed key, and still works before the migration", async () => {
    const supabase = fakeSupabase({ account: linkedAdmin(), missingPreapprovalColumn: true });
    const result = await provisionAdminSetup(supabase, linkedAdmin(), {
        preapproved: false,
        ttlMs: 30 * 60 * 1000,
        now: NOW
    });
    assert.equal(supabase.calls.updates.at(-1).admin_mfa_setup_token_hash, hashSetupToken(result.setupToken));
    assert.ok(!("admin_mfa_setup_preapproved" in supabase.calls.updates.at(-1)));
});

test("an in-app approval before the migration fails clearly instead of half-working", async () => {
    const supabase = fakeSupabase({ account: linkedAdmin(), missingPreapprovalColumn: true });
    await assert.rejects(provisionAdminSetup(supabase, linkedAdmin(), { preapproved: true, ttlMs: 1000, now: NOW }), {
        statusCode: 503
    });
});

test("admin list hides hashes and reports each admin's state", async () => {
    const accounts = await listAdminAccounts(fakeSupabase({ account: linkedAdmin() }), NOW);
    assert.deepEqual(accounts, [
        {
            username: "arthur_admin",
            createdAt: undefined,
            canSignIn: true,
            state: "needs-approval",
            setupExpiresAt: null
        }
    ]);
});
