const qrcode = require("qrcode-generator");

// Error-correction level M survives ~15% damage (smudged prints, glare on a phone).
const QR_ERROR_CORRECTION = "M";

/**
 * Builds the link a QR code points to. PUBLIC_APP_URL (e.g. https://coffee-lab.onrender.com)
 * is preferred so the code never depends on the incoming Host header; otherwise the
 * request's own origin is used (fine locally and behind a trusted proxy).
 */
function buildRecipeShareUrl(slug, requestOrigin, configuredBaseUrl = process.env.PUBLIC_APP_URL) {
    const baseUrl = configuredBaseUrl ? configuredBaseUrl.replace(/\/+$/, "") : requestOrigin;
    const url = new URL("/", baseUrl);
    url.searchParams.set("recipe", slug);
    return url.toString();
}

/** Scalable SVG QR code. Generated on the server so the CSP can stay `img-src 'self'`. */
function createRecipeQrSvg(shareUrl) {
    const code = qrcode(0, QR_ERROR_CORRECTION);
    code.addData(shareUrl);
    code.make();
    return code.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
}

module.exports = { buildRecipeShareUrl, createRecipeQrSvg };
