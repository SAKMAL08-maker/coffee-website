const test = require("node:test");
const assert = require("node:assert/strict");
const { hasActiveSetupAuthorization, hasPreapprovedSetup, isOnlyTrustedFactor } = require("../services/adminMfa");

test("setup works only while the superadmin's approval is unexpired", () => {
    const account = {
        admin_mfa_setup_token_hash: "a".repeat(64),
        admin_mfa_setup_token_expires_at: new Date(2_000).toISOString(),
        admin_mfa_setup_preapproved: true
    };

    assert.equal(hasActiveSetupAuthorization(account, 1_000), true);
    assert.equal(hasActiveSetupAuthorization(account, 2_000), false);
    assert.equal(hasPreapprovedSetup(account, 1_000), true);
    assert.equal(hasPreapprovedSetup({ ...account, admin_mfa_setup_preapproved: false }, 1_000), false);
});

test("admin factor authorization requires the sole verified factor to match", () => {
    const trusted = { id: "trusted", factor_type: "totp", status: "verified" };

    assert.equal(isOnlyTrustedFactor([trusted], "trusted"), true);
    assert.equal(isOnlyTrustedFactor([{ ...trusted, status: "unverified" }], "trusted"), false);
    assert.equal(isOnlyTrustedFactor([{ ...trusted, factor_type: "phone" }], "trusted"), false);
    assert.equal(isOnlyTrustedFactor([trusted, { ...trusted, id: "unapproved" }], "trusted"), false);
    assert.equal(isOnlyTrustedFactor([], "trusted"), false);
});
