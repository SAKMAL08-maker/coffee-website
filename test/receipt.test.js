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
        // Cash is collected on pickup/delivery, so the receipt shows an amount due, not "paid".
        assert.match(image, /TOTAL DUE/);
        assert.doesNotMatch(image, /TOTAL PAID/);
        // No payment_method on this (pre-migration-shaped) order: it defaults to cash.
        assert.match(image, /Pay in cash on pickup/);
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
    assert.throws(
        () =>
            readStorageConfig({
                B2_BUCKET_NAME: "r3c3ipts",
                B2_ENDPOINT: "http://s3.example.com",
                B2_REGION: "us-west-004",
                B2_KEY_ID: "key-id",
                B2_APPLICATION_KEY: "application-key"
            }),
        /HTTPS/
    );

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

test("receipts use the same order number as the screens: CL- plus the tracking code's last 6", () => {
    const { displayOrderCode } = require("../services/orderCode");
    const order = { id: "c5c0c718-6e68-4a0f-b490-eaa4897bb4b1", tracking_code: "f".repeat(42) + "ab12cd" };
    assert.equal(displayOrderCode(order), "CL-AB12CD");
    // Older data without a tracking code keeps the previous id-based number.
    assert.equal(displayOrderCode({ id: order.id }), "CL-C5C0C718");
    const image = createReceiptImage({
        ...order,
        customer: { name: "A" },
        fulfillment_method: "pickup",
        created_at: "2026-10-26T12:00:00.000Z",
        pricing: { total_cents: 100 },
        order_items: []
    }).toString("utf8");
    assert.match(image, /CL-AB12CD/);
});

test("receipts follow the point-of-sale format: VAT breakdown, paid status, 42 columns, one 80 mm page", async () => {
    const { buildReceiptLines, RECEIPT_COLUMNS } = require("../services/receiptModel");
    const order = {
        id: "c5c0c718-6e68-4a0f-b490-eaa4897bb4b1",
        tracking_code: "f".repeat(42) + "ab12cd",
        customer: { name: "Juan Dela Cruz" },
        fulfillment_method: "delivery",
        delivery_address: "Unit 12B, 88 Katipunan Avenue, Loyola Heights, Quezon City, Metro Manila",
        payment_method: "cash",
        cash_collected_at: "2026-10-31T05:40:00Z",
        created_at: "2026-10-31T05:12:00Z",
        pricing: {
            subtotal_cents: 25000,
            delivery_fee_cents: 4900,
            service_fee_cents: 2000,
            tax_cents: 3418,
            vat_inclusive: true,
            tip_cents: 3750,
            total_cents: 35650
        },
        order_items: Array.from({ length: 12 }, (_, index) => ({
            name: `Iced Caramel Macchiato with an extra shot number ${index}`,
            classification: "Macchiato",
            price_cents: 25000
        }))
    };
    const lines = buildReceiptLines(order);
    for (const line of lines.filter((candidate) => !candidate.rule && !candidate.blank)) {
        const text = `${line.left || ""}${line.right ? ` ${line.right}` : ""}`;
        assert.ok(text.length <= RECEIPT_COLUMNS, `too wide: ${text}`);
    }
    const text = lines.map((line) => `${line.left || ""} ${line.right || ""}`).join("\n");
    assert.match(text, /TOTAL PAID +PHP 356\.50/);
    // VAT-inclusive: VATable sales + VAT = drinks + delivery + service charge (₱319.00); the tip is outside VAT.
    assert.match(text, /VATable sales +284\.82/);
    assert.match(text, /VAT amount \(12%\) +34\.18/);
    assert.match(text, /PAID - Cash, Oct 31, 2026/);
    assert.match(text, /CL-AB12CD/);
    assert.match(text, /Not\s+valid for claiming input tax/);

    const pdf = (await createReceiptPdf(order)).toString("latin1");
    assert.equal((pdf.match(/\/Type \/Page\b/g) || []).length, 1, "the whole receipt fits on one page");
    assert.match(pdf, /\/MediaBox \[0 0 226\.77/);
});
