const test = require("node:test");
const assert = require("node:assert/strict");
const {
    createRecoveryCode,
    normalizeRecoveryCode,
    hashRecoveryCode,
    hashSessionToken,
    hashPassword,
    verifyPassword,
    createSessionToken
} = require("../services/accountSecurity");

test("recovery codes are random, normalized, and stored as hashes", () => {
    const firstCode = createRecoveryCode();
    const secondCode = createRecoveryCode();

    assert.match(firstCode, /^[A-F0-9]{5}(?:-[A-F0-9]{5}){3}$/);
    assert.notEqual(firstCode, secondCode);
    assert.equal(normalizeRecoveryCode(firstCode), firstCode.replace(/-/g, ""));
    assert.equal(hashRecoveryCode(firstCode), hashRecoveryCode(firstCode.toLowerCase().replace(/-/g, " ")));
    assert.notEqual(hashRecoveryCode(firstCode), firstCode);
});

test("session tokens are unguessable and only stored as one-way hashes", () => {
    const token = createSessionToken();
    assert.equal(Buffer.from(token, "base64url").length, 32);
    assert.equal(hashSessionToken(token).length, 64);
    assert.notEqual(hashSessionToken(token), token);
});

test("password hashes verify the password without storing it in plaintext", async () => {
    const password = "long secure sample passphrase";
    const encodedHash = await hashPassword(password);

    assert.match(encodedHash, /^scrypt\$/);
    assert.doesNotMatch(encodedHash, new RegExp(password));
    assert.equal(await verifyPassword(password, encodedHash), true);
    assert.equal(await verifyPassword("a different password", encodedHash), false);
});
