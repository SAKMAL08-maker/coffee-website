const { getAdminClient } = require("../config/supabase");
const supportService = require("../services/supportService");
const { hasAdminAccess } = require("../middleware/authenticate");

// Wraps a handler so each one reads as a single call.
const handle = (work) => async (request, response, next) => {
    try {
        await work(request, response);
    } catch (error) {
        next(error);
    }
};

module.exports = {
    listMine: handle(async (request, response) => {
        response.json(await supportService.listCustomerTickets(getAdminClient(), request.user.id));
    }),
    listForStaff: handle(async (request, response) => {
        response.json(await supportService.listStaffTickets(getAdminClient(), { status: request.query.status }));
    }),
    create: handle(async (request, response) => {
        const ticket = await supportService.createTicket(getAdminClient(), request.user.id, request.body);
        response.status(201).json({ ticket });
    }),
    messages: handle(async (request, response) => {
        response.json(
            await supportService.listMessages(
                getAdminClient(),
                request.params.ticketId,
                request.user,
                hasAdminAccess(request),
                { after: Number(request.query.after) || 0 }
            )
        );
    }),
    reply: handle(async (request, response) => {
        const message = await supportService.postMessage(
            getAdminClient(),
            request.params.ticketId,
            request.user,
            hasAdminAccess(request),
            request.body.body
        );
        response.status(201).json({ message });
    }),
    setStatus: handle(async (request, response) => {
        const ticket = await supportService.setTicketStatus(
            getAdminClient(),
            request.params.ticketId,
            request.user,
            hasAdminAccess(request),
            request.body.status
        );
        response.json({ ticket });
    })
};
