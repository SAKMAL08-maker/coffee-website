const jwt = require("jsonwebtoken");
const User = require("../models/User");

function getToken(request) {
    const authorization = request.get("authorization") || "";
    if (!authorization.startsWith("Bearer ")) return null;
    return authorization.slice(7);
}

async function authenticate(request, response, next) {
    const token = getToken(request);
    if (!token) return response.status(401).json({ error: "Authentication is required." });

    try {
        const payload = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(payload.sub).select("+sessionVersion");
        if (!user || user.sessionVersion !== payload.sessionVersion) {
            return response.status(401).json({ error: "Your session is no longer valid." });
        }
        request.user = user;
        next();
    } catch (error) {
        if (error.name === "JsonWebTokenError" || error.name === "TokenExpiredError") {
            return response.status(401).json({ error: "Your session is invalid or expired." });
        }
        next(error);
    }
}

async function optionalAuthenticate(request, response, next) {
    if (!getToken(request)) return next();
    return authenticate(request, response, next);
}

function requireStaff(request, response, next) {
    if (!request.user || request.user.role !== "staff") {
        return response.status(403).json({ error: "Staff access is required." });
    }
    next();
}

module.exports = { authenticate, optionalAuthenticate, requireStaff };
