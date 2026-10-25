const test = require("node:test");
const assert = require("node:assert/strict");
const { createReceiptPdf } = require("../services/receiptPdf");
const { createReceiptImage } = require("../services/receiptImage");
const { readStorageConfig } = require("../services/b2ReceiptStorage");

test("creates a readable PDF receipt from a saved order", async () => {
    const pdf = await createReceiptPdf({
        id: "c5c0c718-6e68-4a0f-b490-eaa4897bb4b1",
        customer: { name: "Coffee Customer" },
        fulfillment_method: "pickup",
        created_at: "2026-10-26T12:00:00.000Z",
        pricing: {
            subtotal_cents: 25000,
            delivery_fee_cents: 0,
            service_fee_cents: 2000,
            tax_cents: 3000,
            tip_cents: 3750,
            total_cents: 33750
        },
        order_items: [{ name: "Vanilla Latte", price_cents: 25000 }]
    });

    test("creates a self-contained receipt image with escaped order data and item totals", () => {
        const image = createReceiptImage({
            id: "c5c0c718-6e68-4a0f-b490-eaa4897bb4b1",
            customer: { name: "Coffee <Customer>" },
            fulfillment_method: "pickup",
            created_at: "2026-10-26T12:00:00.000Z",
            pricing: {
                subtotal_cents: 25000,
                delivery_fee_cents: 0,
                service_fee_cents: 2000,
                tax_cents: 3000,
                tip_cents: 3750,
                total_cents: 33750
            },
            order_items: [{ name: "Vanilla <Latte>", classification: "Latte", price_cents: 25000 }]
        }).toString("utf8");

        assert.match(image, /^<svg /);
        assert.match(image, /Coffee Lab/);
        assert.match(image, /Coffee &lt;Customer&gt;/);
        assert.match(image, /Vanilla &lt;Latte&gt;/);
        assert.match(image, /TOTAL PAID/);
        assert.match(image, /PHP 337\.50/);
        assert.doesNotMatch(image, /Coffee <Customer>/);
    });

    assert.ok(Buffer.isBuffer(pdf));
    assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
    assert.ok(pdf.length > 500);
});

test("accepts no B2 configuration but rejects partial or unsafe endpoints", () => {
    assert.equal(readStorageConfig({}), null);
    assert.throws(() => readStorageConfig({ B2_BUCKET_NAME: "r3c3ipts" }), /configuration is incomplete/);
    assert.throws(() => readStorageConfig({
        B2_BUCKET_NAME: "r3c3ipts",
        B2_ENDPOINT: "http://s3.example.com",
        B2_REGION: "us-west-004",
        B2_KEY_ID: "key-id",
        B2_APPLICATION_KEY: "application-key"
    }), /HTTPS/);

    const config = readStorageConfig({
        B2_BUCKET_NAME: "r3c3ipts",
        B2_ENDPOINT: "https://s3.us-west-004.backblazeb2.com",
        B2_REGION: "us-west-004",
        B2_KEY_ID: "key-id",
        B2_APPLICATION_KEY: "application-key"
    });
    assert.equal(config.bucket, "r3c3ipts");
    assert.equal(config.endpoint, "https://s3.us-west-004.backblazeb2.com");
});
