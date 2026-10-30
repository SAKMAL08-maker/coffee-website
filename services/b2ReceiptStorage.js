const { GetObjectCommand, DeleteObjectCommand, PutObjectCommand, S3Client } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

function readStorageConfig(environment = process.env) {
    const values = {
        bucket: environment.B2_BUCKET_NAME,
        endpoint: environment.B2_ENDPOINT,
        region: environment.B2_REGION,
        accessKeyId: environment.B2_KEY_ID,
        secretAccessKey: environment.B2_APPLICATION_KEY
    };
    const configuredValues = Object.values(values).filter(Boolean).length;
    if (configuredValues === 0) return null;
    if (configuredValues !== Object.keys(values).length) {
        throw new Error("Backblaze B2 receipt storage configuration is incomplete.");
    }

    let endpoint;
    try {
        endpoint = new URL(values.endpoint);
    } catch {
        throw new Error("B2_ENDPOINT must be a valid HTTPS URL.");
    }
    if (
        endpoint.protocol !== "https:" ||
        endpoint.username ||
        endpoint.password ||
        endpoint.search ||
        endpoint.hash ||
        endpoint.pathname !== "/"
    ) {
        throw new Error("B2_ENDPOINT must be a valid HTTPS endpoint URL.");
    }
    if (!/^[a-z0-9.-]{3,63}$/.test(values.bucket) || !/^[a-z0-9-]+$/.test(values.region)) {
        throw new Error("Backblaze B2 receipt storage configuration is invalid.");
    }
    return { ...values, endpoint: endpoint.origin };
}

function createStorageClient(config) {
    return new S3Client({
        endpoint: config.endpoint,
        region: config.region,
        forcePathStyle: true,
        credentials: {
            accessKeyId: config.accessKeyId,
            secretAccessKey: config.secretAccessKey
        }
    });
}

async function uploadReceipt(orderId, pdfBuffer, environment = process.env) {
    const config = readStorageConfig(environment);
    if (!config) return null;

    const client = createStorageClient(config);
    const objectKey = `receipts/${orderId}.pdf`;
    await client.send(
        new PutObjectCommand({
            Bucket: config.bucket,
            Key: objectKey,
            Body: pdfBuffer,
            ContentType: "application/pdf",
            ContentDisposition: `attachment; filename="Coffee-Lab-Receipt-${orderId.slice(0, 8)}.pdf"`
        })
    );
    return objectKey;
}

async function uploadReceiptImage(orderId, imageBuffer, environment = process.env) {
    const config = readStorageConfig(environment);
    if (!config) return null;

    const client = createStorageClient(config);
    const objectKey = `receipts/${orderId}.svg`;
    await client.send(
        new PutObjectCommand({
            Bucket: config.bucket,
            Key: objectKey,
            Body: imageBuffer,
            ContentType: "image/svg+xml; charset=utf-8",
            ContentDisposition: `inline; filename="Coffee-Lab-Receipt-${orderId.slice(0, 8)}.svg"`
        })
    );
    return objectKey;
}

async function createReceiptDownloadUrl(objectKey, environment = process.env) {
    const config = readStorageConfig(environment);
    if (!config) throw new Error("Backblaze B2 receipt storage is not configured.");

    const client = createStorageClient(config);
    return getSignedUrl(
        client,
        new GetObjectCommand({
            Bucket: config.bucket,
            Key: objectKey,
            ResponseContentType: "application/pdf",
            ResponseContentDisposition: `attachment; filename="Coffee-Lab-Receipt-${objectKey.split("/").pop().replace(".pdf", "")}.pdf"`
        }),
        { expiresIn: 60 }
    );
}

async function createReceiptImageUrl(objectKey, environment = process.env) {
    const config = readStorageConfig(environment);
    if (!config) throw new Error("Backblaze B2 receipt storage is not configured.");

    const client = createStorageClient(config);
    return getSignedUrl(
        client,
        new GetObjectCommand({
            Bucket: config.bucket,
            Key: objectKey,
            ResponseContentType: "image/svg+xml",
            ResponseContentDisposition: `inline; filename="Coffee-Lab-Receipt-${objectKey.split("/").pop().replace(".svg", "")}.svg"`
        }),
        { expiresIn: 300 }
    );
}

async function deleteReceiptObject(objectKey, environment = process.env) {
    const config = readStorageConfig(environment);
    if (!config) throw new Error("Backblaze B2 receipt storage is not configured.");
    const client = createStorageClient(config);
    await client.send(
        new DeleteObjectCommand({
            Bucket: config.bucket,
            Key: objectKey
        })
    );
}

module.exports = {
    readStorageConfig,
    uploadReceipt,
    uploadReceiptImage,
    createReceiptDownloadUrl,
    createReceiptImageUrl,
    deleteReceiptObject
};
