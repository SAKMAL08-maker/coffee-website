require("dotenv").config({ quiet: true });

const { getAdminClient } = require("../config/supabase");
const { hashPassword, createRecoveryCode, hashRecoveryCode } = require("../services/accountSecurity");
const { SUPERADMIN_USERNAME_KEY, hashAnswers } = require("../services/superadminService");

// Creates (or resets) the single superadmin account. The password and the three
// answers come from environment variables so they never appear in the repo or
// in shell history arguments; only scrypt hashes are stored.
async function createSuperadmin({ password, birthday, favoriteDog, favoriteColor }) {
    if (!password || password.length < 8) throw new Error("Set SUPERADMIN_PASSWORD (8+ characters).");
    if (!birthday || !favoriteDog || !favoriteColor) {
        throw new Error("Set SUPERADMIN_BIRTHDAY, SUPERADMIN_DOG and SUPERADMIN_COLOR.");
    }
    const supabase = getAdminClient();
    const { data: existing, error: existingError } = await supabase
        .from("coffee_users")
        .select("id, role")
        .eq("username_key", SUPERADMIN_USERNAME_KEY)
        .maybeSingle();
    if (existingError) throw existingError;
    if (existing && existing.role !== "superadmin") {
        throw new Error(`The username ${SUPERADMIN_USERNAME_KEY} belongs to a ${existing.role} account.`);
    }

    let accountId = existing?.id;
    if (!accountId) {
        const { data, error } = await supabase.rpc("create_coffee_account", {
            p_username: SUPERADMIN_USERNAME_KEY,
            p_password_hash: await hashPassword(password),
            p_recovery_code_hashes: Array.from({ length: 10 }, () => hashRecoveryCode(createRecoveryCode()))
        });
        if (error) throw error;
        accountId = data;
    }

    const { error: roleError } = await supabase
        .from("coffee_users")
        .update({
            username: "Super_Admin",
            role: "superadmin",
            password_hash: await hashPassword(password),
            updated_at: new Date().toISOString()
        })
        .eq("id", accountId);
    if (roleError) throw roleError;
    // No recovery codes: the superadmin can't be reset through the customer flow.
    const { error: codesError } = await supabase.from("coffee_recovery_codes").delete().eq("user_id", accountId);
    if (codesError) throw codesError;

    const { error: securityError } = await supabase.from("superadmin_security").upsert({
        account_id: accountId,
        ...(await hashAnswers({ birthday, favoriteDog, favoriteColor })),
        failed_attempts: 0,
        locked: false
    });
    if (securityError) throw securityError;
    return { created: !existing };
}

if (require.main === module) {
    createSuperadmin({
        password: process.env.SUPERADMIN_PASSWORD,
        birthday: process.env.SUPERADMIN_BIRTHDAY,
        favoriteDog: process.env.SUPERADMIN_DOG,
        favoriteColor: process.env.SUPERADMIN_COLOR
    })
        .then(({ created }) => console.log(created ? "Superadmin created." : "Superadmin reset (unlocked)."))
        .catch((error) => {
            console.error("Creating the superadmin failed:", error.message);
            process.exitCode = 1;
        });
}

module.exports = { createSuperadmin };
