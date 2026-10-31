/**
 * Records who moved an order (table order_events, migration 20261109000000). Feeds each
 * admin's profile statistics and works as an audit trail.
 *
 * Best effort: the order change has already succeeded when this runs, so a failed insert
 * (or a database without the migration yet) is logged and never fails the request.
 */
const ORDER_EVENT = Object.freeze({
    ACCEPTED: "accepted",
    SENT_OUT: "sent_out",
    ARRIVED: "arrived",
    CLOSED: "closed",
    CANCELLED: "cancelled",
    CASH_COLLECTED: "cash_collected"
});

// The event a staff status change represents (PATCH /api/orders/:id/status).
const EVENT_FOR_STATUS = Object.freeze({
    Crafting: ORDER_EVENT.ACCEPTED,
    "Out for Delivery": ORDER_EVENT.SENT_OUT,
    Arrived: ORDER_EVENT.ARRIVED
});

async function recordOrderEvent(supabase, { orderId, actorId, action }) {
    if (!action) return;
    try {
        const { error } = await supabase.from("order_events").insert({ order_id: orderId, actor_id: actorId, action });
        if (error) throw error;
    } catch (error) {
        console.warn("Could not record the order event:", { orderId, action, error: error.message });
    }
}

module.exports = { ORDER_EVENT, EVENT_FOR_STATUS, recordOrderEvent };
