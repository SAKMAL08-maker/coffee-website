const { getAdminClient } = require("../config/supabase");
const { getAdminMetrics } = require("../services/adminMetricsService");
const { listAdminAccounts, approveAdminSetup } = require("../services/adminApprovalService");

async function getMetrics(request, response, next) {
    try {
        // validateRequest has already checked days is 7, 30 or 90.
        const days = Number(request.query.days) || 30;
        response.json(await getAdminMetrics(getAdminClient(), { days }));
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

module.exports = { getMetrics, listAccounts, approveSetup };
