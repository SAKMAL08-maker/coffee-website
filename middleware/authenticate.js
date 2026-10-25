const { getAdminClient } = require("../config/supabase");
const { hashSessionToken } = require("../services/accountSecurity");

const SESSION_COOKIE_NAME = "coffee_lab_session";

function readSessionToken(request) {
    const cookieHeader = request.get("cookie") || "";
    for (const item of cookieHeader.split(";")) {
        const separator = item.indexOf("=");
        if (separator < 0 || item.slice(0, separator).trim() !== SESSION_COOKIE_NAME) continue;
        return item.slice(separator + 1).trim() || null;
    }
    return null;
}

function sessionCookie(token, persistent) {
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    const maxAge = persistent ? "; Max-Age=2592000" : "";
    return `${SESSION_COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax${maxAge}${secure}`;
}

function clearSessionCookie() {
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

async function authenticate(request, response, next) {
    const token = readSessionToken(request);
    if (!token) return response.status(401).json({ error: "Authentication is required." });

    try {
        const supabase = getAdminClient();
        const { data: session, error: sessionError } = await supabase
            .from("coffee_sessions")
            .select("id, user_id")
            .eq("token_hash", hashSessionToken(token))
            .gt("expires_at", new Date().toISOString())
            .maybeSingle();
        if (sessionError) throw sessionError;
        if (!session) {
            response.set("Set-Cookie", clearSessionCookie());
            return response.status(401).json({ error: "Your session has expired. Please sign in again." });
        }

        const { data: user, error: userError } = await supabase
            .from("coffee_users")
            .select("id, username, role, created_at")
            .eq("id", session.user_id)
            .maybeSingle();
        if (userError) throw userError;
        if (!user) {
            response.set("Set-Cookie", clearSessionCookie());
            return response.status(401).json({ error: "Your session is no longer valid." });
        }

        request.user = user;
        request.sessionId = session.id;
        next();
    } catch (error) {
        next(error);
    }
}

async function optionalAuthenticate(request, response, next) {
    if (!readSessionToken(request)) return next();
    return authenticate(request, response, next);
}

function requireStaff(request, response, next) {
    if (!request.user) return response.status(401).json({ error: "Authentication is required." });
    if (!["staff", "admin"].includes(request.user.role)) {
        return response.status(403).json({ error: "Staff access is required." });
    }
    next();
}

module.exports = {
    SESSION_COOKIE_NAME,
    readSessionToken,
    sessionCookie,
    clearSessionCookie,
    authenticate,
    optionalAuthenticate,
    requireStaff
};
