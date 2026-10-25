const { createClient } = require("@supabase/supabase-js");

let adminClient;

function readSupabaseConfig() {
    const url = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceRoleKey) {
        throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.");
    }
    return { url, serviceRoleKey };
}

function getAdminClient() {
    if (!adminClient) {
        const { url, serviceRoleKey } = readSupabaseConfig();
        adminClient = createClient(url, serviceRoleKey, {
            auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }
        });
    }
    return adminClient;
}

function assertSupabaseConfig() {
    readSupabaseConfig();
}

module.exports = { getAdminClient, assertSupabaseConfig };
