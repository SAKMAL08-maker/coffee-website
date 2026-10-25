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
        assert.match(html, /Coffee Lab — Customizer/);
        assert.equal(home.headers.get("x-powered-by"), null);
        assert.equal(home.headers.get("x-content-type-options"), "nosniff");
        assert.equal(home.headers.get("cache-control"), "no-store");
        const policy = home.headers.get("content-security-policy");
        assert.match(policy, /script-src 'self'/);
        assert.match(policy, /style-src 'self'/);
        assert.match(html, /href="\/css\/styles\.css"/);
        assert.match(html, /src="\/js\/(?:state|pricing|app)\.js"/);
        assert.doesNotMatch(html, /<style[\s>]/i);
        assert.doesNotMatch(html, /<script>([\s\S]*?)<\/script>/i);
        assert.doesNotMatch(html, /Share recipe|Export recipe card|Save to my bar/i);
        assert.match(html, /id="creation-view-toggle"/);
        assert.match(html, /id="summary-view"[^>]*hidden/);
        assert.match(html, /id="summary-view-toggle"/);
        assert.match(html, /id="auth-page"/);
        assert.match(html, /id="signup-form"/);
        assert.match(html, /id="login-form"/);
        assert.match(html, /id="recovery-form"/);
        assert.match(html, /id="logout-button"/);
        assert.match(html, /id="receipt-message"/);
        assert.match(html, /id="download-receipt-button"/);
        assert.match(html, /id="customizer-page" hidden/);
        assert.match(html, /src="\/js\/auth\.js"/);

        const css = await fetch(`${baseUrl}/css/styles.css`);
        assert.equal(css.status, 200);
        assert.match(css.headers.get("content-type"), /text\/css/);
        const stateModule = await fetch(`${baseUrl}/js/state.js`);
        assert.equal(stateModule.status, 200);
        const pricingModule = await fetch(`${baseUrl}/js/pricing.js`);
        assert.equal(pricingModule.status, 200);

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

        const unauthenticatedReceipt = await fetch(`${baseUrl}/api/orders/c5c0c718-6e68-4a0f-b490-eaa4897bb4b1/receipt`);
        assert.equal(unauthenticatedReceipt.status, 401);

        const unauthenticatedReceiptRetry = await fetch(
            `${baseUrl}/api/orders/c5c0c718-6e68-4a0f-b490-eaa4897bb4b1/receipt/retry`,
            {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: "{}"
            }
        );
        assert.equal(unauthenticatedReceiptRetry.status, 401);

        const invalidReceiptRetry = await fetch(
            `${baseUrl}/api/orders/c5c0c718-6e68-4a0f-b490-eaa4897bb4b1/receipt/retry`,
            {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ unexpected: true })
            }
        );
        assert.equal(invalidReceiptRetry.status, 400);

        const unauthenticatedProfile = await fetch(`${baseUrl}/api/users/me`);
        assert.equal(unauthenticatedProfile.status, 401);

        const invalidSignup = await fetch(`${baseUrl}/api/users/signup`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ username: "x", password: "short" })
        });
        assert.equal(invalidSignup.status, 400);

        const crossOriginSignup = await fetch(`${baseUrl}/api/users/signup`, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                origin: "https://attacker.invalid"
            },
            body: JSON.stringify({ username: "new_user", password: "a secure example password" })
        });
        assert.equal(crossOriginSignup.status, 403);

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
