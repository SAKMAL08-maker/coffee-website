/**
 * Support tickets (migration 20261110000000): customers open tickets and chat with the shop;
 * admins and the superadmin answer from the Support tab.
 *
 * Access rule, enforced here for every ticket: the customer who opened it, or staff (an
 * MFA-verified admin or the superadmin). Anyone else gets 404, so ticket ids don't leak.
 * Messages are plain text; the browser renders them with textContent.
 */
const { displayOrderCode } = require("./orderCode");
const { avatarUrl } = require("./profileService");

const MAX_OPEN_TICKETS = 5;
const SUBJECT_MAX = 120;
const MESSAGE_MAX = 2000;
const LIST_LIMIT = 50;
const MESSAGE_PAGE = 200;

const TICKET_COLUMNS =
    "id, customer_id, order_id, subject, status, assigned_to, last_message_at, last_message_by_staff, customer_read_at, staff_read_at, created_at, closed_at";
const PERSON_COLUMNS = "id, username, role, avatar_object_key, avatar_updated_at";

function httpError(statusCode, message) {
    return Object.assign(new Error(message), { statusCode });
}

/** Trims, drops control characters (newlines kept), caps blank lines, and checks the length. */
function cleanText(value, { min = 1, max, label }) {
    const text = String(value ?? "")
        .replace(/\r\n?/g, "\n")
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    if (text.length < min) throw httpError(400, `Write a ${label} first.`);
    if (text.length > max) throw httpError(400, `Keep the ${label} to ${max} characters.`);
    return text;
}

function toPerson(row) {
    if (!row) return null;
    return { id: row.id, username: row.username, role: row.role, avatarUrl: avatarUrl(row) };
}

function isAfter(later, earlier) {
    return Boolean(later) && (!earlier || Date.parse(later) > Date.parse(earlier));
}

function toTicket(row, viewer) {
    const isStaffView = viewer === "staff";
    return {
        id: row.id,
        subject: row.subject,
        status: row.status,
        orderCode: row.order?.tracking_code ? displayOrderCode({ tracking_code: row.order.tracking_code }) : null,
        createdAt: row.created_at,
        lastMessageAt: row.last_message_at,
        closedAt: row.closed_at,
        // Customer: the shop answered and they haven't looked yet. Staff: open and waiting on the shop.
        unread: isStaffView
            ? row.status === "open" && !row.last_message_by_staff && isAfter(row.last_message_at, row.staff_read_at)
            : row.last_message_by_staff && isAfter(row.last_message_at, row.customer_read_at),
        needsReply: row.status === "open" && !row.last_message_by_staff,
        ...(isStaffView ? { customer: toPerson(row.customer), assignedTo: toPerson(row.assignee) } : {})
    };
}

function toMessage(row, userId) {
    return {
        id: Number(row.id),
        body: row.body,
        fromStaff: row.from_staff,
        createdAt: row.created_at,
        mine: row.author_id === userId,
        author: toPerson(row.author)
    };
}

async function listCustomerTickets(supabase, customerId) {
    const { data, error } = await supabase
        .from("support_tickets")
        .select(`${TICKET_COLUMNS}, order:orders(tracking_code)`)
        .eq("customer_id", customerId)
        .order("last_message_at", { ascending: false })
        .limit(LIST_LIMIT);
    if (error) throw error;
    const tickets = data.map((row) => toTicket(row, "customer"));
    return { tickets, unread: tickets.filter((ticket) => ticket.unread).length };
}

async function listStaffTickets(supabase, { status = "open" } = {}) {
    let query = supabase
        .from("support_tickets")
        .select(
            `${TICKET_COLUMNS}, order:orders(tracking_code), customer:coffee_users!support_tickets_customer_id_fkey(${PERSON_COLUMNS}), assignee:coffee_users!support_tickets_assigned_to_fkey(${PERSON_COLUMNS})`
        )
        .order("last_message_at", { ascending: false })
        .limit(LIST_LIMIT);
    if (status !== "all") query = query.eq("status", status);
    const [list, waiting] = await Promise.all([
        query,
        supabase
            .from("support_tickets")
            .select("id", { count: "exact", head: true })
            .eq("status", "open")
            .eq("last_message_by_staff", false)
    ]);
    if (list.error) throw list.error;
    if (waiting.error) throw waiting.error;
    return { tickets: list.data.map((row) => toTicket(row, "staff")), needsReply: waiting.count || 0 };
}

async function createTicket(supabase, customerId, { subject, message, orderId }) {
    const cleanSubject = cleanText(subject, { min: 3, max: SUBJECT_MAX, label: "subject" });
    const cleanMessage = cleanText(message, { max: MESSAGE_MAX, label: "message" });

    const { count, error: countError } = await supabase
        .from("support_tickets")
        .select("id", { count: "exact", head: true })
        .eq("customer_id", customerId)
        .eq("status", "open");
    if (countError) throw countError;
    if ((count || 0) >= MAX_OPEN_TICKETS) {
        throw httpError(409, `You have ${MAX_OPEN_TICKETS} open tickets. Close one you no longer need first.`);
    }
    if (orderId) {
        const { data: order, error } = await supabase
            .from("orders")
            .select("id")
            .eq("id", orderId)
            .eq("account_id", customerId)
            .maybeSingle();
        if (error) throw error;
        if (!order) throw httpError(400, "That order isn't one of yours.");
    }

    const now = new Date().toISOString();
    const { data: ticket, error: ticketError } = await supabase
        .from("support_tickets")
        .insert({
            customer_id: customerId,
            order_id: orderId || null,
            subject: cleanSubject,
            last_message_at: now,
            last_message_by_staff: false,
            customer_read_at: now
        })
        .select("id")
        .single();
    if (ticketError) throw ticketError;
    const { error: messageError } = await supabase
        .from("support_messages")
        .insert({ ticket_id: ticket.id, author_id: customerId, from_staff: false, body: cleanMessage });
    if (messageError) {
        // Don't leave an empty ticket behind.
        await supabase.from("support_tickets").delete().eq("id", ticket.id);
        throw messageError;
    }
    return { id: ticket.id };
}

/** The ticket and how this user relates to it, or 404 when they may not see it. */
async function findTicket(supabase, ticketId, user, isStaff) {
    const { data: row, error } = await supabase
        .from("support_tickets")
        .select(
            `${TICKET_COLUMNS}, order:orders(tracking_code), customer:coffee_users!support_tickets_customer_id_fkey(${PERSON_COLUMNS}), assignee:coffee_users!support_tickets_assigned_to_fkey(${PERSON_COLUMNS})`
        )
        .eq("id", ticketId)
        .maybeSingle();
    if (error) throw error;
    if (!row) throw httpError(404, "That ticket was not found.");
    if (row.customer_id === user.id) return { row, viewer: "customer" };
    if (isStaff) return { row, viewer: "staff" };
    throw httpError(404, "That ticket was not found.");
}

async function listMessages(supabase, ticketId, user, isStaff, { after = 0 } = {}) {
    const { row, viewer } = await findTicket(supabase, ticketId, user, isStaff);
    const { data, error } = await supabase
        .from("support_messages")
        .select(`id, body, from_staff, created_at, author_id, author:coffee_users(${PERSON_COLUMNS})`)
        .eq("ticket_id", row.id)
        .gt("id", after)
        .order("id", { ascending: true })
        .limit(MESSAGE_PAGE);
    if (error) throw error;
    const readColumn = viewer === "staff" ? "staff_read_at" : "customer_read_at";
    if (data.length || after === 0) {
        const { error: readError } = await supabase
            .from("support_tickets")
            .update({ [readColumn]: new Date().toISOString() })
            .eq("id", row.id);
        if (readError) throw readError;
    }
    return {
        ticket: toTicket({ ...row, [readColumn]: new Date().toISOString() }, viewer),
        viewer,
        messages: data.map((message) => toMessage(message, user.id))
    };
}

async function postMessage(supabase, ticketId, user, isStaff, body) {
    const text = cleanText(body, { max: MESSAGE_MAX, label: "message" });
    const { row, viewer } = await findTicket(supabase, ticketId, user, isStaff);
    if (row.status === "closed") {
        throw httpError(
            409,
            viewer === "staff"
                ? "This ticket is closed. Reopen it to reply."
                : "This ticket is closed. Open a new one if you still need help."
        );
    }
    const fromStaff = viewer === "staff";
    const { data: message, error } = await supabase
        .from("support_messages")
        .insert({ ticket_id: row.id, author_id: user.id, from_staff: fromStaff, body: text })
        .select(`id, body, from_staff, created_at, author_id, author:coffee_users(${PERSON_COLUMNS})`)
        .single();
    if (error) throw error;
    const update = {
        last_message_at: message.created_at,
        last_message_by_staff: fromStaff,
        [fromStaff ? "staff_read_at" : "customer_read_at"]: message.created_at
    };
    // The first admin to answer takes the ticket.
    if (fromStaff && !row.assigned_to) update.assigned_to = user.id;
    const { error: updateError } = await supabase.from("support_tickets").update(update).eq("id", row.id);
    if (updateError) throw updateError;
    return toMessage(message, user.id);
}

async function setTicketStatus(supabase, ticketId, user, isStaff, status) {
    const { row, viewer } = await findTicket(supabase, ticketId, user, isStaff);
    if (viewer === "customer" && status !== "closed") {
        throw httpError(403, "Only the shop can reopen a ticket. Open a new one if you still need help.");
    }
    if (row.status === status) return toTicket(row, viewer);
    const { data, error } = await supabase
        .from("support_tickets")
        .update({ status, closed_at: status === "closed" ? new Date().toISOString() : null })
        .eq("id", row.id)
        .select(TICKET_COLUMNS)
        .maybeSingle();
    if (error) throw error;
    return toTicket({ ...row, ...data }, viewer);
}

module.exports = {
    MAX_OPEN_TICKETS,
    SUBJECT_MAX,
    MESSAGE_MAX,
    cleanText,
    listCustomerTickets,
    listStaffTickets,
    createTicket,
    listMessages,
    postMessage,
    setTicketStatus
};
