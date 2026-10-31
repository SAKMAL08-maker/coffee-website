const { createRecoveryCode, hashPassword, hashRecoveryCode } = require("./accountSecurity");
const { APPROVED_SETUP_TTL_MS, provisionAdminSetup } = require("./adminApprovalService");

// Needs supabase/migrations/20261113000000_admin_signup_requests.sql.
const PENDING_ADMIN_ROLE = "pending_admin";
// Each request creates a Supabase Auth user, so cap how many can wait at once.
const MAX_PENDING_REQUESTS = 20;

function httpError(statusCode, message) {
    return Object.assign(new Error(message), { statusCode });
}

/**
 * Sign-up with the Admin tab: a Coffee Lab account plus a Supabase Auth user whose
 * email stays unconfirmed, so neither can be used until the superadmin approves it.
 */
async function requestAdminAccount(supabase, { username, email, password, now = Date.now() }) {
    const { count, error: countError } = await supabase
        .from("coffee_users")
        .select("id", { count: "exact", head: true })
        .eq("role", PENDING_ADMIN_ROLE);
    if (countError) throw countError;
    if (count >= MAX_PENDING_REQUESTS) {
        throw httpError(429, "Too many admin requests are waiting for approval. Try again later.");
    }

    // Reserve the username the same way customer sign-up does. The recovery codes are
    // never shown: admin passwords live in Supabase Auth, which codes can't reset.
    const { data: accountId, error: createError } = await supabase.rpc("create_coffee_account", {
        p_username: username,
        p_password_hash: await hashPassword(password),
        p_recovery_code_hashes: Array.from({ length: 10 }, createRecoveryCode).map(hashRecoveryCode)
    });
    if (createError?.code === "23505") throw httpError(409, "That username is unavailable. Choose another.");
    if (createError) throw createError;

    const { data: created, error: authError } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: false
    });
    if (authError) {
        await supabase.from("coffee_users").delete().eq("id", accountId);
        if (authError.code === "email_exists" || authError.status === 422) {
            throw httpError(409, "That email can't be used for an admin request.");
        }
        throw authError;
    }

    const { error: linkError } = await supabase
        .from("coffee_users")
        .update({
            role: PENDING_ADMIN_ROLE,
            supabase_auth_user_id: created.user.id,
            updated_at: new Date(now).toISOString()
        })
        .eq("id", accountId);
    if (linkError) {
        // Don't leave half a request behind.
        await supabase.from("coffee_users").delete().eq("id", accountId);
        await supabase.auth.admin.deleteUser(created.user.id);
        throw linkError;
    }
    return { username, role: PENDING_ADMIN_ROLE };
}

/**
 * Superadmin approval: confirms the Supabase sign-in, makes the account an admin and
 * approves its authenticator setup for 24 hours, so the new admin can sign in and
 * scan the QR code right away. Declining a request is a plain account delete.
 */
async function approveAdminRequest(supabase, { username, now = Date.now() }) {
    const { data: account, error } = await supabase
        .from("coffee_users")
        .select("id, username, role, supabase_auth_user_id")
        .eq("username_key", String(username).trim().toLowerCase())
        .maybeSingle();
    if (error) throw error;
    if (!account || account.role !== PENDING_ADMIN_ROLE) throw httpError(404, "That admin request was not found.");
    if (!account.supabase_auth_user_id) {
        throw httpError(409, "That request has no sign-in attached. Decline it and ask them to apply again.");
    }

    const { error: confirmError } = await supabase.auth.admin.updateUserById(account.supabase_auth_user_id, {
        email_confirm: true
    });
    if (confirmError) throw confirmError;

    const { data: updated, error: roleError } = await supabase
        .from("coffee_users")
        .update({ role: "admin", updated_at: new Date(now).toISOString() })
        .eq("id", account.id)
        .eq("role", PENDING_ADMIN_ROLE)
        .select("id")
        .maybeSingle();
    if (roleError) throw roleError;
    if (!updated) throw httpError(409, "That request was already handled.");

    const setup = await provisionAdminSetup(
        supabase,
        { ...account, role: "admin" },
        { preapproved: true, ttlMs: APPROVED_SETUP_TTL_MS, now }
    );
    return { username: account.username, role: "admin", setupExpiresAt: setup.expiresAt };
}

module.exports = { PENDING_ADMIN_ROLE, MAX_PENDING_REQUESTS, requestAdminAccount, approveAdminRequest };
