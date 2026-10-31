const { getAdminClient } = require("../config/supabase");
const { getAdminMetrics } = require("../services/adminMetricsService");

async function getMetrics(request, response, next) {
    try {
        // validateRequest has already checked days is 7, 30 or 90.
        const days = Number(request.query.days) || 30;
        response.json(await getAdminMetrics(getAdminClient(), { days }));
    } catch (error) {
        next(error);
    }
}

module.exports = { getMetrics };
