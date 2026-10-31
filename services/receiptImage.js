const { RECEIPT_COLUMNS, buildReceipt, buildReceiptLines } = require("./receiptModel");

// Same layout as the PDF (services/receiptModel.js), drawn as an SVG "paper slip".
const FONT_SIZE = 20;
const CHAR_WIDTH = FONT_SIZE * 0.6;
const LINE_HEIGHT = 29;
const PADDING = 36;
const WIDTH = Math.round(RECEIPT_COLUMNS * CHAR_WIDTH + 2 * PADDING);

function escapeXml(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

// The paper, with a torn zigzag along the bottom edge.
function paperPath(bottom) {
    const step = 16;
    let path = `M0 0 H${WIDTH} V${bottom}`;
    for (let x = WIDTH; x > 0; x -= step)
        path += ` L${x - step / 2} ${bottom + 10} L${Math.max(0, x - step)} ${bottom}`;
    return `${path} Z`;
}

function createReceiptImage(order) {
    const receipt = buildReceipt(order);
    const lines = buildReceiptLines(order);
    const right = WIDTH - PADDING;
    const parts = [];
    let y = PADDING + LINE_HEIGHT * 0.75;
    for (const line of lines) {
        if (line.rule) {
            const middle = Math.round(y - LINE_HEIGHT * 0.3);
            const rule = line.rule === "=" ? "rule-strong" : "rule";
            parts.push(`<path d="M${PADDING} ${middle}H${right}" class="${rule}"/>`);
        } else if (!line.blank) {
            const classes = [line.bold ? "bold" : "", line.large ? "large" : ""].filter(Boolean).join(" ");
            const attribute = classes ? ` class="${classes}"` : "";
            if (line.align === "center") {
                parts.push(
                    `<text x="${WIDTH / 2}" y="${y}" text-anchor="middle"${attribute}>${escapeXml(line.left)}</text>`
                );
            } else {
                if (line.left) {
                    parts.push(
                        `<text x="${PADDING}" y="${y}" xml:space="preserve"${attribute}>${escapeXml(line.left)}</text>`
                    );
                }
                if (line.right) {
                    parts.push(
                        `<text x="${right}" y="${y}" text-anchor="end"${attribute}>${escapeXml(line.right)}</text>`
                    );
                }
            }
        }
        y += LINE_HEIGHT;
    }
    const paperBottom = Math.round(y + PADDING / 2);
    const height = paperBottom + 12;
    const total = lines.find((line) => /^TOTAL (DUE|PAID)$/.test(line.left));

    return Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}" role="img" aria-labelledby="title description">
<title id="title">${escapeXml(receipt.business.name)} receipt ${escapeXml(receipt.number)}</title>
<desc id="description">Receipt for ${escapeXml(receipt.customerName)}, ${escapeXml(total ? `${total.left} ${total.right}` : "")}.</desc>
<style>
text{white-space:pre;font-family:"Courier New",Courier,monospace;font-size:${FONT_SIZE}px;fill:#1c1a17}
.bold{font-weight:700}.large{font-size:${Math.round(FONT_SIZE * 1.25)}px}
.rule{stroke:#1c1a17;stroke-width:1;stroke-dasharray:4 4}.rule-strong{stroke:#1c1a17;stroke-width:2}
</style>
<path d="${paperPath(paperBottom)}" fill="#fffdf8" stroke="#ddd5c8" stroke-width="1"/>
${parts.join("\n")}
</svg>`,
        "utf8"
    );
}

module.exports = { createReceiptImage };
