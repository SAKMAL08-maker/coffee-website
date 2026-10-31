/**
 * Profile pictures in the same private Backblaze B2 bucket as receipts, under avatars/.
 * The browser never gets a B2 link: GET /api/profile/avatar/:userId streams the image
 * through the API with a long cache lifetime (the URL changes when the picture does).
 */
const { PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const { readStorageConfig, createStorageClient } = require("./b2ReceiptStorage");

const MAX_AVATAR_BYTES = 300 * 1024;

// Identified by content, never by the client's Content-Type. SVG is not accepted (it can carry script).
function detectImageType(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { mime: "image/jpeg", extension: "jpg" };
    if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
        return { mime: "image/png", extension: "png" };
    }
    if (buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
        return { mime: "image/webp", extension: "webp" };
    }
    return null;
}

function mimeForKey(objectKey) {
    if (objectKey.endsWith(".png")) return "image/png";
    if (objectKey.endsWith(".webp")) return "image/webp";
    return "image/jpeg";
}

function requireConfig(environment) {
    const config = readStorageConfig(environment);
    if (!config) {
        throw Object.assign(new Error("Profile pictures need file storage, which isn't set up on this server yet."), {
            statusCode: 409
        });
    }
    return config;
}

async function uploadAvatar(userId, buffer, type, environment = process.env) {
    const config = requireConfig(environment);
    const objectKey = `avatars/${userId}/${Date.now()}.${type.extension}`;
    await createStorageClient(config).send(
        new PutObjectCommand({ Bucket: config.bucket, Key: objectKey, Body: buffer, ContentType: type.mime })
    );
    return objectKey;
}

async function readAvatar(objectKey, environment = process.env) {
    const config = requireConfig(environment);
    const result = await createStorageClient(config).send(
        new GetObjectCommand({ Bucket: config.bucket, Key: objectKey })
    );
    return { body: result.Body, contentType: mimeForKey(objectKey) };
}

async function deleteAvatar(objectKey, environment = process.env) {
    const config = readStorageConfig(environment);
    if (!config || !objectKey) return;
    await createStorageClient(config).send(new DeleteObjectCommand({ Bucket: config.bucket, Key: objectKey }));
}

module.exports = { MAX_AVATAR_BYTES, detectImageType, uploadAvatar, readAvatar, deleteAvatar };
