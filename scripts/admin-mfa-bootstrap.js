require("dotenv").config();

const { createHash, randomBytes } = require("node:crypto");
const { getAdminClient } = require("../config/supabase");

async function bootstrapAdminMfa(username) {
    const normalizedUsername = username.trim().toLowerCase();
    if (!/^[a-z0-9_]{3,24}$/.test(normalizedUsername)) {
        throw new Error("Provide a valid Coffee Lab username.");
    }

    const supabase = getAdminClient();
    const { data: account, error: accountError } = await supabase
        .from("coffee_users")
        .select("id, username, role, supabase_auth_user_id")
        .eq("username_key", normalizedUsername)
        .maybeSingle();
    if (accountError) throw accountError;
    if (!account || account.role !== "admin" || !account.supabase_auth_user_id) {
        throw new Error("That username is not a linked Coffee Lab administrator.");
    }

    const { error: lockError } = await supabase
        .from("coffee_users")
        .update({
            admin_mfa_factor_id: null,
            admin_mfa_pending_factor_id: null,
            admin_mfa_setup_token_hash: null,
            admin_mfa_setup_token_expires_at: null,
            updated_at: new Date().toISOString()
        })
        .eq("id", account.id)
        .eq("role", "admin");
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

    const setupToken = randomBytes(32).toString("base64url");
    const setupTokenHash = createHash("sha256").update(setupToken).digest("hex");
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const { data: updated, error: provisionError } = await supabase
        .from("coffee_users")
        .update({
            admin_mfa_setup_token_hash: setupTokenHash,
            admin_mfa_setup_token_expires_at: expiresAt,
            updated_at: new Date().toISOString()
        })
        .eq("id", account.id)
        .eq("role", "admin")
        .is("admin_mfa_factor_id", null)
        .is("admin_mfa_pending_factor_id", null)
        .select("id")
        .maybeSingle();
    if (provisionError) throw provisionError;
    if (!updated) throw new Error("Could not provision the one-time setup authorization.");

    return { username: account.username, setupToken, expiresAt, removedFactors: factorData.factors.length };
}

async function main() {
    const username = process.argv[2];
    if (!username || !process.argv.includes("--confirm-reset")) {
        throw new Error("Usage: node scripts\\admin-mfa-bootstrap.js <admin-username> --confirm-reset");
    }
    const result = await bootstrapAdminMfa(username);
    console.log(`Authenticator factors removed: ${result.removedFactors}`);
    console.log(`Setup authorization for ${result.username} (expires ${result.expiresAt}):`);
    console.log(result.setupToken);
    console.log("Deliver this token only to the administrator over a separate trusted channel.");
}

if (require.main === module) {
    main().catch((error) => {
        console.error("Administrator MFA bootstrap failed:", error.message);
        process.exitCode = 1;
    });
}

module.exports = { bootstrapAdminMfa };
