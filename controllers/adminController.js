const { getAdminClient } = require("../config/supabase");
const { getAdminMetrics } = require("../services/adminMetricsService");
const { createTtlCache } = require("../services/ttlCache");

// Dashboard numbers may be up to 30 seconds old; the page shows when they were
// computed. Several admins (or quick Refresh clicks) then cost one database read.
const metricsCache = createTtlCache(30 * 1000);

async function getMetrics(request, response, next) {
    try {
        // validateRequest has already checked days is 7, 30 or 90.
        const days = Number(request.query.days) || 30;
        response.json(await metricsCache.get(days, () => getAdminMetrics(getAdminClient(), { days })));
    } catch (error) {
        next(error);
    }
}

module.exports = { getMetrics, metricsCache };
