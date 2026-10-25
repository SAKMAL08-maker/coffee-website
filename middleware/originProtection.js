function verifySameOrigin(request, response, next) {
    const origin = request.get("origin");
    const fetchSite = request.get("sec-fetch-site");

    if (fetchSite === "cross-site") {
        return response.status(403).json({ error: "Cross-origin requests are not allowed." });
    }
    if (origin) {
        let originHost;
        try {
            originHost = new URL(origin).host;
        } catch {
            return response.status(403).json({ error: "Cross-origin requests are not allowed." });
        }
        if (originHost !== request.get("host")) {
            return response.status(403).json({ error: "Cross-origin requests are not allowed." });
        }
    }
    next();
}

module.exports = { verifySameOrigin };
