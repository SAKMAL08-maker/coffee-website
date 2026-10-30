const { rateLimit } = require("express-rate-limit");

function createLimiter(windowMs, limit) {
    return rateLimit({
        windowMs,
        limit,
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
    authLimiter: createLimiter(15 * 60 * 1000, 8),
    adminMfaLimiter: createLimiter(15 * 60 * 1000, 6),
    adminMfaEnrollLimiter: createLimiter(15 * 60 * 1000, 3),
    checkoutLimiter: createLimiter(15 * 60 * 1000, 10),
    savedWriteLimiter: createLimiter(60 * 60 * 1000, 20),
    quoteLimiter: createLimiter(60 * 1000, 60),
    trackingLimiter: createLimiter(60 * 1000, 30),
    receiptLimiter: createLimiter(60 * 1000, 10),
    deliveryReportLimiter: createLimiter(60 * 60 * 1000, 5),
    adminOrderLimiter: createLimiter(60 * 1000, 30),
    healthLimiter: createLimiter(60 * 1000, 30),
    // The browser re-quotes (debounced) as ingredients change, so this is looser than checkout.
    orderQuoteLimiter: createLimiter(60 * 1000, 120),
    // Staff advance a handful of orders per minute; this only stops scripted abuse.
    orderStatusLimiter: createLimiter(60 * 1000, 30)
};
