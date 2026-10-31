const PDFDocument = require("pdfkit");
const { RECEIPT_COLUMNS, buildReceiptLines } = require("./receiptModel");

// 80 mm receipt roll. Courier is a built-in PDF font, so no font files are needed.
const PAGE_WIDTH = 226.77;
const MARGIN = 12;
const FONT_SIZE = (PAGE_WIDTH - 2 * MARGIN) / (RECEIPT_COLUMNS * 0.6);
const LINE_HEIGHT = FONT_SIZE * 1.45;

function createReceiptPdf(order) {
    const lines = buildReceiptLines(order);
    const height = Math.ceil(2 * MARGIN + lines.length * LINE_HEIGHT + LINE_HEIGHT * 2);
    return new Promise((resolve, reject) => {
        const document = new PDFDocument({ size: [PAGE_WIDTH, height], margin: MARGIN });
        const chunks = [];
        document.on("data", (chunk) => chunks.push(chunk));
        document.once("error", reject);
        document.once("end", () => resolve(Buffer.concat(chunks)));

        const contentWidth = PAGE_WIDTH - 2 * MARGIN;
        let y = MARGIN;
        for (const line of lines) {
            if (line.rule) {
                const middle = y + LINE_HEIGHT / 2;
                document
                    .save()
                    .moveTo(MARGIN, middle)
                    .lineTo(PAGE_WIDTH - MARGIN, middle);
                if (line.rule === "=") document.lineWidth(1);
                else document.lineWidth(0.5).dash(2, { space: 2 });
                document.strokeColor("#222222").stroke().restore();
            } else if (!line.blank) {
                const size = line.large ? FONT_SIZE * 1.25 : FONT_SIZE;
                document
                    .font(line.bold ? "Courier-Bold" : "Courier")
                    .fontSize(size)
                    .fillColor("#111111");
                const options = { width: contentWidth, lineBreak: false };
                if (line.align === "center") document.text(line.left, MARGIN, y, { ...options, align: "center" });
                else {
                    if (line.left) document.text(line.left, MARGIN, y, options);
                    if (line.right) document.text(line.right, MARGIN, y, { ...options, align: "right" });
                }
            }
            y += LINE_HEIGHT;
        }
        document.end();
    });
}

module.exports = { createReceiptPdf };
