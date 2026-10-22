require("dotenv").config();

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const express = require("express");
const helmet = require("helmet");
const { assertSupabaseConfig } = require("./config/supabase");
const userRoutes = require("./routes/userRoutes");
const coffeeRoutes = require("./routes/coffeeRoutes");
const orderRoutes = require("./routes/orderRoutes");

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
    imgSrc: ["'self'", "data:", "blob:"],
    objectSrc: ["'none'"],
    scriptSrc: ["'self'", (request, response) => `'nonce-${response.locals.cspNonce}'`],
    styleSrc: ["'self'", (request, response) => `'nonce-${response.locals.cspNonce}'`],
    styleSrcAttr: ["'unsafe-inline'"]
};
if (process.env.NODE_ENV === "production") contentSecurityDirectives.upgradeInsecureRequests = [];

app.use((request, response, next) => {
    response.locals.cspNonce = crypto.randomBytes(18).toString("base64");
    next();
});
app.use(helmet({
    contentSecurityPolicy: { directives: contentSecurityDirectives },
    hsts: process.env.NODE_ENV === "production"
        ? { maxAge: 31_536_000, includeSubDomains: true }
        : false
}));
app.use(express.json({ limit: "1mb" }));

app.get(["/", "/index.html"], async (request, response, next) => {
    try {
        const html = await fs.promises.readFile(path.join(__dirname, "index.html"), "utf8");
        const nonce = response.locals.cspNonce;
        response.set("Cache-Control", "no-store");
        response.type("html").send(html.replace(/<(script|style)(?=[\s>])/gi, `<$1 nonce="${nonce}"`));
    } catch (error) {
        next(error);
    }
});

app.use("/api/users", userRoutes);
app.use("/api/coffees", coffeeRoutes);
app.use("/api/orders", orderRoutes);

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
        return response.status(status).json({ error: safeMessages[status] });
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
