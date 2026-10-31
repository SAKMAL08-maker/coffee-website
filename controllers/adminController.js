const { getAdminClient } = require("../config/supabase");
const { getAdminMetrics } = require("../services/adminMetricsService");
const { createTtlCache } = require("../services/ttlCache");
const { ordersToCsv, fetchOrdersForExport } = require("../services/orderCsvExport");
const { listAdminAccounts, approveAdminSetup } = require("../services/adminApprovalService");

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

async function listAccounts(request, response, next) {
    try {
        response.json({ accounts: await listAdminAccounts(getAdminClient()), you: request.user.username });
    } catch (error) {
        next(error);
    }
}

async function approveSetup(request, response, next) {
    try {
        const result = await approveAdminSetup(getAdminClient(), {
            approver: request.user,
            username: request.params.username,
            resetExisting: request.body.resetExisting
        });
        console.info(`Admin ${request.user.username} approved authenticator setup for ${result.username}.`);
        response.json({
            username: result.username,
            expiresAt: result.expiresAt,
            removedFactors: result.removedFactors
        });
    } catch (error) {
        next(error);
    }
}

module.exports = { getMetrics, metricsCache, exportOrdersCsv, listAccounts, approveSetup };
