const { promisify } = require("node:util");
const crypto = require("node:crypto");

const scrypt = promisify(crypto.scrypt);
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function createRecoveryCode() {
    const value = crypto.randomBytes(10).toString("hex").toUpperCase();
    return value.match(/.{1,5}/g).join("-");
}

function normalizeRecoveryCode(code) {
    return code.replace(/[\s-]/g, "").toUpperCase();
}

function hashRecoveryCode(code) {
    return crypto.createHash("sha256").update(normalizeRecoveryCode(code)).digest("hex");
}

function hashSessionToken(token) {
    return crypto.createHash("sha256").update(token).digest("hex");
}

async function hashPassword(password) {
    const salt = crypto.randomBytes(16);
    const derivedKey = await scrypt(password, salt, 64, SCRYPT_OPTIONS);
    return `scrypt$${SCRYPT_OPTIONS.N}$${SCRYPT_OPTIONS.r}$${SCRYPT_OPTIONS.p}$${salt.toString("base64url")}$${derivedKey.toString("base64url")}`;
}

async function verifyPassword(password, encodedHash) {
    const [algorithm, cost, blockSize, parallelization, saltText, keyText] = encodedHash.split("$");
    if (algorithm !== "scrypt" || Number(cost) !== SCRYPT_OPTIONS.N
        || Number(blockSize) !== SCRYPT_OPTIONS.r || Number(parallelization) !== SCRYPT_OPTIONS.p) {
        throw new Error("Stored password hash uses an unsupported format.");
    }
    const salt = Buffer.from(saltText, "base64url");
    const expectedKey = Buffer.from(keyText, "base64url");
    if (salt.length !== 16 || expectedKey.length !== 64) {
        throw new Error("Stored password hash is malformed.");
    }
    const actualKey = await scrypt(password, salt, expectedKey.length, SCRYPT_OPTIONS);
    return crypto.timingSafeEqual(actualKey, expectedKey);
}

function createSessionToken() {
    return crypto.randomBytes(32).toString("base64url");
}

module.exports = {
    createRecoveryCode,
    normalizeRecoveryCode,
    hashRecoveryCode,
    hashSessionToken,
    hashPassword,
    verifyPassword,
    createSessionToken
};
