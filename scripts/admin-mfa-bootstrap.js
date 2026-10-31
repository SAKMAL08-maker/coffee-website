require("dotenv").config();

const { getAdminClient } = require("../config/supabase");
const { provisionAdminSetup } = require("../services/adminApprovalService");

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

    return provisionAdminSetup(supabase, account);
}

async function main() {
    const username = process.argv[2];
    if (!username || !process.argv.includes("--confirm-reset")) {
        throw new Error("Usage: node scripts\\admin-mfa-bootstrap.js <admin-username> --confirm-reset");
    }
    const result = await bootstrapAdminMfa(username);
    console.log(`Authenticator factors removed: ${result.removedFactors}`);
    console.log(`Setup approved for ${result.username} until ${result.expiresAt}.`);
    console.log("At their next sign-in they scan a QR code with their authenticator app; there is no key to type.");
}

if (require.main === module) {
    main().catch((error) => {
        console.error("Administrator MFA bootstrap failed:", error.message);
        process.exitCode = 1;
    });
}

module.exports = { bootstrapAdminMfa };
