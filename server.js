require("dotenv").config();

const fs = require("fs");
const path = require("path");
const express = require("express");
const helmet = require("helmet");
const compression = require("compression");
const { assertSupabaseConfig } = require("./config/supabase");
const userRoutes = require("./routes/userRoutes");
const coffeeRoutes = require("./routes/coffeeRoutes");
const orderRoutes = require("./routes/orderRoutes");
const recipeRoutes = require("./routes/recipeRoutes");
const caffeineRoutes = require("./routes/caffeineRoutes");
const adminRoutes = require("./routes/adminRoutes");
const superadminRoutes = require("./routes/superadminRoutes");
const profileRoutes = require("./routes/profileRoutes");
const supportRoutes = require("./routes/supportRoutes");
const { startReceiptSweeper } = require("./services/receiptQueue");
const healthRoutes = require("./routes/healthRoutes");
const { verifySameOrigin } = require("./middleware/originProtection");

const app = express();
const port = Number(process.env.PORT) || 3000;

app.disable("x-powered-by");
const trustedProxyHops = process.env.TRUST_PROXY_HOPS;
if (trustedProxyHops !== undefined && trustedProxyHops !== "") {
    const hopCount = Number(trustedProxyHops);
    if (!Number.isInteger(hopCount) || hopCount < 1) {
        throw new Error("TRUST_PROXY_HOPS must be a positive integer when configured.");
    }
    app.set("trust proxy", hopCount);
}
const contentSecurityDirectives = {
    defaultSrc: ["'self'"],
    baseUri: ["'self'"],
    connectSrc: ["'self'"],
    fontSrc: ["'self'", "data:"],
    formAction: ["'self'"],
    frameAncestors: ["'none'"],
    imgSrc: ["'self'", "https://*.backblazeb2.com", "data:", "blob:"],
    objectSrc: ["'none'"],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'"],
    styleSrcAttr: ["'unsafe-inline'"]
};
if (process.env.NODE_ENV === "production") contentSecurityDirectives.upgradeInsecureRequests = [];

app.use(
    helmet({
        contentSecurityPolicy: { directives: contentSecurityDirectives },
        hsts: process.env.NODE_ENV === "production" ? { maxAge: 31_536_000, includeSubDomains: true } : false
    })
);
// Scalability option B: gzip text responses (HTML, CSS, JS, JSON are ~234 KB raw).
app.use(compression());
app.use(express.json({ limit: "1mb" }));
// Mounted outside /api on purpose: uptime pingers are cross-site callers, so the
// same-origin guard below must not apply. It exposes no data, only up/down.
app.use("/healthz", healthRoutes);
app.use(express.static(path.join(__dirname, "public"), { dotfiles: "deny", index: false }));
app.use("/api", verifySameOrigin);

// The page never changes while the server runs, so production reads it once.
// Development re-reads it so edits show up without a restart.
let cachedIndexHtml = null;
async function readIndexHtml() {
    if (cachedIndexHtml) return cachedIndexHtml;
    const html = await fs.promises.readFile(path.join(__dirname, "index.html"), "utf8");
    if (process.env.NODE_ENV === "production") cachedIndexHtml = html;
    return html;
}

app.get(["/", "/index.html"], async (request, response, next) => {
    try {
        const html = await readIndexHtml();
        response.set("Cache-Control", "no-store");
        response.type("html").send(html);
    } catch (error) {
        next(error);
    }
});

app.use("/api/users", userRoutes);
app.use("/api/coffees", coffeeRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/recipes", recipeRoutes);
app.use("/api/caffeine", caffeineRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/superadmin", superadminRoutes);
app.use("/api/profile", profileRoutes);
app.use("/api/support", supportRoutes);

app.use((request, response) => {
    response.status(404).json({ error: "Not found." });
});

app.use((error, request, response, next) => {
    if (response.headersSent) return next(error);
    if (error.type === "entity.parse.failed") {
        return response.status(400).json({ error: "Request body must contain valid JSON." });
    }
    if (error.type === "entity.too.large") {
        return response.status(413).json({ error: "Request body is too large." });
    }
    if (error.statusCode && error.statusCode < 500) {
        const safeMessages = {
            400: "Request data is invalid.",
            401: "Authentication is required.",
            403: "Access is not permitted.",
            404: "Not found.",
            409: "The request conflicts with the current resource state."
        };
        const status = [400, 401, 403, 404, 409].includes(error.statusCode) ? error.statusCode : 400;
        // 4xx messages are written for the user (our services, or http-errors, which marks a
        // message that must stay private with expose: false). Showing them tells people what to
        // fix, e.g. "Demote it instead"; the generic text is only a fallback.
        const message =
            error.expose !== false && typeof error.message === "string" && error.message.trim()
                ? error.message.slice(0, 300)
                : safeMessages[status];
        return response.status(status).json({ error: message });
    }

    console.error("Request failed:", {
        method: request.method,
        path: request.path,
        errorName: error.name,
        errorMessage: error.message,
        stack: error.stack
    });
    response.status(500).json({ error: "An unexpected server error occurred." });
});

async function startServer() {
    assertSupabaseConfig();
    startReceiptSweeper();
    return app.listen(port, () => {
        console.log(`Coffee Lab API listening on http://localhost:${port} (Supabase configured).`);
    });
}

if (require.main === module) {
    startServer().catch((error) => {
        console.error("Could not start Coffee Lab:", error.message);
        process.exitCode = 1;
    });
}

module.exports = { app, startServer };
