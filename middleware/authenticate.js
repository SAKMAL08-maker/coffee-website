const { getAdminClient, createServerAuthClient } = require("../config/supabase");
const { hashSessionToken } = require("../services/accountSecurity");
const { isOnlyTrustedFactor } = require("../services/adminMfa");

const SESSION_COOKIE_NAME = "coffee_lab_session";
const ADMIN_ACCESS_COOKIE_NAME = "coffee_lab_admin_access";
const ADMIN_REFRESH_COOKIE_NAME = "coffee_lab_admin_refresh";
const ADMIN_MFA_ACCESS_COOKIE_NAME = "coffee_lab_admin_mfa_access";
const ADMIN_MFA_REFRESH_COOKIE_NAME = "coffee_lab_admin_mfa_refresh";

function readCookie(request, name) {
    const cookieHeader = request.get("cookie") || "";
    for (const item of cookieHeader.split(";")) {
        const separator = item.indexOf("=");
        if (separator < 0 || item.slice(0, separator).trim() !== name) continue;
        return item.slice(separator + 1).trim() || null;
    }
    return null;
}

function readSessionToken(request) {
    return readCookie(request, SESSION_COOKIE_NAME);
}

function adminSessionCookie(name, value, maxAge) {
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    const maxAgeAttribute = maxAge ? `; Max-Age=${maxAge}` : "";
    return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax${maxAgeAttribute}${secure}`;
}

function clearAdminCookies(response) {
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    const expired = (name) => `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
    response.append("Set-Cookie", [
        expired(ADMIN_ACCESS_COOKIE_NAME),
        expired(ADMIN_REFRESH_COOKIE_NAME),
        expired(ADMIN_MFA_ACCESS_COOKIE_NAME),
        expired(ADMIN_MFA_REFRESH_COOKIE_NAME)
    ]);
}

function setPendingAdminCookies(response, session) {
    response.append("Set-Cookie", [
        adminSessionCookie(ADMIN_MFA_ACCESS_COOKIE_NAME, session.access_token, 300),
        adminSessionCookie(ADMIN_MFA_REFRESH_COOKIE_NAME, session.refresh_token, 300),
        adminSessionCookie(SESSION_COOKIE_NAME, "", 0)
    ]);
}

function setVerifiedAdminCookies(response, session) {
    response.append("Set-Cookie", [
        adminSessionCookie(ADMIN_ACCESS_COOKIE_NAME, session.access_token),
        adminSessionCookie(ADMIN_REFRESH_COOKIE_NAME, session.refresh_token),
        adminSessionCookie(ADMIN_MFA_ACCESS_COOKIE_NAME, "", 0),
        adminSessionCookie(ADMIN_MFA_REFRESH_COOKIE_NAME, "", 0),
        adminSessionCookie(SESSION_COOKIE_NAME, "", 0)
    ]);
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
    const adminAccessToken = readCookie(request, ADMIN_ACCESS_COOKIE_NAME);
    const adminRefreshToken = readCookie(request, ADMIN_REFRESH_COOKIE_NAME);
    if (adminAccessToken || adminRefreshToken) {
        if (!adminAccessToken || !adminRefreshToken) {
            clearAdminCookies(response);
            return response.status(401).json({ error: "Your administrator session is invalid. Sign in again." });
        }
        try {
            const authClient = createServerAuthClient();
            const { data: sessionData, error: sessionError } = await authClient.auth.setSession({
                access_token: adminAccessToken,
                refresh_token: adminRefreshToken
            });
            if (sessionError && ![400, 401].includes(sessionError.status)) return next(sessionError);
            if (sessionError || !sessionData.session) {
                clearAdminCookies(response);
                return response.status(401).json({ error: "Your administrator session has expired. Sign in again." });
            }
            const { data: claimsData, error: claimsError } = await authClient.auth.getClaims(
                sessionData.session.access_token
            );
            if (claimsError && ![400, 401].includes(claimsError.status)) return next(claimsError);
            if (claimsError || claimsData?.claims?.aal !== "aal2") {
                clearAdminCookies(response);
                return response.status(401).json({ error: "Administrator multi-factor verification is required." });
            }
            const supabase = getAdminClient();
            const { data: user, error: userError } = await supabase
                .from("coffee_users")
                .select("id, username, role, created_at, admin_mfa_factor_id")
                .eq("supabase_auth_user_id", claimsData.claims.sub)
                .maybeSingle();
            if (userError) throw userError;
            if (!user || user.role !== "admin" || !user.admin_mfa_factor_id) {
                clearAdminCookies(response);
                return response.status(403).json({ error: "Administrator access is not permitted." });
            }
            const { data: factors, error: factorsError } = await authClient.auth.mfa.listFactors();
            if (factorsError) throw factorsError;
            if (!isOnlyTrustedFactor(factors.all, user.admin_mfa_factor_id)) {
                clearAdminCookies(response);
                return response
                    .status(403)
                    .json({ error: "The enrolled authenticator does not match the administrator-approved factor." });
            }
            if (
                sessionData.session.access_token !== adminAccessToken ||
                sessionData.session.refresh_token !== adminRefreshToken
            ) {
                response.append("Set-Cookie", [
                    adminSessionCookie(ADMIN_ACCESS_COOKIE_NAME, sessionData.session.access_token),
                    adminSessionCookie(ADMIN_REFRESH_COOKIE_NAME, sessionData.session.refresh_token)
                ]);
            }
            request.user = user;
            request.sessionId = null;
            request.authMethod = "supabase-mfa";
            request.aal = claimsData.claims.aal;
            request.supabaseAuthClient = authClient;
            request.supabaseAuthSession = sessionData.session;
            return next();
        } catch (error) {
            return next(error);
        }
    }

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
        if (user.role === "admin") {
            response.set("Set-Cookie", clearSessionCookie());
            return response
                .status(401)
                .json({ error: "Administrator accounts must sign in with Supabase multi-factor authentication." });
        }

        request.user = user;
        request.sessionId = session.id;
        // The superadmin signs in with password + security questions (no authenticator),
        // so its session is marked separately; requireAdmin accepts only this method for it.
        request.authMethod = user.role === "superadmin" ? "superadmin-session" : "coffee-session";
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
    if (!["staff", "admin", "superadmin"].includes(request.user.role)) {
        return response.status(403).json({ error: "Staff access is required." });
    }
    next();
}

function isSuperadminSession(request) {
    return request.user?.role === "superadmin" && request.authMethod === "superadmin-session";
}

/** True for an MFA-verified admin or the superadmin: the same rule as requireAdmin, as a check. */
function hasAdminAccess(request) {
    if (!request.user) return false;
    if (isSuperadminSession(request)) return true;
    return request.user.role === "admin" && request.authMethod === "supabase-mfa" && request.aal === "aal2";
}

function requireAdmin(request, response, next) {
    if (!request.user) return response.status(401).json({ error: "Authentication is required." });
    if (isSuperadminSession(request)) return next();
    if (request.user.role !== "admin") {
        return response.status(403).json({ error: "Administrator access is required." });
    }
    if (request.authMethod !== "supabase-mfa" || request.aal !== "aal2") {
        return response.status(403).json({ error: "Administrator multi-factor verification is required." });
    }
    next();
}

function requireSuperadmin(request, response, next) {
    if (!request.user) return response.status(401).json({ error: "Authentication is required." });
    if (!isSuperadminSession(request)) {
        return response.status(403).json({ error: "Superadmin access is required." });
    }
    next();
}

module.exports = {
    SESSION_COOKIE_NAME,
    ADMIN_ACCESS_COOKIE_NAME,
    ADMIN_REFRESH_COOKIE_NAME,
    ADMIN_MFA_ACCESS_COOKIE_NAME,
    ADMIN_MFA_REFRESH_COOKIE_NAME,
    readSessionToken,
    readCookie,
    sessionCookie,
    clearSessionCookie,
    setPendingAdminCookies,
    setVerifiedAdminCookies,
    clearAdminCookies,
    authenticate,
    optionalAuthenticate,
    requireStaff,
    requireAdmin,
    hasAdminAccess,
    requireSuperadmin
};
