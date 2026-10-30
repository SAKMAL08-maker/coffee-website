const test = require("node:test");
const assert = require("node:assert/strict");
const { app } = require("../server");
const { calculateOrderPricing } = require("../services/pricingService");

const latte = {
    configuration: {
        base: "espresso",
        volumeMl: 360,
        shots: 3,
        milk: "oat",
        syrups: { vanilla: 1, caramel: 0, chocolate: 0 }
    }
};

async function withServer(run) {
    const server = app.listen(0);
    try {
        await run(`http://127.0.0.1:${server.address().port}`);
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
}

function postQuote(baseUrl, body) {
    return fetch(`${baseUrl}/api/orders/quote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
    });
}

test("POST /api/orders/quote returns the same totals checkout would save", async () => {
    await withServer(async (baseUrl) => {
        for (const fulfillmentMethod of ["pickup", "delivery"]) {
            const response = await postQuote(baseUrl, { items: [latte, latte], fulfillmentMethod, tipPercent: 12.5 });
            assert.equal(response.status, 200);
            assert.equal(response.headers.get("cache-control"), "no-store");
            const quote = await response.json();
            const saved = calculateOrderPricing([latte, latte], fulfillmentMethod, 12.5);
            assert.equal(quote.pricing.totalCents, saved.pricing.total_cents);
            assert.equal(quote.pricing.deliveryFeeCents, fulfillmentMethod === "delivery" ? 4900 : 0);
            assert.equal(quote.items.length, 2);
            assert.equal(quote.items[0].priceCents, saved.lineItems[0].price_cents);
        }
    });
});

test("POST /api/orders/quote rejects client prices, customer data, and bad input", async () => {
    await withServer(async (baseUrl) => {
        const invalidBodies = [
            { items: [{ ...latte, price: 1 }], fulfillmentMethod: "pickup" },
            { items: [latte], fulfillmentMethod: "pickup", customer: { name: "A", phone: "1" } },
            { items: [], fulfillmentMethod: "pickup" },
            { items: [latte], fulfillmentMethod: "drone" },
            { items: [latte], fulfillmentMethod: "pickup", tipPercent: 101 },
            { items: [{ configuration: { ...latte.configuration, shots: 9 } }], fulfillmentMethod: "pickup" }
        ];
        for (const body of invalidBodies) {
            const response = await postQuote(baseUrl, body);
            assert.equal(response.status, 400, JSON.stringify(body));
            assert.deepEqual(await response.json(), { error: "Request data is invalid." });
        }
    });
});

test("PATCH /api/orders/:orderId/status is rate-limited before authentication", async () => {
    await withServer(async (baseUrl) => {
        const url = `${baseUrl}/api/orders/c5c0c718-6e68-4a0f-b490-eaa4897bb4b1/status`;
        const request = () =>
            fetch(url, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status: "Crafting" })
            });
        const first = await request();
        assert.equal(first.status, 401);
        assert.ok(
            first.headers.get("ratelimit-policy") || first.headers.get("ratelimit"),
            "rate limit headers present"
        );
    });
});
