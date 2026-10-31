const { createHash, randomBytes } = require("node:crypto");

const APPROVED_SETUP_TTL_MS = 24 * 60 * 60 * 1000;

function httpError(statusCode, message) {
    return Object.assign(new Error(message), { statusCode });
}

// Optional allow-list: when ADMIN_APPROVER_USERNAMES is set, only those admins
// can approve or reset other admins. Unset means any MFA-verified admin can.
function canApprove(approverUsername, configured = process.env.ADMIN_APPROVER_USERNAMES) {
    const allowed = (configured || "")
        .split(",")
        .map((name) => name.trim().toLowerCase())
        .filter(Boolean);
    return allowed.length === 0 || allowed.includes(String(approverUsername).toLowerCase());
}

// PGRST204: PostgREST doesn't know the column; 42703: Postgres doesn't.
function isMissingPreapprovalColumn(error) {
    return ["PGRST204", "42703"].includes(error?.code) && /admin_mfa_setup_preapproved/.test(error.message || "");
}

// Writes admin_mfa_setup_preapproved when the migration is applied. Before it is,
// a key-based setup (the terminal script) still works; an in-app approval can't.
async function updateWithPreapproval(runUpdate, values, preapproved) {
    const result = await runUpdate({ ...values, admin_mfa_setup_preapproved: preapproved });
    if (!isMissingPreapprovalColumn(result.error)) return result;
    if (preapproved) {
        throw httpError(503, "Apply the admin setup approval migration in Supabase before approving admins here.");
    }
    return runUpdate(values);
}

function describeSetupState(account, now = Date.now()) {
    if (account.admin_mfa_factor_id) return "active";
    const expiresAt = Date.parse(account.admin_mfa_setup_token_expires_at);
    const isActive = Boolean(account.admin_mfa_setup_token_hash) && Number.isFinite(expiresAt) && expiresAt > now;
    if (isActive && account.admin_mfa_pending_factor_id) return "setup-in-progress";
    if (isActive) return "setup-approved";
    return "needs-approval";
}

/**
 * Clears the admin's authenticators and approves a new setup: at their next sign-in
 * the admin scans a QR code, with no key to type, until the approval expires.
 */
async function provisionAdminSetup(supabase, account, { ttlMs = APPROVED_SETUP_TTL_MS, now = Date.now() } = {}) {
    const { error: lockError } = await updateWithPreapproval(
        (values) => supabase.from("coffee_users").update(values).eq("id", account.id).eq("role", "admin"),
        {
            admin_mfa_factor_id: null,
            admin_mfa_pending_factor_id: null,
            admin_mfa_setup_token_hash: null,
            admin_mfa_setup_token_expires_at: null,
            updated_at: new Date(now).toISOString()
        },
        false
    );
    if (lockError) throw lockError;

    const { data: factorData, error: factorError } = await supabase.auth.admin.mfa.listFactors({
        userId: account.supabase_auth_user_id
    });
    if (factorError) throw factorError;
    for (const factor of factorData.factors) {
        const { error } = await supabase.auth.admin.mfa.deleteFactor({
            id: factor.id,
            userId: account.supabase_auth_user_id
        });
        if (error) throw error;
    }

    // An approved setup still stores a (never shown) token hash, so the existing
    // "authorization is active" checks and database constraint keep working.
    const setupToken = randomBytes(32).toString("base64url");
    const expiresAt = new Date(now + ttlMs).toISOString();
    const { data: updated, error: provisionError } = await updateWithPreapproval(
        (values) =>
            supabase
                .from("coffee_users")
                .update(values)
                .eq("id", account.id)
                .eq("role", "admin")
                .is("admin_mfa_factor_id", null)
                .is("admin_mfa_pending_factor_id", null)
                .select("id")
                .maybeSingle(),
        {
            admin_mfa_setup_token_hash: createHash("sha256").update(setupToken).digest("hex"),
            admin_mfa_setup_token_expires_at: expiresAt,
            updated_at: new Date(now).toISOString()
        },
        true
    );
    if (provisionError) throw provisionError;
    if (!updated) throw new Error("Could not provision the setup authorization.");
    return {
        username: account.username,
        expiresAt,
        removedFactors: factorData.factors.length
    };
}

const ACCOUNT_COLUMNS =
    "id, username, role, created_at, supabase_auth_user_id, admin_mfa_factor_id, admin_mfa_pending_factor_id, admin_mfa_setup_token_hash, admin_mfa_setup_token_expires_at";

async function listAdminAccounts(supabase, now = Date.now()) {
    const { data, error } = await supabase
        .from("coffee_users")
        .select(ACCOUNT_COLUMNS)
        .eq("role", "admin")
        .order("created_at", { ascending: true });
    if (error) throw error;
    return data.map((account) => ({
        username: account.username,
        createdAt: account.created_at,
        canSignIn: Boolean(account.supabase_auth_user_id),
        state: account.supabase_auth_user_id ? describeSetupState(account, now) : "not-linked",
        setupExpiresAt: account.admin_mfa_factor_id ? null : account.admin_mfa_setup_token_expires_at
    }));
}

async function approveAdminSetup(supabase, { approver, username, resetExisting = false, now = Date.now() }) {
    if (!canApprove(approver.username)) {
        throw httpError(403, "Only the admins listed in ADMIN_APPROVER_USERNAMES can approve other admins.");
    }
    const usernameKey = String(username).trim().toLowerCase();
    if (usernameKey === String(approver.username).toLowerCase()) {
        throw httpError(400, "You can't approve or reset your own authenticator here.");
    }
    const { data: account, error } = await supabase
        .from("coffee_users")
        .select(ACCOUNT_COLUMNS)
        .eq("username_key", usernameKey)
        .maybeSingle();
    if (error) throw error;
    if (!account || account.role !== "admin") throw httpError(404, "That admin account was not found.");
    if (!account.supabase_auth_user_id) {
        throw httpError(409, "That admin isn't linked to a Supabase sign-in yet, so it can't be approved.");
    }
    if (account.admin_mfa_factor_id && !resetExisting) {
        throw httpError(409, "That admin already has an authenticator. Use Reset if they lost it.");
    }
    return provisionAdminSetup(supabase, account, { now });
}

module.exports = {
    APPROVED_SETUP_TTL_MS,
    canApprove,
    isMissingPreapprovalColumn,
    updateWithPreapproval,
    describeSetupState,
    provisionAdminSetup,
    listAdminAccounts,
    approveAdminSetup
};
