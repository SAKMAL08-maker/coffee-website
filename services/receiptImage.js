const { displayOrderCode } = require("./orderCode");
const { describePaymentInstruction } = require("./paymentService");

function escapeXml(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

function formatMoney(cents) {
    return `PHP ${((Number(cents) || 0) / 100).toFixed(2)}`;
}

function formatDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime())
        ? "Date unavailable"
        : date.toLocaleString("en-PH", {
              dateStyle: "medium",
              timeStyle: "short",
              timeZone: "Asia/Manila"
          });
}

function truncate(value, maxLength) {
    const text = String(value || "");
    return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function createReceiptImage(order) {
    const items = order.order_items || [];
    const pricing = order.pricing || {};
    const customer = order.customer || {};
    const orderCode = displayOrderCode(order);
    const lines = [];
    let y = 440;

    items.forEach((item, index) => {
        lines.push(`<text x="72" y="${y}" class="item">${escapeXml(truncate(item.name || "Coffee", 44))}</text>`);
        if (item.classification) {
            lines.push(
                `<text x="72" y="${y + 25}" class="subitem">${escapeXml(truncate(item.classification, 52))}</text>`
            );
        }
        lines.push(
            `<text x="828" y="${y}" class="item price" text-anchor="end">${escapeXml(formatMoney(item.price_cents))}</text>`
        );
        if (index < items.length - 1) {
            lines.push(`<path d="M72 ${y + 44}H828" class="rule"/>`);
        }
        y += 62;
    });

    y += 18;
    const totals = [
        ["Drinks subtotal", pricing.subtotal_cents],
        ["Delivery", pricing.delivery_fee_cents],
        ["Service fee", pricing.service_fee_cents],
        // Newer orders include VAT in the prices; it is shown for information, not added.
        [pricing.vat_inclusive ? "VAT included (12%)" : "Tax", pricing.tax_cents],
        ["Tip", pricing.tip_cents]
    ];
    totals.forEach(([label, amount]) => {
        if (label === "Delivery" && !Number(amount)) return;
        lines.push(`<text x="72" y="${y}" class="total-label">${escapeXml(label)}</text>`);
        lines.push(
            `<text x="828" y="${y}" class="total-value" text-anchor="end">${escapeXml(formatMoney(amount))}</text>`
        );
        y += 42;
    });

    const totalY = y + 15;
    const footerY = totalY + 131;
    const height = footerY + 72;
    const fulfillment = order.fulfillment_method === "pickup" ? "Pickup" : "Delivery";
    const paymentInstruction = describePaymentInstruction(order.fulfillment_method, order.payment_method);
    const customerName = truncate(customer.name || "Coffee Lab customer", 64);
    const address =
        order.fulfillment_method === "delivery" && order.delivery_address
            ? `<text x="72" y="340" class="meta">Address: ${escapeXml(truncate(order.delivery_address, 78))}</text>`
            : "";

    return Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="${height}" viewBox="0 0 900 ${height}" role="img" aria-labelledby="title description">
            <title id="title">Coffee Lab order receipt ${escapeXml(orderCode)}</title>
            <desc id="description">Receipt for ${escapeXml(customerName)}, total ${escapeXml(formatMoney(pricing.total_cents))}.</desc>
            <style>
                .brand{font:700 35px Arial,sans-serif;fill:#3b2314}.eyebrow{font:700 13px Arial,sans-serif;letter-spacing:3px;fill:#a47747}
                .order{font:700 18px Arial,sans-serif;fill:#3b2314}.meta{font:16px Arial,sans-serif;fill:#66594b}
                .section{font:700 13px Arial,sans-serif;letter-spacing:2px;fill:#8a725b}.item{font:600 17px Arial,sans-serif;fill:#30251d}
                .subitem{font:13px Arial,sans-serif;fill:#8a8176}.price,.total-value{font:600 16px Arial,sans-serif;fill:#30251d}
                .total-label{font:15px Arial,sans-serif;fill:#66594b}.grand-label{font:700 18px Arial,sans-serif;fill:#3b2314}
                .grand-value{font:700 28px Arial,sans-serif;fill:#3b2314}.footer{font:15px Arial,sans-serif;fill:#77695b}
                .rule{stroke:#e9dfd2;stroke-width:1}
            </style>
            <rect width="900" height="${height}" rx="28" fill="#f2ede5"/>
            <rect x="28" y="28" width="844" height="${height - 56}" rx="20" fill="#fffdf9" stroke="#e5d9ca" stroke-width="2"/>
            <text x="72" y="96" class="eyebrow">COFFEE LAB</text>
            <text x="72" y="145" class="brand">Order receipt</text>
            <text x="72" y="190" class="order">${escapeXml(orderCode)}</text>
            <text x="72" y="228" class="meta">${escapeXml(formatDate(order.created_at))}</text>
            <text x="72" y="266" class="meta">${escapeXml(fulfillment)} · ${escapeXml(customerName)}</text>
            ${address}
            <path d="M72 380H828" class="rule"/>
            <text x="72" y="414" class="section">ITEM</text>
            <text x="828" y="414" class="section" text-anchor="end">AMOUNT</text>
            ${lines.join("\n")}
            <path d="M72 ${totalY}H828" class="rule"/>
            <text x="72" y="${totalY + 52}" class="grand-label">TOTAL DUE</text>
            <text x="72" y="${totalY + 76}" class="meta">${escapeXml(paymentInstruction)}</text>
            <text x="828" y="${totalY + 58}" class="grand-value" text-anchor="end">${escapeXml(formatMoney(pricing.total_cents))}</text>
            <path d="M72 ${totalY + 96}H828" class="rule"/>
            <text x="450" y="${footerY}" class="footer" text-anchor="middle">Thank you for choosing Coffee Lab.</text>
        </svg>`,
        "utf8"
    );
}

module.exports = { createReceiptImage };
