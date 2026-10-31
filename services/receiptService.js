const { getAdminClient } = require("../config/supabase");
const { createReceiptPdf } = require("./receiptPdf");
const { createReceiptImage } = require("./receiptImage");
const {
    readStorageConfig,
    uploadReceipt,
    uploadReceiptImage,
    createReceiptDownloadUrl,
    createReceiptImageUrl,
    deleteReceiptObject
} = require("./b2ReceiptStorage");

async function updateReceiptStatus(supabase, orderId, values) {
    const { error } = await supabase.from("orders").update(values).eq("id", orderId);
    if (error) throw error;
}

async function createOrderReceipt(orderId) {
    const supabase = getAdminClient();
    const { data: order, error } = await supabase
        .from("orders")
        .select(
            "id, tracking_code, customer, fulfillment_method, delivery_address, payment_method, cash_collected_at, pricing, created_at, order_items(name, classification, price_cents)"
        )
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
                receipt_image_object_key: null,
                receipt_generated_at: null
            });
            return "unavailable";
        }

        const pdfBuffer = await createReceiptPdf(order);
        const imageBuffer = createReceiptImage(order);
        const [objectKey, imageObjectKey] = await Promise.all([
            uploadReceipt(orderId, pdfBuffer),
            uploadReceiptImage(orderId, imageBuffer)
        ]);
        if (!objectKey || !imageObjectKey) throw new Error("Receipt storage became unavailable during upload.");
        await updateReceiptStatus(supabase, orderId, {
            receipt_status: "available",
            receipt_object_key: objectKey,
            receipt_image_object_key: imageObjectKey,
            receipt_generated_at: new Date().toISOString()
        });
        return "available";
    } catch (error) {
        await updateReceiptStatus(supabase, orderId, {
            receipt_status: "failed",
            receipt_object_key: null,
            receipt_image_object_key: null,
            receipt_generated_at: null
        });
        throw error;
    }
}

async function getOwnedReceipt(accountId, orderId) {
    const { data, error } = await getAdminClient()
        .from("orders")
        .select("id, receipt_status, receipt_object_key, receipt_image_object_key")
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

async function getOwnedReceiptImageUrl(accountId, orderId) {
    const order = await getOwnedReceipt(accountId, orderId);
    if (!order) return { status: "not_found" };
    if (order.receipt_status !== "available" || !order.receipt_object_key) {
        return { status: order.receipt_status || "unavailable" };
    }
    return getReceiptImageUrl(orderId);
}

async function retryOwnedReceipt(accountId, orderId) {
    const order = await getOwnedReceipt(accountId, orderId);
    if (!order) return { status: "not_found" };
    if (order.receipt_status === "available" && order.receipt_object_key && order.receipt_image_object_key) {
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

async function getReceiptImageUrl(orderId) {
    const supabase = getAdminClient();
    const { data: order, error } = await supabase
        .from("orders")
        .select(
            "id, tracking_code, receipt_status, receipt_object_key, receipt_image_object_key, customer, fulfillment_method, delivery_address, payment_method, cash_collected_at, pricing, created_at, order_items(name, classification, price_cents)"
        )
        .eq("id", orderId)
        .maybeSingle();
    if (error) throw error;
    if (!order) return { status: "not_found" };
    if (order.receipt_status !== "available" || !order.receipt_object_key) {
        return { status: order.receipt_status || "unavailable" };
    }

    let imageObjectKey = order.receipt_image_object_key;
    if (!imageObjectKey) {
        imageObjectKey = await uploadReceiptImage(orderId, createReceiptImage(order));
        if (!imageObjectKey) return { status: "unavailable" };
        const { data, error: updateError } = await supabase
            .from("orders")
            .update({ receipt_image_object_key: imageObjectKey })
            .eq("id", orderId)
            .eq("receipt_status", "available")
            .is("receipt_image_object_key", null)
            .select("receipt_image_object_key")
            .maybeSingle();
        if (updateError) throw updateError;
        if (data) {
            imageObjectKey = data.receipt_image_object_key;
        } else {
            const { data: latestOrder, error: latestError } = await supabase
                .from("orders")
                .select("receipt_image_object_key")
                .eq("id", orderId)
                .maybeSingle();
            if (latestError) throw latestError;
            if (!latestOrder?.receipt_image_object_key) {
                throw new Error("Could not save the generated receipt image reference.");
            }
            imageObjectKey = latestOrder.receipt_image_object_key;
        }
    }

    return {
        status: "available",
        url: await createReceiptImageUrl(imageObjectKey)
    };
}

async function retryAdminReceipt(orderId) {
    const { data: order, error } = await getAdminClient()
        .from("orders")
        .select("id, receipt_status, receipt_object_key, receipt_image_object_key")
        .eq("id", orderId)
        .maybeSingle();
    if (error) throw error;
    if (!order) return { status: "not_found" };
    if (order.receipt_status === "available" && order.receipt_object_key && order.receipt_image_object_key) {
        return { status: "available" };
    }
    return { status: await createOrderReceipt(orderId) };
}

async function deleteStoredReceipt(objectKey, imageObjectKey) {
    for (const key of [objectKey, imageObjectKey]) {
        if (key) await deleteReceiptObject(key);
    }
}

module.exports = {
    createOrderReceipt,
    getReceiptDownloadUrl,
    getOwnedReceiptImageUrl,
    retryOwnedReceipt,
    getAdminReceiptDownloadUrl,
    getReceiptImageUrl,
    retryAdminReceipt,
    deleteStoredReceipt
};
