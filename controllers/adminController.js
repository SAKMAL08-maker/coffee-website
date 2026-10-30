const { getAdminClient } = require("../config/supabase");
const { getAdminMetrics } = require("../services/adminMetricsService");
const { ordersToCsv, fetchOrdersForExport } = require("../services/orderCsvExport");

async function getMetrics(request, response, next) {
    try {
        // validateRequest has already checked days is 7, 30 or 90.
        const days = Number(request.query.days) || 30;
        response.json(await getAdminMetrics(getAdminClient(), { days }));
    } catch (error) {
        next(error);
    }
}

async function exportOrdersCsv(request, response, next) {
    try {
        const days = Number(request.query.days) || 30;
        const orders = await fetchOrdersForExport(getAdminClient(), { days });
        const date = new Date().toISOString().slice(0, 10);
        response.set("Cache-Control", "no-store");
        response.attachment(`coffee-lab-orders-last-${days}-days-${date}.csv`);
        response.type("text/csv; charset=utf-8").send(ordersToCsv(orders));
    } catch (error) {
        next(error);
    }
}

module.exports = { getMetrics, exportOrdersCsv };
