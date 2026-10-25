const { getAdminClient } = require("../config/supabase");
const { createReceiptPdf } = require("./receiptPdf");
const {
    readStorageConfig,
    uploadReceipt,
    createReceiptDownloadUrl,
    deleteReceiptObject
} = require("./b2ReceiptStorage");

async function updateReceiptStatus(supabase, orderId, values) {
    const { error } = await supabase
        .from("orders")
        .update(values)
        .eq("id", orderId);
    if (error) throw error;
}

async function createOrderReceipt(orderId) {
    const supabase = getAdminClient();
    const { data: order, error } = await supabase
        .from("orders")
        .select("id, customer, fulfillment_method, delivery_address, pricing, created_at, order_items(name, price_cents)")
        .eq("id", orderId)
        .maybeSingle();
    if (error) throw error;
    if (!order) throw new Error("Saved order was not found while creating its receipt.");

    try {
        const storageConfig = readStorageConfig();
        if (!storageConfig) {
            await updateReceiptStatus(supabase, orderId, {
                receipt_status: "unavailable",
                receipt_object_key: null,
                receipt_generated_at: null
            });
            return "unavailable";
        }

        const pdfBuffer = await createReceiptPdf(order);
        const objectKey = await uploadReceipt(orderId, pdfBuffer);
        if (!objectKey) throw new Error("Receipt storage became unavailable during upload.");
        await updateReceiptStatus(supabase, orderId, {
            receipt_status: "available",
            receipt_object_key: objectKey,
            receipt_generated_at: new Date().toISOString()
        });
        return "available";
    } catch (error) {
        await updateReceiptStatus(supabase, orderId, {
            receipt_status: "failed",
            receipt_object_key: null,
            receipt_generated_at: null
        });
        throw error;
    }
}

async function getOwnedReceipt(accountId, orderId) {
    const { data, error } = await getAdminClient()
        .from("orders")
        .select("id, receipt_status, receipt_object_key")
        .eq("id", orderId)
        .eq("account_id", accountId)
        .maybeSingle();
    if (error) throw error;
    return data;
}

async function getReceiptDownloadUrl(accountId, orderId) {
    const order = await getOwnedReceipt(accountId, orderId);
    if (!order) return { status: "not_found" };
    if (order.receipt_status !== "available" || !order.receipt_object_key) {
        return { status: order.receipt_status || "unavailable" };
    }
    return {
        status: "available",
        url: await createReceiptDownloadUrl(order.receipt_object_key)
    };
}

async function retryOwnedReceipt(accountId, orderId) {
    const order = await getOwnedReceipt(accountId, orderId);
    if (!order) return { status: "not_found" };
    if (order.receipt_status === "available" && order.receipt_object_key) {
        return { status: "available" };
    }
    return { status: await createOrderReceipt(orderId) };
}

async function getAdminReceiptDownloadUrl(orderId) {
    const { data, error } = await getAdminClient()
        .from("orders")
        .select("receipt_status, receipt_object_key")
        .eq("id", orderId)
        .maybeSingle();
    if (error) throw error;
    if (!data) return { status: "not_found" };
    if (data.receipt_status !== "available" || !data.receipt_object_key) {
        return { status: data.receipt_status || "unavailable" };
    }
    return {
        status: "available",
        url: await createReceiptDownloadUrl(data.receipt_object_key)
    };
}

async function retryAdminReceipt(orderId) {
    const { data: order, error } = await getAdminClient()
        .from("orders")
        .select("id, receipt_status, receipt_object_key")
        .eq("id", orderId)
        .maybeSingle();
    if (error) throw error;
    if (!order) return { status: "not_found" };
    if (order.receipt_status === "available" && order.receipt_object_key) {
        return { status: "available" };
    }
    return { status: await createOrderReceipt(orderId) };
}

async function deleteStoredReceipt(objectKey) {
    if (objectKey) await deleteReceiptObject(objectKey);
}

module.exports = {
    createOrderReceipt,
    getReceiptDownloadUrl,
    retryOwnedReceipt,
    getAdminReceiptDownloadUrl,
    retryAdminReceipt,
    deleteStoredReceipt
};
