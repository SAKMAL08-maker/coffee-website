const test = require("node:test");
const assert = require("node:assert/strict");
const {
    hashSetupToken,
    hasValidSetupToken,
    hasActiveSetupAuthorization,
    isOnlyTrustedFactor
} = require("../services/adminMfa");

test("bootstrap authorization accepts only its matching unexpired setup token", () => {
    const token = "owner-issued-one-time-setup-token";
    const account = {
        admin_mfa_setup_token_hash: hashSetupToken(token),
        admin_mfa_setup_token_expires_at: new Date(2_000).toISOString()
    };

    assert.equal(hasValidSetupToken(account, token, 1_000), true);
    assert.equal(hasValidSetupToken(account, "incorrect-token", 1_000), false);
    assert.equal(hasValidSetupToken(account, token, 2_000), false);
    assert.equal(hasActiveSetupAuthorization(account, 1_000), true);
    assert.equal(hasActiveSetupAuthorization(account, 2_000), false);
    assert.equal(hasValidSetupToken({ ...account, admin_mfa_setup_token_hash: "not-a-hash" }, token, 1_000), false);
});

test("admin factor authorization requires the sole verified factor to match", () => {
    const trusted = { id: "trusted", factor_type: "totp", status: "verified" };

    assert.equal(isOnlyTrustedFactor([trusted], "trusted"), true);
    assert.equal(isOnlyTrustedFactor([{ ...trusted, status: "unverified" }], "trusted"), false);
    assert.equal(isOnlyTrustedFactor([{ ...trusted, factor_type: "phone" }], "trusted"), false);
    assert.equal(isOnlyTrustedFactor([trusted, { ...trusted, id: "unapproved" }], "trusted"), false);
    assert.equal(isOnlyTrustedFactor([], "trusted"), false);
});
