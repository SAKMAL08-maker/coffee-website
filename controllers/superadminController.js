const { getAdminClient } = require("../config/supabase");
const { listAccounts, demoteAdmin, deleteAccount } = require("../services/superadminService");
const { approveAdminRequest } = require("../services/adminSignupService");

async function getAccounts(request, response, next) {
    try {
        response.json({ accounts: await listAccounts(getAdminClient()), you: request.user.username });
    } catch (error) {
        next(error);
    }
}

async function demote(request, response, next) {
    try {
        const result = await demoteAdmin(getAdminClient(), { actor: request.user, username: request.params.username });
        console.info(`Superadmin ${request.user.username} demoted ${result.username} to customer.`);
        response.json(result);
    } catch (error) {
        next(error);
    }
}

async function remove(request, response, next) {
    try {
        const result = await deleteAccount(getAdminClient(), {
            actor: request.user,
            username: request.params.username
        });
        console.info(`Superadmin ${request.user.username} deleted account ${result.username}.`);
        response.json(result);
    } catch (error) {
        next(error);
    }
}

async function approveAdmin(request, response, next) {
    try {
        const result = await approveAdminRequest(getAdminClient(), { username: request.params.username });
        console.info(`Superadmin ${request.user.username} approved the admin request from ${result.username}.`);
        response.json(result);
    } catch (error) {
        next(error);
    }
}

module.exports = { getAccounts, demote, remove, approveAdmin };
