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
        // Option B: text responses are compressed (fetch decompresses transparently).
        assert.match(home.headers.get("content-encoding") || "", /^(gzip|br|deflate)$/);
        const policy = home.headers.get("content-security-policy");
        assert.match(policy, /script-src 'self'/);
        assert.match(policy, /style-src 'self'/);
        assert.match(policy, /img-src[^;]*backblazeb2\.com/i);
        assert.match(html, /href="\/css\/styles\.css"/);
        assert.match(html, /src="\/js\/(?:state|pricing|app)\.js"/);
        assert.doesNotMatch(html, /<style[\s>]/i);
        assert.doesNotMatch(html, /<script>([\s\S]*?)<\/script>/i);
        assert.doesNotMatch(html, /Share recipe|Export recipe card|Save to my bar/i);
        // Community recipes (Phase 5) are server-backed and named differently from the removed client-only sharing.
        assert.match(html, /id="publish-recipe-button"/);
        assert.match(html, /src="\/js\/communityRecipes\.js"/);
        // The caffeine guardian must stay visible while building a drink: it once sat inside the
        // summary card, which is hidden until the customer flips the preview, so nobody saw it.
        const summaryCard = html.slice(
            html.indexOf('id="summary-view"'),
            html.indexOf("</article>", html.indexOf('id="summary-view"'))
        );
        assert.doesNotMatch(summaryCard, /caffeine-guardian/);
        const guardianIndex = html.indexOf('id="caffeine-guardian"');
        assert.ok(
            guardianIndex > 0 && guardianIndex < html.indexOf('id="add-to-cart-button"'),
            "guardian sits above the add button"
        );
        assert.match(html, /id="creation-view-toggle"/);
        assert.match(html, /id="summary-view"[^>]*hidden/);
        assert.match(html, /id="summary-view-toggle"/);
        // Terms of Use sits beside every Privacy Policy link, and both pages name the contact email.
        assert.equal(html.match(/href="\/terms\.html"/g)?.length, html.match(/href="\/privacy\.html"/g)?.length);
        for (const page of ["/terms.html", "/privacy.html"]) {
            const legal = await fetch(`${baseUrl}${page}`);
            assert.equal(legal.status, 200);
            assert.match(await legal.text(), /mailto:coffeelab08@gmail\.com/);
        }
        // The login page starts hidden behind a loading line, so saved sessions never flash it.
        assert.match(html, /id="auth-page"[^>]*hidden/);
        assert.match(html, /id="session-loading"/);
        assert.match(html, /id="superadmin-form"/);
        assert.match(html, /id="account-dashboard"[^>]*hidden/);
        // Orders, Dashboard and Accounts are separate tabs; only Orders shows at first.
        assert.match(html, /id="admin-panel-orders"[^>]*role="tabpanel"/);
        assert.match(html, /id="admin-panel-dashboard"[^>]*hidden/);
        assert.match(html, /id="admin-panel-accounts"[^>]*hidden/);
        assert.match(html, /src="\/js\/adminTabs\.js"/);
        assert.match(html, /id="admin-tab-accounts-badge"[^>]*hidden/);
        assert.match(html, /id="admin-tab-orders-badge"[^>]*hidden/);
        assert.equal(html.match(/id="admin-access-badge"/g).length, 1, "badge ids must be unique");
        assert.match(html, /id="order-search"/);
        // The search goes into a PostgREST or() filter, so its syntax characters are refused up front.
        assert.equal((await fetch(`${baseUrl}/api/orders/admin/all?q=a,status.eq.x)`)).status, 400);
        assert.equal((await fetch(`${baseUrl}/api/orders/admin/all?view=everything`)).status, 400);
        assert.equal((await fetch(`${baseUrl}/api/orders/admin/all?view=active&q=CL-AB12`)).status, 401);
        assert.equal((await fetch(`${baseUrl}/api/superadmin/accounts`)).status, 401);
        const incompleteSuperadminLogin = await fetch(`${baseUrl}/api/users/superadmin/login`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ password: "x" })
        });
        assert.equal(incompleteSuperadminLogin.status, 400);
        assert.match(html, /id="signup-form"/);
        assert.match(html, /id="login-form"/);
        assert.match(html, /id="admin-mfa-form"/);
        assert.match(html, /id="admin-mfa-qr"/);
        assert.match(html, /id="admin-mfa-bootstrap-token"/);
        assert.match(html, /id="admin-mfa-enroll"/);
        assert.match(html, /id="recovery-form"/);
        assert.match(html, /id="logout-button"/);
        assert.match(html, /id="receipt-message"/);
        assert.match(html, /id="receipt-preview-image"/);
        assert.match(html, /id="download-receipt-button"/);
        assert.match(html, /id="admin-page"/);
        assert.match(html, /id="report-delivered-button"/);
        assert.match(html, /id="fulfillment-progress-card"/);
        assert.match(html, /class="intro" aria-labelledby="page-title"/);
        assert.doesNotMatch(html, /Your delivery partner/);
        assert.match(html, /<main id="customizer-page"[^>]*\shidden[\s>]/);
        assert.match(html, /id="customer-nav"/);
        assert.match(html, /id="order-history-nav-button"/);
        assert.match(html, /id="order-history-page"\s+data-customer-page\s+hidden/);
        assert.match(html, /id="profile-page"\s+data-customer-page\s+hidden/);
        assert.match(html, /id="order-history-list"/);
        assert.match(html, /src="\/js\/auth\.js"/);
        assert.ok(html.indexOf('src="/js/admin.js"') < html.indexOf('src="/js/auth.js"'));
        const adminFrontend = await fetch(`${baseUrl}/js/admin.js`);
        assert.equal(adminFrontend.status, 200);
        const adminScript = await adminFrontend.text();
        assert.match(adminScript, /window\.CoffeeLabAdmin = \{ startForUser \}/);
        assert.match(adminScript, /Approve delivered/);
        assert.match(adminScript, /approve-pickup/);
        assert.match(adminScript, /generate-receipt/);
        assert.match(adminScript, /View receipt/);
        // Orders move forward one step at a time through PATCH /status (Start crafting, Out for delivery...).
        assert.match(adminScript, /Start crafting/);
        assert.match(adminScript, /path: "\/status"/);
        const appFrontend = await fetch(`${baseUrl}/js/app.js`);
        assert.equal(appFrontend.status, 200);
        const appScript = await appFrontend.text();
        // Tracking shows each step, matching services/orderStatusMachine.js.
        assert.match(appScript, /Being made/);
        assert.match(appScript, /Out for Delivery/);
        assert.match(appScript, /Ready for Pickup/);
        assert.match(appScript, /\/api\/orders\/mine/);
        assert.match(appScript, /Delivered/);
        assert.match(appScript, /Ready for pickup/);

        const css = await fetch(`${baseUrl}/css/styles.css`);
        assert.equal(css.status, 200);
        assert.match(css.headers.get("content-type"), /text\/css/);
        const stateModule = await fetch(`${baseUrl}/js/state.js`);
        assert.equal(stateModule.status, 200);
        const pricingModule = await fetch(`${baseUrl}/js/pricing.js`);
        assert.equal(pricingModule.status, 200);
        const adminModule = await fetch(`${baseUrl}/js/admin.js`);
        assert.equal(adminModule.status, 200);
        assert.match(adminModule.headers.get("content-type"), /javascript/);

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

        const unauthenticatedOrderHistory = await fetch(`${baseUrl}/api/orders/mine`);
        assert.equal(unauthenticatedOrderHistory.status, 401);
        const unauthenticatedAdminMfaEnroll = await fetch(`${baseUrl}/api/users/admin/mfa/enroll`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ bootstrapToken: "a".repeat(32) })
        });
        assert.equal(unauthenticatedAdminMfaEnroll.status, 401);
        // No key is allowed (an admin approved in the admin page), but a session is still required.
        const missingAdminMfaBootstrapToken = await fetch(`${baseUrl}/api/users/admin/mfa/enroll`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "{}"
        });
        assert.equal(missingAdminMfaBootstrapToken.status, 401);
        const shortAdminMfaBootstrapToken = await fetch(`${baseUrl}/api/users/admin/mfa/enroll`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ bootstrapToken: "short" })
        });
        assert.equal(shortAdminMfaBootstrapToken.status, 400);
        assert.equal((await fetch(`${baseUrl}/api/admin/accounts`)).status, 401);
        const unauthenticatedApproval = await fetch(`${baseUrl}/api/admin/accounts/arthur_admin/approve-setup`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "{}"
        });
        assert.equal(unauthenticatedApproval.status, 401);
        const invalidApproval = await fetch(`${baseUrl}/api/admin/accounts/bad name!/approve-setup`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "{}"
        });
        assert.equal(invalidApproval.status, 400);
        const unauthenticatedAdminMfaVerify = await fetch(`${baseUrl}/api/users/admin/mfa/verify`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ factorId: "c5c0c718-6e68-4a0f-b490-eaa4897bb4b1", code: "123456" })
        });
        assert.equal(unauthenticatedAdminMfaVerify.status, 401);
        const invalidAdminMfaCode = await fetch(`${baseUrl}/api/users/admin/mfa/verify`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ factorId: "c5c0c718-6e68-4a0f-b490-eaa4897bb4b1", code: "12345x" })
        });
        assert.equal(invalidAdminMfaCode.status, 400);

        const unauthenticatedReceipt = await fetch(
            `${baseUrl}/api/orders/c5c0c718-6e68-4a0f-b490-eaa4897bb4b1/receipt`
        );
        assert.equal(unauthenticatedReceipt.status, 401);
        const unauthenticatedReceiptPreview = await fetch(
            `${baseUrl}/api/orders/c5c0c718-6e68-4a0f-b490-eaa4897bb4b1/receipt/preview`
        );
        assert.equal(unauthenticatedReceiptPreview.status, 401);

        const unauthenticatedReceiptRetry = await fetch(
            `${baseUrl}/api/orders/c5c0c718-6e68-4a0f-b490-eaa4897bb4b1/receipt/retry`,
            {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: "{}"
            }
        );
        assert.equal(unauthenticatedReceiptRetry.status, 401);

        const unauthenticatedDeliveryReport = await fetch(
            `${baseUrl}/api/orders/c5c0c718-6e68-4a0f-b490-eaa4897bb4b1/delivery-report`,
            {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: "{}"
            }
        );
        assert.equal(unauthenticatedDeliveryReport.status, 401);

        const unauthenticatedAdminOrders = await fetch(`${baseUrl}/api/orders/admin/all?page=1`);
        assert.equal(unauthenticatedAdminOrders.status, 401);
        const invalidAdminOrdersPage = await fetch(`${baseUrl}/api/orders/admin/all?page=0`);
        assert.equal(invalidAdminOrdersPage.status, 400);
        assert.equal((await fetch(`${baseUrl}/api/admin/metrics?days=30`)).status, 401);
        assert.equal((await fetch(`${baseUrl}/api/admin/metrics?days=365`)).status, 400);
        assert.equal((await fetch(`${baseUrl}/api/admin/orders.csv?days=30`)).status, 401);
        assert.equal((await fetch(`${baseUrl}/api/admin/orders.csv?days=2`)).status, 400);
        assert.match(html, /id="admin-dashboard"/);
        assert.match(html, /src="\/js\/adminDashboard\.js"/);
        const unauthenticatedAdminReceiptRetry = await fetch(
            `${baseUrl}/api/orders/c5c0c718-6e68-4a0f-b490-eaa4897bb4b1/admin/receipt/retry`,
            {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: "{}"
            }
        );
        assert.equal(unauthenticatedAdminReceiptRetry.status, 401);
        const unauthenticatedAdminReceiptPreview = await fetch(
            `${baseUrl}/api/orders/c5c0c718-6e68-4a0f-b490-eaa4897bb4b1/admin/receipt/preview`
        );
        assert.equal(unauthenticatedAdminReceiptPreview.status, 401);
        const unauthenticatedDeliveryApproval = await fetch(
            `${baseUrl}/api/orders/c5c0c718-6e68-4a0f-b490-eaa4897bb4b1/admin/approve-delivery`,
            {
                method: "PATCH",
                headers: { "content-type": "application/json" },
                body: "{}"
            }
        );
        assert.equal(unauthenticatedDeliveryApproval.status, 401);
        const unauthenticatedPickupApproval = await fetch(
            `${baseUrl}/api/orders/c5c0c718-6e68-4a0f-b490-eaa4897bb4b1/admin/approve-pickup`,
            {
                method: "PATCH",
                headers: { "content-type": "application/json" },
                body: "{}"
            }
        );
        assert.equal(unauthenticatedPickupApproval.status, 401);

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
            server.close((error) => (error ? reject(error) : resolve()));
        });
    }
});
