const test = require("node:test");
const assert = require("node:assert/strict");
const support = require("../services/supportService");

const CUSTOMER = { id: "11111111-1111-4111-8111-111111111111", role: "customer" };
const STRANGER = { id: "22222222-2222-4222-8222-222222222222", role: "customer" };
const ADMIN = { id: "33333333-3333-4333-8333-333333333333", role: "admin" };
const TICKET_ID = "44444444-4444-4444-8444-444444444444";

function ticketRow(overrides = {}) {
    return {
        id: TICKET_ID,
        customer_id: CUSTOMER.id,
        order_id: null,
        subject: "Missing straw",
        status: "open",
        assigned_to: null,
        last_message_at: "2026-10-31T05:00:00Z",
        last_message_by_staff: false,
        customer_read_at: "2026-10-31T05:00:00Z",
        staff_read_at: null,
        created_at: "2026-10-31T05:00:00Z",
        closed_at: null,
        customer: { id: CUSTOMER.id, username: "juan_dc", role: "customer" },
        assignee: null,
        ...overrides
    };
}

/**
 * Stand-in for the Supabase client. Every query resolves through `answer(op)`, where op records the
 * table, action (select/insert/update/delete), filters and values; all ops are kept in `ops`.
 */
function fakeSupabase(answer) {
    const ops = [];
    const from = (table) => {
        const op = { table, action: "select", filters: [], values: null, head: false };
        const run = () => {
            ops.push(op);
            return Promise.resolve(answer(op) || { data: null, error: null });
        };
        const builder = {
            select: (columns, options) => {
                if (op.action === "select") op.columns = columns;
                op.head = Boolean(options?.head);
                return builder;
            },
            insert: (values) => Object.assign(op, { action: "insert", values }) && builder,
            update: (values) => Object.assign(op, { action: "update", values }) && builder,
            delete: () => Object.assign(op, { action: "delete" }) && builder,
            eq: (column, value) => op.filters.push(["eq", column, value]) && builder,
            gt: (column, value) => op.filters.push(["gt", column, value]) && builder,
            order: () => builder,
            limit: () => builder,
            single: run,
            maybeSingle: run,
            then: (resolve, reject) => run().then(resolve, reject)
        };
        return builder;
    };
    return { from, ops };
}

test("message and subject text is cleaned and length-checked", () => {
    assert.equal(support.cleanText("  hi\u0000 there\n\n\n\nok ", { max: 50, label: "message" }), "hi there\n\nok");
    assert.throws(() => support.cleanText("   ", { max: 50, label: "message" }), /Write a message first/);
    assert.throws(() => support.cleanText("x".repeat(2001), { max: 2000, label: "message" }), { statusCode: 400 });
});

test("a ticket is visible only to its customer and to staff; others get 404", async () => {
    const supabase = fakeSupabase((op) =>
        op.table === "support_tickets" && op.action === "select"
            ? { data: ticketRow(), error: null }
            : { data: [], error: null }
    );
    await assert.rejects(support.listMessages(supabase, TICKET_ID, STRANGER, false), { statusCode: 404 });
    const asCustomer = await support.listMessages(supabase, TICKET_ID, CUSTOMER, false);
    assert.equal(asCustomer.viewer, "customer");
    const asStaff = await support.listMessages(supabase, TICKET_ID, ADMIN, true);
    assert.equal(asStaff.viewer, "staff");
    assert.equal(asStaff.ticket.customer.username, "juan_dc");
    // Reading marks the ticket read for the side that read it.
    const reads = supabase.ops.filter((op) => op.action === "update").map((op) => Object.keys(op.values)[0]);
    assert.deepEqual(reads, ["customer_read_at", "staff_read_at"]);
});

test("customers can't open a ticket about someone else's order or exceed 5 open tickets", async () => {
    const notTheirs = fakeSupabase((op) => {
        if (op.table === "support_tickets" && op.head) return { count: 0, error: null };
        if (op.table === "orders") return { data: null, error: null };
        return { data: null, error: null };
    });
    await assert.rejects(
        support.createTicket(notTheirs, CUSTOMER.id, {
            subject: "Wrong drink",
            message: "Hi",
            orderId: "55555555-5555-4555-8555-555555555555"
        }),
        /isn't one of yours/
    );
    const order = notTheirs.ops.find((op) => op.table === "orders");
    assert.deepEqual(order.filters, [
        ["eq", "id", "55555555-5555-4555-8555-555555555555"],
        ["eq", "account_id", CUSTOMER.id]
    ]);

    const tooMany = fakeSupabase((op) => (op.head ? { count: 5, error: null } : { data: null, error: null }));
    await assert.rejects(support.createTicket(tooMany, CUSTOMER.id, { subject: "Hello", message: "Hi" }), {
        statusCode: 409
    });
});

test("a new ticket stores the first message, and is removed again if that fails", async () => {
    const ok = fakeSupabase((op) => {
        if (op.head) return { count: 0, error: null };
        if (op.table === "support_tickets" && op.action === "insert") return { data: { id: TICKET_ID }, error: null };
        return { data: null, error: null };
    });
    assert.deepEqual(
        await support.createTicket(ok, CUSTOMER.id, { subject: " Late order ", message: "Where is it?" }),
        {
            id: TICKET_ID
        }
    );
    const message = ok.ops.find((op) => op.table === "support_messages");
    assert.deepEqual(message.values, {
        ticket_id: TICKET_ID,
        author_id: CUSTOMER.id,
        from_staff: false,
        body: "Where is it?"
    });
    assert.equal(
        ok.ops.find((op) => op.table === "support_tickets" && op.action === "insert").values.subject,
        "Late order"
    );

    const failing = fakeSupabase((op) => {
        if (op.head) return { count: 0, error: null };
        if (op.table === "support_tickets" && op.action === "insert") return { data: { id: TICKET_ID }, error: null };
        if (op.table === "support_messages") return { data: null, error: { message: "insert failed" } };
        return { data: null, error: null };
    });
    await assert.rejects(support.createTicket(failing, CUSTOMER.id, { subject: "Late order", message: "Hi" }));
    assert.ok(failing.ops.some((op) => op.table === "support_tickets" && op.action === "delete"));
});

test("the first admin to reply takes the ticket; closed tickets take no replies", async () => {
    const reply = {
        id: 7,
        body: "On its way!",
        from_staff: true,
        created_at: "2026-10-31T05:10:00Z",
        author_id: ADMIN.id,
        author: { id: ADMIN.id, username: "mika", role: "admin" }
    };
    const supabase = fakeSupabase((op) => {
        if (op.table === "support_tickets" && op.action === "select") return { data: ticketRow(), error: null };
        if (op.table === "support_messages") return { data: reply, error: null };
        return { data: null, error: null };
    });
    const message = await support.postMessage(supabase, TICKET_ID, ADMIN, true, "On its way!");
    assert.equal(message.mine, true);
    assert.equal(supabase.ops.find((op) => op.table === "support_messages").values.from_staff, true);
    const update = supabase.ops.find((op) => op.table === "support_tickets" && op.action === "update").values;
    assert.equal(update.assigned_to, ADMIN.id);
    assert.equal(update.last_message_by_staff, true);

    const closed = fakeSupabase((op) =>
        op.action === "select" ? { data: ticketRow({ status: "closed" }), error: null } : { data: null, error: null }
    );
    await assert.rejects(support.postMessage(closed, TICKET_ID, CUSTOMER, false, "Hello?"), /Open a new one/);
    await assert.rejects(support.postMessage(closed, TICKET_ID, ADMIN, true, "Hello?"), /Reopen it/);
});

test("customers may close their ticket but only staff can reopen", async () => {
    const supabase = fakeSupabase((op) =>
        op.action === "select"
            ? { data: ticketRow({ status: "closed" }), error: null }
            : { data: { status: "open", closed_at: null }, error: null }
    );
    await assert.rejects(support.setTicketStatus(supabase, TICKET_ID, CUSTOMER, false, "open"), { statusCode: 403 });
    const reopened = await support.setTicketStatus(supabase, TICKET_ID, ADMIN, true, "open");
    assert.equal(reopened.status, "open");
});

test("unread flags: a staff reply is new to the customer; a customer message needs a staff reply", async () => {
    const supabase = fakeSupabase(() => ({
        data: [
            ticketRow({ last_message_by_staff: true, last_message_at: "2026-10-31T06:00:00Z" }),
            ticketRow({ id: "x", last_message_by_staff: false })
        ],
        error: null
    }));
    const { tickets, unread } = await support.listCustomerTickets(supabase, CUSTOMER.id);
    assert.equal(unread, 1);
    assert.equal(tickets[0].unread, true);
    assert.equal(tickets[1].needsReply, true);
    const filter = supabase.ops[0].filters[0];
    assert.deepEqual(filter, ["eq", "customer_id", CUSTOMER.id]);
});
