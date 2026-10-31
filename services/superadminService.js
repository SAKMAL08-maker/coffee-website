const { randomBytes } = require("node:crypto");
const { hashPassword, verifyPassword } = require("./accountSecurity");
const { provisionAdminSetup } = require("./adminApprovalService");

const SUPERADMIN_USERNAME_KEY = "super_admin";
const MAX_FAILED_ATTEMPTS = 3;

function httpError(statusCode, message) {
    return Object.assign(new Error(message), { statusCode });
}

// Answers are compared case- and spacing-insensitively; the birthday by its digits
// only, so "01/02/2000" and "01022000" match.
function normalizeAnswer(kind, value) {
    const text = String(value ?? "");
    if (kind === "birthday") return text.replace(/\D/g, "");
    return text.trim().toLowerCase().replace(/\s+/g, " ");
}

async function hashAnswers({ birthday, favoriteDog, favoriteColor }) {
    return {
        birthday_hash: await hashPassword(normalizeAnswer("birthday", birthday)),
        favorite_dog_hash: await hashPassword(normalizeAnswer("text", favoriteDog)),
        favorite_color_hash: await hashPassword(normalizeAnswer("text", favoriteColor))
    };
}

// Same work whether or not an answer is empty, so timing doesn't reveal which part was wrong.
async function matches(answer, hash) {
    return Boolean(hash) && verifyPassword(answer || "-", hash);
}

/**
 * Password + three answers. Returns { user } on success, or { locked, attemptsLeft }.
 * A locked account is refused before anything is checked.
 */
async function signInSuperadmin(supabase, { password, birthday, favoriteDog, favoriteColor }) {
    const { data: account, error: accountError } = await supabase
        .from("coffee_users")
        .select("id, username, role, created_at, password_hash")
        .eq("username_key", SUPERADMIN_USERNAME_KEY)
        .eq("role", "superadmin")
        .maybeSingle();
    if (accountError) throw accountError;
    if (!account) return { locked: false, attemptsLeft: null };

    const { data: security, error: securityError } = await supabase
        .from("superadmin_security")
        .select("birthday_hash, favorite_dog_hash, favorite_color_hash, failed_attempts, locked")
        .eq("account_id", account.id)
        .maybeSingle();
    if (securityError) throw securityError;
    if (!security || security.locked) return { locked: true, attemptsLeft: 0 };

    // Check all four (no early exit), then decide.
    const results = await Promise.all([
        matches(password, account.password_hash),
        matches(normalizeAnswer("birthday", birthday), security.birthday_hash),
        matches(normalizeAnswer("text", favoriteDog), security.favorite_dog_hash),
        matches(normalizeAnswer("text", favoriteColor), security.favorite_color_hash)
    ]);
    if (results.every(Boolean)) {
        const { error } = await supabase.rpc("superadmin_record_success", { p_account_id: account.id });
        if (error) throw error;
        const { password_hash: _passwordHash, ...user } = account;
        return { user };
    }

    const { data, error } = await supabase.rpc("superadmin_record_failure", { p_account_id: account.id });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    return {
        locked: Boolean(row?.locked),
        attemptsLeft: Math.max(MAX_FAILED_ATTEMPTS - (row?.failed_attempts ?? MAX_FAILED_ATTEMPTS), 0)
    };
}

/** Every account with its role and whether it is signed in right now. */
async function listAccounts(supabase, now = Date.now()) {
    const { data: accounts, error } = await supabase
        .from("coffee_users")
        .select("id, username, role, created_at, supabase_auth_user_id, admin_mfa_factor_id")
        .order("created_at", { ascending: true });
    if (error) throw error;

    // Customer and superadmin sign-ins are rows in coffee_sessions.
    const { data: sessions, error: sessionError } = await supabase
        .from("coffee_sessions")
        .select("user_id, created_at, expires_at")
        .gt("expires_at", new Date(now).toISOString());
    if (sessionError) throw sessionError;
    const activeSessions = new Map();
    for (const session of sessions) {
        const latest = activeSessions.get(session.user_id);
        if (!latest || session.created_at > latest) activeSessions.set(session.user_id, session.created_at);
    }

    // Admins sign in through Supabase Auth; use its last sign-in time. Looked up in parallel
    // (one request per linked admin), so the page doesn't wait for them one after another.
    const adminSignIns = new Map();
    const linked = accounts.filter((candidate) => candidate.supabase_auth_user_id);
    const lookups = await Promise.all(
        linked.map((account) => supabase.auth.admin.getUserById(account.supabase_auth_user_id))
    );
    lookups.forEach(({ data, error: authError }, index) => {
        if (!authError && data?.user?.last_sign_in_at) adminSignIns.set(linked[index].id, data.user.last_sign_in_at);
    });

    return accounts.map((account) => {
        const sessionStart = activeSessions.get(account.id) || null;
        const lastSignIn = adminSignIns.get(account.id) || sessionStart;
        // Admin sessions last up to a day; treat a sign-in in the last 12 hours as active.
        const adminActive =
            adminSignIns.has(account.id) && now - Date.parse(adminSignIns.get(account.id)) < 12 * 60 * 60 * 1000;
        return {
            username: account.username,
            role: account.role,
            createdAt: account.created_at,
            active: Boolean(sessionStart) || adminActive,
            // An admin counts as set up once they've finished their first approved sign-in.
            ...(account.role === "admin" && { setupComplete: Boolean(account.admin_mfa_factor_id) }),
            lastSignInAt: lastSignIn
        };
    });
}

async function findTarget(supabase, actor, username) {
    const usernameKey = String(username).trim().toLowerCase();
    if (usernameKey === String(actor.username).toLowerCase()) {
        throw httpError(400, "You can't change your own account here.");
    }
    const { data: account, error } = await supabase
        .from("coffee_users")
        .select("id, username, role, supabase_auth_user_id")
        .eq("username_key", usernameKey)
        .maybeSingle();
    if (error) throw error;
    if (!account) throw httpError(404, "That account was not found.");
    if (account.role === "superadmin") throw httpError(403, "The superadmin account can't be changed here.");
    return account;
}

// Removes the admin's Supabase sign-in (ending their admin sessions) and all their
// coffee sessions. Missing auth users are fine (already removed).
async function revokeSignIns(supabase, account) {
    if (account.supabase_auth_user_id) {
        const { error } = await supabase.auth.admin.deleteUser(account.supabase_auth_user_id);
        if (error && error.status !== 404) throw error;
    }
    const { error } = await supabase.from("coffee_sessions").delete().eq("user_id", account.id);
    if (error) throw error;
}

/** Admin → customer: admin rights and admin sign-in removed immediately. */
async function demoteAdmin(supabase, { actor, username }) {
    const account = await findTarget(supabase, actor, username);
    if (account.role !== "admin" && account.role !== "staff") {
        throw httpError(409, "Only admin or staff accounts can be demoted.");
    }
    // Unlink first so the admin's still-valid tokens stop working right away.
    const { error } = await supabase
        .from("coffee_users")
        .update({
            role: "customer",
            supabase_auth_user_id: null,
            admin_mfa_factor_id: null,
            admin_mfa_pending_factor_id: null,
            admin_mfa_setup_token_hash: null,
            admin_mfa_setup_token_expires_at: null,
            admin_mfa_setup_preapproved: false,
            updated_at: new Date().toISOString()
        })
        .eq("id", account.id);
    if (error) throw error;
    await revokeSignIns(supabase, account);
    return { username: account.username, role: "customer" };
}

/**
 * Customer → admin. Creates the admin's Supabase sign-in (with the given email and a random
 * password nobody sees) and approves their authenticator setup. They keep logging in with
 * their username and Coffee Lab password: the first admin sign-in adopts it (adminMfa.js).
 */
async function makeAdmin(supabase, { actor, username, email, now = Date.now() }) {
    const account = await findTarget(supabase, actor, username);
    if (account.role !== "customer") throw httpError(409, "Only customer accounts can be made admins.");

    const { data: created, error: authError } = await supabase.auth.admin.createUser({
        email,
        password: randomBytes(32).toString("base64url"),
        email_confirm: true
    });
    if (authError) {
        if (authError.code === "email_exists" || authError.status === 422) {
            throw httpError(409, "That email is already used by another sign-in. Use a different one.");
        }
        throw authError;
    }

    const { data: promoted, error } = await supabase
        .from("coffee_users")
        .update({ role: "admin", supabase_auth_user_id: created.user.id, updated_at: new Date(now).toISOString() })
        .eq("id", account.id)
        .eq("role", "customer")
        .select("id")
        .maybeSingle();
    if (error || !promoted) {
        await supabase.auth.admin.deleteUser(created.user.id);
        if (error) throw error;
        throw httpError(409, "That account changed while you were making it an admin. Refresh and try again.");
    }
    // Their customer sessions stop working anyway (admins must use the authenticator); remove them.
    const { error: sessionError } = await supabase.from("coffee_sessions").delete().eq("user_id", account.id);
    if (sessionError) throw sessionError;

    const setup = await provisionAdminSetup(
        supabase,
        { ...account, role: "admin", supabase_auth_user_id: created.user.id },
        { now }
    );
    return { username: account.username, role: "admin", setupExpiresAt: setup.expiresAt };
}

/** Deletes the account. Its orders stay (unlinked); saved drinks and sessions go. */
async function deleteAccount(supabase, { actor, username }) {
    const account = await findTarget(supabase, actor, username);
    const { error } = await supabase.from("coffee_users").delete().eq("id", account.id);
    if (error?.code === "23503") {
        throw httpError(
            409,
            "This account approved or collected payment for orders, so deleting it would erase that history. Demote it instead."
        );
    }
    if (error) throw error;
    if (account.supabase_auth_user_id) {
        const { error: authError } = await supabase.auth.admin.deleteUser(account.supabase_auth_user_id);
        if (authError && authError.status !== 404) throw authError;
    }
    return { username: account.username };
}

module.exports = {
    SUPERADMIN_USERNAME_KEY,
    MAX_FAILED_ATTEMPTS,
    normalizeAnswer,
    hashAnswers,
    signInSuperadmin,
    listAccounts,
    demoteAdmin,
    makeAdmin,
    deleteAccount
};
