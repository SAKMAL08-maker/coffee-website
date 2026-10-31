require("dotenv").config({ quiet: true });

const { getAdminClient } = require("../config/supabase");
const { hashPassword, createRecoveryCode, hashRecoveryCode } = require("../services/accountSecurity");
const { provisionAdminSetup } = require("../services/adminApprovalService");

// Creates a ready-to-link admin in one step: a confirmed Supabase Auth user (the
// admin password lives there) plus the linked Coffee Lab account with role admin.
// With --approve-setup-days N, the admin can also enroll their authenticator by
// scanning a QR code, without a typed setup key, for N days (needs the
// 20261104000000_admin_setup_preapproval migration).
async function createAdminAccount({ username, email, password, approveSetupDays = 0 }) {
    const usernameKey = username.trim().toLowerCase();
    if (!/^[a-z0-9_]{3,24}$/.test(usernameKey)) throw new Error("Usernames use 3-24 letters, numbers or _.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Provide a valid --email.");
    if (!password || password.length < 8) throw new Error("Set NEW_ADMIN_PASSWORD (8+ characters).");
    if (!Number.isInteger(approveSetupDays) || approveSetupDays < 0 || approveSetupDays > 7) {
        throw new Error("--approve-setup-days must be 0-7.");
    }

    const supabase = getAdminClient();
    const { data: existing, error: existingError } = await supabase
        .from("coffee_users")
        .select("id")
        .eq("username_key", usernameKey)
        .maybeSingle();
    if (existingError) throw existingError;
    if (existing) throw new Error(`The username ${usernameKey} is already taken.`);

    const { data: created, error: authError } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true
    });
    if (authError) throw authError;
    const authUserId = created.user.id;

    try {
        // Same function customer sign-up uses; the recovery codes aren't shown
        // because admins sign in with the Supabase Auth password above.
        const recoveryCodes = Array.from({ length: 10 }, createRecoveryCode);
        const { data: accountId, error: createError } = await supabase.rpc("create_coffee_account", {
            p_username: usernameKey,
            p_password_hash: await hashPassword(password),
            p_recovery_code_hashes: recoveryCodes.map(hashRecoveryCode)
        });
        if (createError) throw createError;

        const { data: account, error: linkError } = await supabase
            .from("coffee_users")
            .update({ role: "admin", supabase_auth_user_id: authUserId, updated_at: new Date().toISOString() })
            .eq("id", accountId)
            .select("id, username, role, supabase_auth_user_id")
            .single();
        if (linkError) throw linkError;

        const setup = approveSetupDays
            ? await provisionAdminSetup(supabase, account, {
                  preapproved: true,
                  ttlMs: approveSetupDays * 24 * 60 * 60 * 1000
              })
            : null;
        return { username: account.username, role: account.role, setupApprovedUntil: setup?.expiresAt || null };
    } catch (error) {
        // Don't leave a Supabase Auth user behind without its Coffee Lab account.
        await supabase.from("coffee_users").delete().eq("supabase_auth_user_id", authUserId);
        await supabase.auth.admin.deleteUser(authUserId);
        throw error;
    }
}

function readFlag(name) {
    const index = process.argv.indexOf(name);
    return index > 0 ? process.argv[index + 1] : undefined;
}

async function main() {
    const username = process.argv[2];
    const email = readFlag("--email");
    if (!username || username.startsWith("--") || !email) {
        throw new Error(
            "Usage: NEW_ADMIN_PASSWORD=... node scripts/create-admin-account.js <username> --email <email> [--approve-setup-days 1]"
        );
    }
    const result = await createAdminAccount({
        username,
        email,
        password: process.env.NEW_ADMIN_PASSWORD,
        approveSetupDays: Number(readFlag("--approve-setup-days") || 0)
    });
    console.log(`Created ${result.role} ${result.username}.`);
    console.log(
        result.setupApprovedUntil
            ? `Authenticator setup approved until ${result.setupApprovedUntil}: they scan a QR code at first sign-in.`
            : "Approve their authenticator setup from Admin access on the admin page (or run admin-mfa-bootstrap.js)."
    );
}

if (require.main === module) {
    main().catch((error) => {
        console.error("Creating the admin failed:", error.message);
        process.exitCode = 1;
    });
}

module.exports = { createAdminAccount };
