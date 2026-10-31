/**
 * One receipt layout shared by the PDF and the image, so they can never disagree.
 *
 * The format follows a point-of-sale receipt as issued by Philippine cafés: an 80 mm
 * roll, 42 monospaced columns, the business header, a receipt number and date, one row
 * per item, the VAT breakdown (VATable / VAT / VAT-exempt / zero-rated sales) and the
 * payment status. buildReceiptLines() returns plain text lines; receiptPdf.js and
 * receiptImage.js only draw them.
 *
 * Business details come from the environment so they can be filled in once the shop is
 * registered: BUSINESS_NAME, BUSINESS_ADDRESS, BUSINESS_TIN, BUSINESS_EMAIL and
 * BIR_PERMIT_NUMBER. Until a BIR permit number is set, the receipt says it is a
 * system-generated proof of purchase rather than claiming to be a BIR invoice.
 */
const { displayOrderCode } = require("./orderCode");
const { describePaymentInstruction } = require("./paymentService");

const RECEIPT_COLUMNS = 42;
const AMOUNT_COLUMNS = 12;

function amount(cents) {
    return ((Number(cents) || 0) / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatManila(value, options) {
    const date = new Date(value);
    return Number.isNaN(date.getTime())
        ? "Date unavailable"
        : date.toLocaleString("en-PH", { timeZone: "Asia/Manila", ...options });
}

// Splits text into lines of at most `width` characters, breaking at spaces where possible.
function wrap(text, width) {
    const words = String(text || "")
        .replace(/\s+/g, " ")
        .trim()
        .split(" ");
    const lines = [];
    let line = "";
    for (let word of words) {
        while (word.length > width) {
            if (line) lines.push(line);
            lines.push(word.slice(0, width));
            word = word.slice(width);
            line = "";
        }
        if (!line) line = word;
        else if (line.length + 1 + word.length <= width) line += ` ${word}`;
        else {
            lines.push(line);
            line = word;
        }
    }
    if (line) lines.push(line);
    return lines.length ? lines : [""];
}

function readBusiness(environment) {
    return {
        name: environment.BUSINESS_NAME || "Coffee Lab",
        address: environment.BUSINESS_ADDRESS || "",
        tin: environment.BUSINESS_TIN || "",
        email: environment.BUSINESS_EMAIL || "coffeelab08@gmail.com",
        permit: environment.BIR_PERMIT_NUMBER || ""
    };
}

/** The receipt's content, independent of how it is drawn. */
function buildReceipt(order, environment = process.env) {
    const pricing = order.pricing || {};
    const customer = order.customer || {};
    const business = readBusiness(environment);
    const isPickup = order.fulfillment_method === "pickup";
    const isPaid = Boolean(order.cash_collected_at);

    const fees = [
        ["Subtotal", pricing.subtotal_cents],
        ["Delivery fee", isPickup ? 0 : pricing.delivery_fee_cents],
        ["Service charge (8%)", pricing.service_fee_cents]
    ].filter(([, cents], index) => index === 0 || Number(cents) > 0);
    // Older orders added tax on top of the prices; newer ones include it (pricing.vat_inclusive).
    if (!pricing.vat_inclusive) fees.push(["VAT (12%)", pricing.tax_cents]);
    if (Number(pricing.tip_cents) > 0) fees.push(["Tip (not subject to VAT)", pricing.tip_cents]);

    const vatCents = Number(pricing.tax_cents) || 0;
    const vatableGrossCents = pricing.vat_inclusive
        ? (Number(pricing.subtotal_cents) || 0) +
          (Number(pricing.delivery_fee_cents) || 0) +
          (Number(pricing.service_fee_cents) || 0)
        : (Number(pricing.subtotal_cents) || 0) + vatCents;

    return {
        business,
        title: "ORDER RECEIPT",
        number: displayOrderCode(order),
        issuedAt: formatManila(order.created_at, { dateStyle: "medium", timeStyle: "short" }),
        customerName: String(customer.name || "Walk-in customer"),
        orderType: isPickup ? "Pickup" : "Delivery",
        deliveryAddress: !isPickup && order.delivery_address ? String(order.delivery_address) : "",
        items: (order.order_items || []).map((item) => ({
            name: String(item.name || "Coffee"),
            detail: item.classification ? String(item.classification) : "",
            quantity: 1,
            cents: Number(item.price_cents) || 0
        })),
        fees,
        total: { label: isPaid ? "TOTAL PAID" : "TOTAL DUE", cents: pricing.total_cents },
        vat: [
            ["VATable sales", vatableGrossCents - vatCents],
            ["VAT amount (12%)", vatCents],
            ["VAT-exempt sales", 0],
            ["Zero-rated sales", 0]
        ],
        payment: isPaid
            ? `PAID - Cash, ${formatManila(order.cash_collected_at, { dateStyle: "medium", timeStyle: "short" })}`
            : `UNPAID - ${describePaymentInstruction(order.fulfillment_method, order.payment_method)}`
    };
}

/**
 * The receipt as lines of at most RECEIPT_COLUMNS characters. Each line is
 * { left, right, align: "left" | "center", bold, large } or { rule: "-" | "=" } or { blank: true }.
 */
function buildReceiptLines(order, environment = process.env) {
    const receipt = buildReceipt(order, environment);
    const lines = [];
    const width = RECEIPT_COLUMNS;
    const center = (text, extra = {}) =>
        wrap(text, width).forEach((part) => lines.push({ left: part, align: "center", ...extra }));
    const row = (label, value, extra = {}) => {
        const labelWidth = width - Math.max(AMOUNT_COLUMNS, value.length + 1);
        const parts = wrap(label, labelWidth);
        parts.forEach((part, index) =>
            lines.push({ left: part, right: index === parts.length - 1 ? value : "", ...extra })
        );
    };
    const rule = (char = "-") => lines.push({ rule: char });

    center(receipt.business.name.toUpperCase(), { bold: true, large: true });
    if (receipt.business.address) center(receipt.business.address);
    if (receipt.business.tin) center(`VAT Reg TIN: ${receipt.business.tin}`);
    center(receipt.business.email);
    lines.push({ blank: true });
    center(receipt.title, { bold: true });
    rule("=");
    row("Receipt no.", receipt.number);
    row("Date", receipt.issuedAt);
    row("Order type", receipt.orderType);
    row("Customer", receipt.customerName.slice(0, 28));
    if (receipt.deliveryAddress) {
        lines.push({ left: "Deliver to:" });
        wrap(receipt.deliveryAddress.slice(0, 200), width - 2).forEach((part) => lines.push({ left: `  ${part}` }));
    }
    rule();
    row("QTY  ITEM", "AMOUNT", { bold: true });
    rule();
    for (const item of receipt.items) {
        // QTY in the first 5 columns; a long name wraps under the item column, amount on its last line.
        const value = amount(item.cents);
        const nameLines = wrap(item.name.slice(0, 80), width - 5 - Math.max(AMOUNT_COLUMNS, value.length + 1));
        nameLines.forEach((part, index) =>
            lines.push({
                left: `${index === 0 ? String(item.quantity).padEnd(5) : "     "}${part}`,
                right: index === nameLines.length - 1 ? value : ""
            })
        );
        if (item.detail) lines.push({ left: `     ${item.detail.slice(0, width - 5)}` });
    }
    rule();
    for (const [label, cents] of receipt.fees) row(label, amount(cents));
    rule("=");
    row(receipt.total.label, `PHP ${amount(receipt.total.cents)}`, { bold: true, large: true });
    rule("=");
    for (const [label, cents] of receipt.vat) row(label, amount(cents));
    rule();
    wrap(receipt.payment, width).forEach((part) => lines.push({ left: part, bold: true }));
    rule();
    lines.push({ blank: true });
    center("Thank you for choosing Coffee Lab!");
    center("Keep this receipt for your records.");
    if (receipt.business.permit) center(`BIR Permit No.: ${receipt.business.permit}`);
    else center("System-generated proof of purchase. Not valid for claiming input tax.");
    return lines;
}

module.exports = { RECEIPT_COLUMNS, buildReceipt, buildReceiptLines, wrap };
