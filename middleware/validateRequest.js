function validateRequest(schemas) {
    return (request, response, next) => {
        for (const [location, schema] of Object.entries(schemas)) {
            const result = schema.safeParse(request[location]);
            if (!result.success) {
                return response.status(400).json({ error: "Request data is invalid." });
            }
            if (location !== "query") request[location] = result.data;
        }
        next();
    };
}

module.exports = { validateRequest };
