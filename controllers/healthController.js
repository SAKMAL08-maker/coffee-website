const { checkDatabaseHealth } = require("../services/healthService");

// 200 when the database answered, 503 when it did not. Uptime pingers treat
// any non-2xx as "down", so the status code alone is the signal; the body is
// deliberately minimal so it reveals nothing about the infrastructure.
async function getHealth(request, response, next) {
    try {
        const { healthy } = await checkDatabaseHealth();
        response.set("Cache-Control", "no-store");
        response.status(healthy ? 200 : 503).json({ status: healthy ? "ok" : "unavailable" });
    } catch (error) {
        next(error);
    }
}

module.exports = { getHealth };
