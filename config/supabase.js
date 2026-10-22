const { createClient } = require("@supabase/supabase-js");

let authClient;
let adminClient;

function readSupabaseConfig() {
    const url = process.env.SUPABASE_URL;
    const anonKey = process.env.SUPABASE_ANON_KEY;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !anonKey || !serviceRoleKey) {
        throw new Error("Set SUPABASE_URL, SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY in .env.");
    }
    return { url, anonKey, serviceRoleKey };
}

function getAuthClient() {
    if (!authClient) {
        const { url, anonKey } = readSupabaseConfig();
        authClient = createClient(url, anonKey, {
            auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }
        });
    }
    return authClient;
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

module.exports = { getAuthClient, getAdminClient, assertSupabaseConfig };
