const test = require("node:test");
const assert = require("node:assert/strict");
const {
    readSessionToken,
    sessionCookie,
    clearSessionCookie,
    ADMIN_ACCESS_COOKIE_NAME,
    ADMIN_REFRESH_COOKIE_NAME,
    ADMIN_MFA_ACCESS_COOKIE_NAME,
    ADMIN_MFA_REFRESH_COOKIE_NAME,
    requireStaff,
    requireAdmin
} = require("../middleware/authenticate");

test("session cookies are HttpOnly and only persistent when requested", () => {
    const temporaryCookie = sessionCookie("opaque-token", false);
    const persistentCookie = sessionCookie("opaque-token", true);

    assert.match(temporaryCookie, /HttpOnly/);
    assert.match(temporaryCookie, /SameSite=Lax/);
    assert.doesNotMatch(temporaryCookie, /Max-Age/);
    assert.match(persistentCookie, /Max-Age=2592000/);
    assert.match(clearSessionCookie(), /Max-Age=0/);
    assert.match(clearSessionCookie(), /HttpOnly/);
    assert.equal(ADMIN_ACCESS_COOKIE_NAME, "coffee_lab_admin_access");
    assert.equal(ADMIN_REFRESH_COOKIE_NAME, "coffee_lab_admin_refresh");
    assert.equal(ADMIN_MFA_ACCESS_COOKIE_NAME, "coffee_lab_admin_mfa_access");
    assert.equal(ADMIN_MFA_REFRESH_COOKIE_NAME, "coffee_lab_admin_mfa_refresh");
});

test("session cookie parsing only returns the named opaque session value", () => {
    const request = { get: () => "theme=dark; coffee_lab_session=abc_DEF-123; other=value" };
    assert.equal(readSessionToken(request), "abc_DEF-123");
});

test("customer accounts cannot pass the staff authorization guard", () => {
    let responseStatus;
    let continued = false;
    const response = {
        status(status) {
            responseStatus = status;
            return this;
        },
        json() {
            return this;
        }
    };

    requireStaff({ user: { role: "customer" } }, response, () => { continued = true; });
    assert.equal(responseStatus, 403);
    assert.equal(continued, false);

    requireStaff({ user: { role: "admin" } }, response, () => { continued = true; });
    assert.equal(continued, true);
});

test("only admin accounts can pass the administrator authorization guard", () => {
    const outcomes = [];
    const response = {
        status(status) {
            outcomes.push(status);
            return this;
        },
        json() {
            return this;
        }
    };

    requireAdmin({ user: { role: "staff" } }, response, () => outcomes.push("continued"));
    requireAdmin({ user: { role: "admin" } }, response, () => outcomes.push("continued"));
    requireAdmin({ user: { role: "admin" }, authMethod: "coffee-session", aal: "aal1" }, response, () => outcomes.push("continued"));
    requireAdmin({ user: { role: "admin" }, authMethod: "supabase-mfa", aal: "aal1" }, response, () => outcomes.push("continued"));
    requireAdmin({ user: { role: "admin" }, authMethod: "supabase-mfa", aal: "aal2" }, response, () => outcomes.push("continued"));
    assert.deepEqual(outcomes, [403, 403, 403, 403, "continued"]);
});
