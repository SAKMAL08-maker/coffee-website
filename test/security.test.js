const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { createLimiter } = require("../middleware/rateLimiters");

test("rate limiter returns a generic JSON response when the limit is exceeded", async () => {
    const app = express();
    app.get("/limited", createLimiter(60_000, 1), (request, response) => response.json({ ok: true }));
    const server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    try {
        const firstResponse = await fetch(`${baseUrl}/limited`);
        assert.equal(firstResponse.status, 200);

        const limitedResponse = await fetch(`${baseUrl}/limited`);
        assert.equal(limitedResponse.status, 429);
        assert.deepEqual(await limitedResponse.json(), {
            error: "Too many requests. Please try again later."
        });
        assert.match(limitedResponse.headers.get("ratelimit"), /limit=1/i);
    } finally {
        await new Promise((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()));
        });
    }
});
