const test = require("node:test");
const assert = require("node:assert/strict");
const { app } = require("../server");

test("serves the customizer and validates quote and checkout API requests", async () => {
    const server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    try {
        const home = await fetch(`${baseUrl}/`);
        assert.equal(home.status, 200);
        const html = await home.text();
        assert.match(html, /Bean &amp; Bloom/);
        assert.equal(home.headers.get("x-powered-by"), null);
        assert.equal(home.headers.get("x-content-type-options"), "nosniff");
        assert.equal(home.headers.get("cache-control"), "no-store");
        const policy = home.headers.get("content-security-policy");
        const nonce = policy.match(/script-src[^;]*'nonce-([^']+)'/)[1];
        assert.ok(html.includes(`<script nonce="${nonce}"`));
        assert.ok(html.includes(`<style nonce="${nonce}"`));

        const quote = await fetch(`${baseUrl}/api/coffees/quote`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ configuration: { volumeMl: 240, shots: 2 } })
        });
        const quoteBody = await quote.json();
        assert.equal(quote.status, 200);
        assert.equal(quoteBody.classification, "Latte");
        assert.equal(quoteBody.nutrition.caffeineMg, 128);

        const invalidQuote = await fetch(`${baseUrl}/api/coffees/quote`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ configuration: { base: "unknown" } })
        });
        assert.equal(invalidQuote.status, 400);

        const unknownFieldQuote = await fetch(`${baseUrl}/api/coffees/quote`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ configuration: {}, price: 1 })
        });
        assert.equal(unknownFieldQuote.status, 400);
        assert.deepEqual(await unknownFieldQuote.json(), { error: "Request data is invalid." });

        const invalidTrackingCode = await fetch(`${baseUrl}/api/orders/track/not-a-tracking-code`);
        assert.equal(invalidTrackingCode.status, 400);

        const unexpectedQuery = await fetch(`${baseUrl}/api/orders/track/${"a".repeat(48)}?debug=true`);
        assert.equal(unexpectedQuery.status, 400);

        const invalidCheckout = await fetch(`${baseUrl}/api/orders/checkout`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                items: [],
                fulfillmentMethod: "delivery",
                deliveryAddress: "1 Coffee Lane",
                customer: { name: "Test User", phone: "555-0100" }
            })
        });
        assert.equal(invalidCheckout.status, 400);
    } finally {
        await new Promise((resolve, reject) => {
            server.close((error) => error ? reject(error) : resolve());
        });
    }
});
