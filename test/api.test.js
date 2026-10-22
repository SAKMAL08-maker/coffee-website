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
        assert.match(await home.text(), /Bean &amp; Bloom/);

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
