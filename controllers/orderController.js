const crypto = require("crypto");
const { getAdminClient } = require("../config/supabase");
const {
    createOrderReceipt,
    getReceiptDownloadUrl,
    getOwnedReceiptImageUrl,
    retryOwnedReceipt,
    getAdminReceiptDownloadUrl,
    getReceiptImageUrl,
    retryAdminReceipt: retryAdminReceiptService,
    deleteStoredReceipt
} = require("../services/receiptService");

const ORDER_STATUSES = ["Received", "Crafting", "Out for Delivery", "Arrived"];
const { calculateOrderPricing } = require("../services/pricingService");
const { canTransitionOrderStatus } = require("../services/orderStatusMachine");
const { createCashCollectionUpdate } = require("../services/cashCollectionService");

function badRequest(message) {
    return Object.assign(new Error(message), { statusCode: 400 });
}

function validateCoordinates(coordinates) {
    if (coordinates === undefined) return undefined;
    if (!coordinates || typeof coordinates !== "object" || Array.isArray(coordinates)
        || Object.keys(coordinates).some((key) => !["latitude", "longitude"].includes(key))
        || typeof coordinates.latitude !== "number" || !Number.isFinite(coordinates.latitude)
        || coordinates.latitude < -90 || coordinates.latitude > 90
        || typeof coordinates.longitude !== "number" || !Number.isFinite(coordinates.longitude)
        || coordinates.longitude < -180 || coordinates.longitude > 180) {
        throw badRequest("deliveryCoordinates must contain valid latitude and longitude numbers.");
    }
    return coordinates;
}

async function checkout(request, response, next) {
    try {
        const allowedKeys = [
            "items", "fulfillmentMethod", "deliveryAddress", "deliveryCoordinates",
            "tipPercent", "customer", "notes"
        ];
        if (!request.body || typeof request.body !== "object" || Array.isArray(request.body)
            || Object.keys(request.body).some((key) => !allowedKeys.includes(key))) {
            throw badRequest("Checkout request contains an unsupported field.");
        }
        const {
            items,
            fulfillmentMethod,
            deliveryAddress,
            deliveryCoordinates,
            tipPercent = 15,
            customer,
            notes
        } = request.body;

        if (!customer || typeof customer !== "object" || Array.isArray(customer)
            || Object.keys(customer).some((key) => !["name", "phone", "email"].includes(key))
            || typeof customer.name !== "string" || !customer.name.trim() || customer.name.trim().length > 80
            || typeof customer.phone !== "string" || !customer.phone.trim() || customer.phone.trim().length > 32) {
            throw badRequest("Customer name and phone are required.");
        }
        if (customer.email !== undefined && (typeof customer.email !== "string" || customer.email.length > 254
            || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email))) {
            throw badRequest("customer.email must be a valid email address.");
        }
        if (fulfillmentMethod === "delivery" && (typeof deliveryAddress !== "string"
            || !deliveryAddress.trim() || deliveryAddress.trim().length > 300)) {
            throw badRequest("A delivery address of 300 characters or fewer is required for delivery.");
        }
        if (fulfillmentMethod === "pickup" && deliveryAddress !== undefined) {
            throw badRequest("Pickup orders must not include a delivery address.");
        }
        if (notes !== undefined && (typeof notes !== "string" || notes.length > 500)) {
            throw badRequest("notes must be 500 characters or fewer.");
        }

        const coordinates = validateCoordinates(deliveryCoordinates);
        if (fulfillmentMethod !== "delivery" && coordinates) {
            throw badRequest("Delivery coordinates can only be provided for delivery orders.");
        }
        const { lineItems, pricing } = calculateOrderPricing(items, fulfillmentMethod, tipPercent);
        const trackingCode = crypto.randomBytes(24).toString("hex");
        const supabase = getAdminClient();
        const { data: orderId, error } = await supabase.rpc("create_coffee_order", {
            order_data: {
                tracking_code: trackingCode,
                account_id: request.user?.id || null,
                customer: {
                    name: customer.name.trim(),
                    phone: customer.phone.trim(),
                    ...(customer.email ? { email: customer.email.trim().toLowerCase() } : {})
                },
                fulfillment_method: fulfillmentMethod,
                ...(fulfillmentMethod === "delivery" ? { delivery_address: deliveryAddress.trim() } : {}),
                ...(coordinates ? { delivery_coordinates: coordinates } : {}),
                ...(notes ? { notes: notes.trim() } : {}),
                payment_method: "cash",
                pricing
            },
            item_data: lineItems
        });
        if (error) throw error;

        let receiptStatus = "unavailable";
        if (request.user) {
            try {
                receiptStatus = await createOrderReceipt(orderId);
            } catch (receiptError) {
                console.error("Could not create order receipt:", {
                    orderId,
                    errorName: receiptError.name,
                    errorCode: receiptError.Code || receiptError.code,
                    httpStatusCode: receiptError.$metadata?.httpStatusCode,
                    errorMessage: receiptError.message
                });
                receiptStatus = "failed";
            }
        } else {
            const { error: receiptStatusError } = await supabase
                .from("orders")
                .update({ receipt_status: "unavailable" })
                .eq("id", orderId);
            if (receiptStatusError) {
                console.error("Could not record receipt availability:", {
                    orderId,
                    errorName: receiptStatusError.name
                });
            }
        }

        response.status(201).json({
            order: {
                id: orderId,
                trackingCode,
                status: "Received",
                fulfillmentMethod,
                paymentMethod: "cash",
                itemCount: lineItems.length,
                pricing,
                receiptStatus,
                createdAt: new Date().toISOString()
            }
        });
    } catch (error) {
        next(error);
    }
}

async function trackOrder(request, response, next) {
    try {
        const supabase = getAdminClient();
        const { data: order, error } = await supabase
            .from("orders")
            .select("tracking_code, status, fulfillment_method, receipt_status, delivery_reported_at, pickup_approved_at, created_at, updated_at")
            .eq("tracking_code", request.params.trackingCode)
            .maybeSingle();
        if (error) throw error;
        if (!order) return response.status(404).json({ error: "Order not found." });

        response.json({
            order: {
                trackingCode: order.tracking_code,
                status: order.status,
                fulfillmentMethod: order.fulfillment_method,
                receiptStatus: order.receipt_status,
                deliveryReported: Boolean(order.delivery_reported_at),
                pickupApprovedAt: order.pickup_approved_at,
                createdAt: order.created_at,
                updatedAt: order.updated_at
            }
        });
    } catch (error) {
        next(error);
    }
}

async function downloadReceipt(request, response, next) {
    try {
        const receipt = await getReceiptDownloadUrl(request.user.id, request.params.orderId);
        if (receipt.status === "not_found") {
            return response.status(404).json({ error: "Order not found." });
        }
        if (receipt.status !== "available") {
            return response.status(409).json({ error: "This receipt is not available yet." });
        }
        response.redirect(302, receipt.url);
    } catch (error) {
        next(error);
    }
}

async function viewReceiptImage(request, response, next) {
    try {
        const receipt = await getOwnedReceiptImageUrl(request.user.id, request.params.orderId);
        if (receipt.status === "not_found") return response.status(404).json({ error: "Order not found." });
        if (receipt.status !== "available") {
            return response.status(409).json({ error: "This receipt image is not available yet." });
        }
        response.redirect(302, receipt.url);
    } catch (error) {
        next(error);
    }
}

async function retryReceipt(request, response, next) {
    try {
        const receipt = await retryOwnedReceipt(request.user.id, request.params.orderId);
        if (receipt.status === "not_found") {
            return response.status(404).json({ error: "Order not found." });
        }
        response.json({ receiptStatus: receipt.status });
    } catch (error) {
        next(error);
    }
}

async function reportDelivery(request, response, next) {
    try {
        const supabase = getAdminClient();
        const { data: order, error: readError } = await supabase
            .from("orders")
            .select("id, fulfillment_method, status, delivery_reported_at")
            .eq("id", request.params.orderId)
            .eq("account_id", request.user.id)
            .maybeSingle();
        if (readError) throw readError;
        if (!order) return response.status(404).json({ error: "Order not found." });
        if (order.fulfillment_method !== "delivery") {
            return response.status(400).json({ error: "Delivery confirmation is only available for delivery orders." });
        }
        if (order.status === "Delivered") {
            return response.status(409).json({ error: "This order has already been approved as delivered." });
        }
        if (order.delivery_reported_at) {
            return response.json({ deliveryReported: true });
        }

        const { data, error } = await supabase
            .from("orders")
            .update({ delivery_reported_at: new Date().toISOString() })
            .eq("id", order.id)
            .is("delivery_reported_at", null)
            .select("id")
            .maybeSingle();
        if (error) throw error;
        if (!data) return response.status(409).json({ error: "Delivery report changed; refresh and try again." });
        response.json({ deliveryReported: true });
    } catch (error) {
        next(error);
    }
}

function hasMissingOptionalOrderColumns(error) {
    return ["42703", "PGRST204"].includes(error?.code)
        || /column .* does not exist|could not find .* column/i.test(error?.message || "");
}

function isMissingOrdersTable(error) {
    return ["42P01", "PGRST205"].includes(error?.code)
        || /relation ["']?(public\.)?orders["']? does not exist|could not find the table .*orders/i.test(error?.message || "");
}

async function listAdminOrders(request, response, next) {
    try {
        const pageSize = 50;
        const page = Number(request.query.page) || 1;
        const supabase = getAdminClient();
        let { data, error, count } = await supabase
            .from("orders")
            .select("id, tracking_code, status, fulfillment_method, customer, delivery_address, notes, pricing, payment_method, cash_collected_at, cash_collected_by, receipt_status, delivery_reported_at, delivery_approved_at, pickup_approved_at, created_at, order_items(id, name, classification, configuration, price_cents)", { count: "exact" })
            .order("created_at", { ascending: false })
            .range((page - 1) * pageSize, page * pageSize - 1);
        let schemaWarning = null;
        if (error && hasMissingOptionalOrderColumns(error)) {
            console.warn("Admin orders query is using the base schema; apply the receipt and delivery approval migrations.");
            schemaWarning = "Some order details and receipt status are unavailable until the latest Supabase receipt, delivery, and pickup migrations are applied.";
            ({ data, error, count } = await supabase
                .from("orders")
                .select("id, tracking_code, status, fulfillment_method, customer, delivery_address, notes, pricing, created_at, order_items(id, name, classification, configuration, price_cents)", { count: "exact" })
                .order("created_at", { ascending: false })
                .range((page - 1) * pageSize, page * pageSize - 1));
        }
        if (error && isMissingOrdersTable(error)) {
            return response.status(503).json({
                error: "The Coffee Lab orders table is missing from this Supabase project. Apply the base coffee_lab migration before loading admin orders."
            });
        }
        if (error) throw error;
        response.json({
            page,
            pageSize,
            totalCount: count || 0,
            schemaWarning,
            orders: data.map((order) => ({
                id: order.id,
                trackingCode: order.tracking_code,
                status: order.status,
                fulfillmentMethod: order.fulfillment_method,
                customer: order.customer,
                deliveryAddress: order.delivery_address,
                notes: order.notes,
                pricing: order.pricing,
                paymentMethod: order.payment_method || "cash",
                cashCollectedAt: order.cash_collected_at,
                cashCollectedBy: order.cash_collected_by,
                receiptStatus: order.receipt_status || "unavailable",
                deliveryReportedAt: order.delivery_reported_at,
                deliveryApprovedAt: order.delivery_approved_at,
                pickupApprovedAt: order.pickup_approved_at,
                createdAt: order.created_at,
                items: order.order_items
            }))
        });
    } catch (error) {
        next(error);
    }
}

async function approveDelivery(request, response, next) {
    try {
        const supabase = getAdminClient();
        const { data: order, error: readError } = await supabase
            .from("orders")
            .select("id, fulfillment_method, status, delivery_reported_at, delivery_approved_at")
            .eq("id", request.params.orderId)
            .maybeSingle();
        if (readError) throw readError;
        if (!order) return response.status(404).json({ error: "Order not found." });
        if (order.fulfillment_method !== "delivery") {
            return response.status(409).json({ error: "Only delivery orders can be approved as delivered." });
        }
        if (order.status === "Delivered" || order.delivery_approved_at) {
            return response.status(409).json({ error: "This order is already approved as delivered." });
        }
        const approvedAt = new Date().toISOString();
        const { data, error } = await supabase
            .from("orders")
            .update({
                status: "Delivered",
                delivery_approved_at: approvedAt,
                delivery_approved_by: request.user.id,
                updated_at: approvedAt
            })
            .eq("id", order.id)
            .is("delivery_approved_at", null)
            .select("id, status, delivery_approved_at")
            .maybeSingle();
        if (error) throw error;
        if (!data) return response.status(409).json({ error: "Order changed; refresh and try again." });
        response.json({ order: { id: data.id, status: data.status, deliveryApprovedAt: data.delivery_approved_at } });
    } catch (error) {
        next(error);
    }
}

async function approvePickup(request, response, next) {
    try {
        const supabase = getAdminClient();
        const { data: order, error: readError } = await supabase
            .from("orders")
            .select("id, fulfillment_method, status, pickup_approved_at")
            .eq("id", request.params.orderId)
            .maybeSingle();
        if (readError) throw readError;
        if (!order) return response.status(404).json({ error: "Order not found." });
        if (order.fulfillment_method !== "pickup") {
            return response.status(409).json({ error: "Only pickup orders can be approved as ready for pickup." });
        }
        if (order.status === "Ready for Pickup" || order.pickup_approved_at) {
            return response.status(409).json({ error: "This order is already approved as ready for pickup." });
        }
        const approvedAt = new Date().toISOString();
        const { data, error } = await supabase
            .from("orders")
            .update({
                status: "Ready for Pickup",
                pickup_approved_at: approvedAt,
                pickup_approved_by: request.user.id,
                updated_at: approvedAt
            })
            .eq("id", order.id)
            .eq("status", order.status)
            .is("pickup_approved_at", null)
            .select("id, status, pickup_approved_at")
            .maybeSingle();
        if (error) throw error;
        if (!data) return response.status(409).json({ error: "Order changed; refresh and try again." });
        response.json({ order: { id: data.id, status: data.status, pickupApprovedAt: data.pickup_approved_at } });
    } catch (error) {
        next(error);
    }
}

async function retryAdminReceipt(request, response, next) {
    try {
        const receipt = await retryAdminReceiptService(request.params.orderId);
        if (receipt.status === "not_found") {
            return response.status(404).json({ error: "Order not found." });
        }
        response.json({ receiptStatus: receipt.status });
    } catch (error) {
        next(error);
    }
}

async function downloadAdminReceipt(request, response, next) {
    try {
        const receipt = await getAdminReceiptDownloadUrl(request.params.orderId);
        if (receipt.status === "not_found") return response.status(404).json({ error: "Order not found." });
        if (receipt.status !== "available") {
            return response.status(409).json({ error: "This receipt is not available." });
        }
        response.redirect(302, receipt.url);
    } catch (error) {
        next(error);
    }
}

async function viewAdminReceiptImage(request, response, next) {
    try {
        const receipt = await getReceiptImageUrl(request.params.orderId);
        if (receipt.status === "not_found") return response.status(404).json({ error: "Order not found." });
        if (receipt.status !== "available") {
            return response.status(409).json({ error: "This receipt image is not available yet." });
        }
        response.redirect(302, receipt.url);
    } catch (error) {
        next(error);
    }
}

async function deleteAdminOrder(request, response, next) {
    try {
        const supabase = getAdminClient();
        const { data: order, error: readError } = await supabase
            .from("orders")
            .select("id, receipt_object_key, receipt_image_object_key")
            .eq("id", request.params.orderId)
            .maybeSingle();
        if (readError) throw readError;
        if (!order) return response.status(404).json({ error: "Order not found." });
        if (order.receipt_object_key || order.receipt_image_object_key) {
            await deleteStoredReceipt(order.receipt_object_key, order.receipt_image_object_key);
        }

        const { data, error } = await supabase
            .from("orders")
            .delete()
            .eq("id", order.id)
            .select("id")
            .maybeSingle();
        if (error) throw error;
        if (!data) return response.status(409).json({ error: "Order changed; refresh and try again." });
        response.json({ message: "Order deleted." });
    } catch (error) {
        next(error);
    }
}

async function markCashCollected(request, response, next) {
    try {
        const supabase = getAdminClient();
        const { data: order, error: readError } = await supabase
            .from("orders")
            .select("id, payment_method, cash_collected_at, cash_collected_by")
            .eq("id", request.params.orderId)
            .maybeSingle();
        if (readError) throw readError;
        const collectedAt = new Date().toISOString();
        const update = createCashCollectionUpdate(order, request.user.id, collectedAt);
        const { data, error } = await supabase
            .from("orders")
            .update(update)
            .eq("id", order.id)
            .is("cash_collected_at", null)
            .is("cash_collected_by", null)
            .select("id, cash_collected_at, cash_collected_by")
            .maybeSingle();
        if (error) throw error;
        if (!data) return response.status(409).json({ error: "Cash collection status changed; refresh and try again." });
        response.json({ order: { id: data.id, cashCollectedAt: data.cash_collected_at } });
    } catch (error) {
        next(error);
    }
}

async function advanceOrderStatus(request, response, next) {
    try {
        if (!request.body || typeof request.body !== "object" || Array.isArray(request.body)
            || Object.keys(request.body).some((key) => key !== "status")) {
            throw badRequest("Request must contain only the next status.");
        }
        const { status } = request.body;
        if (!ORDER_STATUSES.includes(status)) throw badRequest("Unsupported order status.");
        const supabase = getAdminClient();
        const { data: currentOrder, error: readError } = await supabase
            .from("orders")
            .select("id, status, tracking_code")
            .eq("id", request.params.orderId)
            .maybeSingle();
        if (readError) throw readError;
        if (!currentOrder) return response.status(404).json({ error: "Order not found." });
        if (!canTransitionOrderStatus(currentOrder.status, status)) {
            return response.status(409).json({ error: "Order status transition is not allowed." });
        }
        const { data, error } = await supabase
            .from("orders")
            .update({ status, updated_at: new Date().toISOString() })
            .eq("id", currentOrder.id)
            .eq("status", currentOrder.status)
            .select("id, tracking_code, status")
            .maybeSingle();
        if (error) throw error;
        if (!data) return response.status(409).json({ error: "Order status changed; reload and try again." });
        response.json({ order: { id: data.id, trackingCode: data.tracking_code, status: data.status } });
    } catch (error) {
        next(error);
    }
}

async function listMyOrders(request, response, next) {
    try {
        const { data, error } = await getAdminClient()
            .from("orders")
            .select("id, tracking_code, status, fulfillment_method, pricing, receipt_status, created_at, updated_at, order_items(name, classification, price_cents)")
            .eq("account_id", request.user.id)
            .order("created_at", { ascending: false })
            .limit(50);
        if (error) throw error;
        response.json({
            orders: data.map((order) => ({
                ...order,
                trackingCode: order.tracking_code,
                fulfillmentMethod: order.fulfillment_method,
                receiptStatus: order.receipt_status || "unavailable",
                items: order.order_items || []
            }))
        });
    } catch (error) {
        next(error);
    }
}

module.exports = {
    calculateOrderPricing,
    checkout,
    trackOrder,
    reportDelivery,
    viewReceiptImage,
    listAdminOrders,
    approveDelivery,
    approvePickup,
    markCashCollected,
    retryAdminReceipt,
    downloadAdminReceipt,
    viewAdminReceiptImage,
    deleteAdminOrder,
    downloadReceipt,
    retryReceipt,
    advanceOrderStatus,
    listMyOrders
};
