const PDFDocument = require("pdfkit");

function formatMoney(cents) {
    return `PHP ${(cents / 100).toFixed(2)}`;
}

function createReceiptPdf(order) {
    return new Promise((resolve, reject) => {
        const document = new PDFDocument({ size: "A4", margin: 52 });
        const chunks = [];

        document.on("data", (chunk) => chunks.push(chunk));
        document.once("error", reject);
        document.once("end", () => resolve(Buffer.concat(chunks)));

        const customer = order.customer || {};
        const pricing = order.pricing || {};
        const orderNumber = order.id.slice(0, 8).toUpperCase();

        document.fontSize(22).font("Helvetica-Bold").text("Coffee Lab");
        document.moveDown(0.3).fontSize(15).text("Digital order receipt");
        document.moveDown().fontSize(10).font("Helvetica")
            .text(`Order: CL-${orderNumber}`)
            .text(`Date: ${new Date(order.created_at).toLocaleString("en-PH", { timeZone: "UTC" })}`)
            .text(`Fulfillment: ${order.fulfillment_method === "pickup" ? "Pickup" : "Delivery"}`)
            .text(`Customer: ${String(customer.name || "Coffee Lab customer").slice(0, 80)}`);

        if (order.fulfillment_method === "delivery" && order.delivery_address) {
            document.text(`Delivery address: ${String(order.delivery_address).slice(0, 300)}`);
        }

        document.moveDown().font("Helvetica-Bold").text("Items");
        document.moveDown(0.35);
        for (const item of order.order_items || []) {
            document.font("Helvetica").text(
                `${String(item.name || "Coffee").slice(0, 80)}  —  ${formatMoney(item.price_cents)}`
            );
        }

        document.moveDown().font("Helvetica")
            .text(`Drinks subtotal: ${formatMoney(pricing.subtotal_cents || 0)}`)
            .text(`Delivery: ${formatMoney(pricing.delivery_fee_cents || 0)}`)
            .text(`Service fee: ${formatMoney(pricing.service_fee_cents || 0)}`)
            .text(`Tax: ${formatMoney(pricing.tax_cents || 0)}`)
            .text(`Tip: ${formatMoney(pricing.tip_cents || 0)}`);
        document.moveDown(0.3).font("Helvetica-Bold").fontSize(13)
            .text(`Total: ${formatMoney(pricing.total_cents || 0)}`);
        document.moveDown(2).font("Helvetica").fontSize(9)
            .text("Thank you for ordering from Coffee Lab.");

        document.end();
    });
}

module.exports = { createReceiptPdf };
