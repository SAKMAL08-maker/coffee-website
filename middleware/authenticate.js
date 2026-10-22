const { getAuthClient, getAdminClient } = require("../config/supabase");

function readAccessToken(request) {
    const authorization = request.get("authorization") || "";
    if (!authorization.startsWith("Bearer ")) return null;
    return authorization.slice("Bearer ".length).trim() || null;
}

async function authenticate(request, response, next) {
    const accessToken = readAccessToken(request);
    if (!accessToken) return response.status(401).json({ error: "Authentication is required." });

    try {
        const { data, error } = await getAuthClient().auth.getUser(accessToken);
        if (error || !data.user) {
            return response.status(401).json({ error: "Your Supabase session is invalid or expired." });
        }
        request.user = data.user;
        request.accessToken = accessToken;
        next();
    } catch (error) {
        next(error);
    }
}

async function optionalAuthenticate(request, response, next) {
    if (!readAccessToken(request)) return next();
    return authenticate(request, response, next);
}

async function requireStaff(request, response, next) {
    if (!request.user) return response.status(401).json({ error: "Authentication is required." });

    try {
        const { data, error } = await getAdminClient()
            .from("profiles")
            .select("role")
            .eq("id", request.user.id)
            .maybeSingle();
        if (error) throw error;
        if (!data || data.role !== "staff") {
            return response.status(403).json({ error: "Staff access is required." });
        }
        next();
    } catch (error) {
        next(error);
    }
}

module.exports = { authenticate, optionalAuthenticate, requireStaff };
