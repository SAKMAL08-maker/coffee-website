const { getAdminClient } = require("../config/supabase");

// Long enough to survive a slow Supabase response, short enough that a stuck
// database never leaves the health endpoint (or its pinger) hanging.
const DATABASE_CHECK_TIMEOUT_MS = 5000;

/**
 * Runs the cheapest real query available: read one id from a small table.
 *
 * Why a real query instead of just returning 200: Supabase's free plan pauses
 * projects that see no database activity for about a week. An external pinger
 * hitting /healthz therefore keeps Render awake AND gives Supabase genuine
 * query activity, and the endpoint honestly reports when the database is down.
 *
 * `getClient` is injectable so tests can supply a fake Supabase client.
 */
async function checkDatabaseHealth(getClient = getAdminClient) {
    try {
        const { error } = await getClient()
            .from("coffee_users")
            .select("id")
            .limit(1)
            .abortSignal(AbortSignal.timeout(DATABASE_CHECK_TIMEOUT_MS));
        if (error) throw error;
        return { healthy: true };
    } catch (error) {
        // Log details for the operator; the HTTP response stays generic.
        console.error("Health check failed:", { errorName: error.name, errorMessage: error.message });
        return { healthy: false };
    }
}

module.exports = { checkDatabaseHealth, DATABASE_CHECK_TIMEOUT_MS };
