require("dotenv").config();

const path = require("path");
const express = require("express");
const { assertSupabaseConfig } = require("./config/supabase");
const userRoutes = require("./routes/userRoutes");
const coffeeRoutes = require("./routes/coffeeRoutes");
const orderRoutes = require("./routes/orderRoutes");

const app = express();
const port = Number(process.env.PORT) || 3000;

app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

app.get(["/", "/index.html"], (request, response) => {
    response.sendFile(path.join(__dirname, "index.html"));
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
        return response.status(error.statusCode).json({ error: error.message });
    }

    console.error("Request failed:", error);
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
