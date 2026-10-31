const { rateLimit } = require("express-rate-limit");
const { getAdminClient } = require("../config/supabase");
const { PostgresRateLimitStore } = require("./postgresRateLimitStore");

// Scalability option C: RATE_LIMIT_STORE=postgres shares counters between server
// instances (needs the shared_rate_limits migration). Unset keeps the in-memory
// store, which is right for a single instance.
function createStore(name, env = process.env) {
    if (env.RATE_LIMIT_STORE !== "postgres" || !name) return undefined;
    return new PostgresRateLimitStore(name, getAdminClient);
}

function createLimiter(windowMs, limit, name) {
    const store = createStore(name);
    return rateLimit({
        windowMs,
        limit,
        ...(store
            ? {
                  store,
                  // If the database is unreachable, let requests through (and log)
                  // rather than taking the whole site down with it.
                  passOnStoreError: true
              }
            : {}),
        standardHeaders: "draft-7",
        legacyHeaders: false,
        message: { error: "Too many requests. Please try again later." },
        handler(request, response) {
            response.status(429).json({ error: "Too many requests. Please try again later." });
        }
    });
}

module.exports = {
    createLimiter,
    createStore,
    authLimiter: createLimiter(15 * 60 * 1000, 8, "authLimiter"),
    adminMfaLimiter: createLimiter(15 * 60 * 1000, 6, "adminMfaLimiter"),
    adminMfaEnrollLimiter: createLimiter(15 * 60 * 1000, 3, "adminMfaEnrollLimiter"),
    checkoutLimiter: createLimiter(15 * 60 * 1000, 10, "checkoutLimiter"),
    savedWriteLimiter: createLimiter(60 * 60 * 1000, 20, "savedWriteLimiter"),
    quoteLimiter: createLimiter(60 * 1000, 60, "quoteLimiter"),
    trackingLimiter: createLimiter(60 * 1000, 30, "trackingLimiter"),
    receiptLimiter: createLimiter(60 * 1000, 10, "receiptLimiter"),
    deliveryReportLimiter: createLimiter(60 * 60 * 1000, 5, "deliveryReportLimiter"),
    adminOrderLimiter: createLimiter(60 * 1000, 30, "adminOrderLimiter"),
    // The order list is polled every 15 s per open admin tab; keep it from eating the action budget.
    adminOrderListLimiter: createLimiter(60 * 1000, 60, "adminOrderListLimiter"),
    adminApprovalLimiter: createLimiter(15 * 60 * 1000, 10, "adminApprovalLimiter"),
    // Superadmin sign-in also locks after 3 wrong answers; this slows guessing per IP.
    superadminLoginLimiter: createLimiter(15 * 60 * 1000, 5, "superadminLoginLimiter"),
    superadminActionLimiter: createLimiter(60 * 1000, 30, "superadminActionLimiter"),
    healthLimiter: createLimiter(60 * 1000, 30, "healthLimiter"),
    // The browser re-quotes (debounced) as ingredients change, so this is looser than checkout.
    orderQuoteLimiter: createLimiter(60 * 1000, 120, "orderQuoteLimiter"),
    // Staff advance a handful of orders per minute; this only stops scripted abuse.
    orderStatusLimiter: createLimiter(60 * 1000, 30, "orderStatusLimiter"),
    // Recording a payment is a sensitive admin write; a busy shift needs well under this.
    cashCollectionLimiter: createLimiter(60 * 1000, 20, "cashCollectionLimiter"),
    // Public recipe pages and QR codes: generous for real visitors, blocks slug scraping.
    recipeReadLimiter: createLimiter(60 * 1000, 60, "recipeReadLimiter"),
    // Re-checked (debounced) as the customer edits a drink, like price quotes.
    caffeineCheckLimiter: createLimiter(60 * 1000, 120, "caffeineCheckLimiter")
};
