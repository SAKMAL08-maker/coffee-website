function createCashCollectionUpdate(order, actorId, collectedAt = new Date().toISOString()) {
    if (!order) {
        throw Object.assign(new Error("Order not found."), { statusCode: 404 });
    }
    if (order.payment_method !== "cash") {
        throw Object.assign(new Error("Only cash orders can be marked collected."), { statusCode: 409 });
    }
    if (order.cash_collected_at || order.cash_collected_by) {
        throw Object.assign(new Error("Cash has already been marked as collected."), { statusCode: 409 });
    }
    if (typeof actorId !== "string" || !actorId) {
        throw Object.assign(new Error("An authenticated administrator is required."), { statusCode: 403 });
    }
    return {
        cash_collected_at: collectedAt,
        cash_collected_by: actorId,
        updated_at: collectedAt
    };
}

module.exports = { createCashCollectionUpdate };
