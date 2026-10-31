const crypto = require("crypto");
const { getAdminClient } = require("../config/supabase");
const { calculateOrderPricing, createOrderQuote: createOrderQuoteService } = require("../services/pricingService");
const {
    isKnownStatus,
    canStaffAdvance,
    canCancel,
    canApproveFulfillment,
    getApprovalStatus
} = require("../services/orderStatusMachine");
const {
    DEFAULT_PAYMENT_METHOD,
    canMarkCashCollected,
    describePaymentInstruction
} = require("../services/paymentService");
const { resolveRecipeRoyalties } = require("../services/communityRecipeService");
const {
    getReceiptDownloadUrl,
    getOwnedReceiptImageUrl,
    retryOwnedReceipt,
    getAdminReceiptDownloadUrl,
    getReceiptImageUrl,
    retryAdminReceipt: retryAdminReceiptService,
    deleteStoredReceipt
} = require("../services/receiptService");
const { enqueueReceipt } = require("../services/receiptQueue");
const { resolveOrderBranch, getSoldOut, assertAvailable } = require("../services/menuService");
const {
    FREE_DRINK_POINTS,
    getLoyaltyBalance,
    withPurchasePoints,
    isInsufficientPointsError
} = require("../services/loyaltyService");
const { ORDER_EVENT, EVENT_FOR_STATUS, recordOrderEvent } = require("../services/orderEvents");

function badRequest(message) {
    return Object.assign(new Error(message), { statusCode: 400 });
}

// Prices a cart without saving anything, so the browser can display exactly
// what checkout will charge. All math lives in services/pricingService.js.
async function createOrderQuote(request, response, next) {
    try {
        const { items, fulfillmentMethod, tipPercent, redeemFreeDrink } = request.body;
        response.set("Cache-Control", "no-store");
        response.json({
            ...createOrderQuoteService(items, fulfillmentMethod, tipPercent, { redeemFreeDrink }),
            // How the customer will pay, so checkout shows the same wording as the receipt.
            paymentInstruction: describePaymentInstruction(fulfillmentMethod)
        });
    } catch (error) {
        next(error);
    }
}

function validateCoordinates(coordinates) {
    if (coordinates === undefined) return undefined;
    if (
        !coordinates ||
        typeof coordinates !== "object" ||
        Array.isArray(coordinates) ||
        Object.keys(coordinates).some((key) => !["latitude", "longitude"].includes(key)) ||
        typeof coordinates.latitude !== "number" ||
        !Number.isFinite(coordinates.latitude) ||
        coordinates.latitude < -90 ||
        coordinates.latitude > 90 ||
        typeof coordinates.longitude !== "number" ||
        !Number.isFinite(coordinates.longitude) ||
        coordinates.longitude < -180 ||
        coordinates.longitude > 180
    ) {
        throw badRequest("deliveryCoordinates must contain valid latitude and longitude numbers.");
    }
    return coordinates;
}

async function checkout(request, response, next) {
    try {
        const allowedKeys = [
            "items",
            "fulfillmentMethod",
            "deliveryAddress",
            "deliveryCoordinates",
            "tipPercent",
            "customer",
            "notes",
            "redeemFreeDrink",
            "branchId"
        ];
        if (
            !request.body ||
            typeof request.body !== "object" ||
            Array.isArray(request.body) ||
            Object.keys(request.body).some((key) => !allowedKeys.includes(key))
        ) {
            throw badRequest("Checkout request contains an unsupported field.");
        }
        const {
            items,
            fulfillmentMethod,
            deliveryAddress,
            deliveryCoordinates,
            tipPercent = 15,
            customer,
            notes,
            redeemFreeDrink = false,
            branchId
        } = request.body;
        if (redeemFreeDrink && !request.user) {
            throw badRequest("Sign in to use loyalty points.");
        }

        if (
            !customer ||
            typeof customer !== "object" ||
            Array.isArray(customer) ||
            Object.keys(customer).some((key) => !["name", "phone", "email"].includes(key)) ||
            typeof customer.name !== "string" ||
            !customer.name.trim() ||
            customer.name.trim().length > 80 ||
            typeof customer.phone !== "string" ||
            !customer.phone.trim() ||
            customer.phone.trim().length > 32
        ) {
            throw badRequest("Customer name and phone are required.");
        }
        if (
            customer.email !== undefined &&
            (typeof customer.email !== "string" ||
                customer.email.length > 254 ||
                !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email))
        ) {
            throw badRequest("customer.email must be a valid email address.");
        }
        if (
            fulfillmentMethod === "delivery" &&
            (typeof deliveryAddress !== "string" || !deliveryAddress.trim() || deliveryAddress.trim().length > 300)
        ) {
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
        const { lineItems, pricing } = calculateOrderPricing(items, fulfillmentMethod, tipPercent, {
            redeemFreeDrink
        });
        const trackingCode = crypto.randomBytes(24).toString("hex");
        const supabase = getAdminClient();
        // Which branch makes it, and is everything in the basket in stock there?
        const branch = await resolveOrderBranch(supabase, branchId);
        if (branch) assertAvailable(lineItems, await getSoldOut(supabase, branch.id), branch);
        // Server-side royalty decision (exact recipe match, no self-royalty). Saved on the
        // order items in the same transaction as the order, so it can never be counted twice.
        const royalties = await resolveRecipeRoyalties(supabase, items, request.user?.id || null);
        const itemsWithRoyalties = withPurchasePoints(
            lineItems.map((lineItem, index) => ({ ...lineItem, ...royalties[index] })),
            request.user?.id || null
        );
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
                ...(branch ? { branch_id: branch.id } : {}),
                pricing
            },
            item_data: itemsWithRoyalties
        });
        if (error && isInsufficientPointsError(error)) {
            const { available } = await getLoyaltyBalance(supabase, request.user.id);
            return response.status(409).json({
                error: `A free drink needs ${FREE_DRINK_POINTS} points; you have ${available}. Untick the reward to order.`
            });
        }
        if (error) throw error;

        // Signed-in customers get a receipt, built after the response (services/receiptQueue.js);
        // the order row starts as "pending" and the tracking page polls until it's "available".
        let receiptStatus = "unavailable";
        if (request.user) {
            receiptStatus = "pending";
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
                itemCount: lineItems.length,
                pricing,
                receiptStatus,
                createdAt: new Date().toISOString()
            }
        });
        if (request.user) enqueueReceipt(orderId);
    } catch (error) {
        next(error);
    }
}

async function trackOrder(request, response, next) {
    try {
        const supabase = getAdminClient();
        const { data: order, error } = await supabase
            .from("orders")
            .select(
                "tracking_code, status, fulfillment_method, receipt_status, delivery_reported_at, pickup_approved_at, created_at, updated_at"
            )
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
        if (order.status === "Cancelled") {
            return response.status(409).json({ error: "This order was cancelled." });
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
    return (
        ["42703", "PGRST204"].includes(error?.code) ||
        /column .* does not exist|could not find .* column/i.test(error?.message || "")
    );
}

// PostgREST can't embed branches(...) until the table exists.
function isMissingBranchesTable(error) {
    return error?.code === "PGRST200" || /relationship between 'orders' and 'branches'/i.test(error?.message || "");
}

function isMissingOrdersTable(error) {
    return (
        ["42P01", "PGRST205"].includes(error?.code) ||
        /relation ["']?(public\.)?orders["']? does not exist|could not find the table .*orders/i.test(
            error?.message || ""
        )
    );
}

const ADMIN_ORDER_BASE_COLUMNS =
    "id, tracking_code, status, fulfillment_method, customer, delivery_address, notes, pricing, created_at";
const ADMIN_ORDER_ITEM_COLUMNS = "order_items(id, name, classification, configuration, price_cents)";
const ADMIN_ORDER_APPROVAL_COLUMNS = "receipt_status, delivery_reported_at, delivery_approved_at, pickup_approved_at";
const ADMIN_ORDER_PAYMENT_COLUMNS = "payment_method, cash_collected_at";
// Newest schema first. Each fallback drops the columns a later migration added,
// so the dashboard keeps working (with less detail) if code ships before a migration.
// The first set adds the branch (20261112000000_branches_sold_out.sql); older schemas fall back.
const ADMIN_ORDER_BRANCH_COLUMNS = "branch_id, branch:branches(name)";
const ADMIN_ORDER_COLUMN_SETS = [
    [
        ADMIN_ORDER_BASE_COLUMNS,
        ADMIN_ORDER_APPROVAL_COLUMNS,
        ADMIN_ORDER_PAYMENT_COLUMNS,
        ADMIN_ORDER_BRANCH_COLUMNS,
        ADMIN_ORDER_ITEM_COLUMNS
    ],
    [ADMIN_ORDER_BASE_COLUMNS, ADMIN_ORDER_APPROVAL_COLUMNS, ADMIN_ORDER_PAYMENT_COLUMNS, ADMIN_ORDER_ITEM_COLUMNS],
    [ADMIN_ORDER_BASE_COLUMNS, ADMIN_ORDER_APPROVAL_COLUMNS, ADMIN_ORDER_ITEM_COLUMNS],
    [ADMIN_ORDER_BASE_COLUMNS, ADMIN_ORDER_ITEM_COLUMNS]
].map((columnGroups) => columnGroups.join(", "));

// PostgREST filters for the admin list views. "Active" keeps finished orders visible
// until their cash is collected, so a ready pickup still waiting for payment isn't lost.
// Cancelled orders are finished and never wait for cash.
const FINAL_STATUSES = ["Delivered", "Ready for Pickup", "Cancelled"];
const FINAL_STATUS_LIST = `(${FINAL_STATUSES.map((status) => `"${status}"`).join(",")})`;
const ADMIN_ORDER_VIEWS = {
    active: (query, hasPaymentColumns) =>
        hasPaymentColumns
            ? query.or(
                  `status.not.in.${FINAL_STATUS_LIST},and(payment_method.eq.cash,cash_collected_at.is.null,status.neq.Cancelled)`
              )
            : query.not("status", "in", FINAL_STATUS_LIST),
    done: (query, hasPaymentColumns) =>
        hasPaymentColumns
            ? query
                  .in("status", FINAL_STATUSES)
                  .or("payment_method.neq.cash,cash_collected_at.not.is.null,status.eq.Cancelled")
            : query.in("status", FINAL_STATUSES),
    all: (query) => query
};

function applyAdminOrderFilters(query, { view, search, branch }, hasPaymentColumns) {
    let filtered = ADMIN_ORDER_VIEWS[view](query, hasPaymentColumns);
    if (branch) filtered = filtered.eq("branch_id", branch);
    if (search) {
        // "CL-AB12CD" and "ab12cd" both match the tracking code; any other text matches the name.
        const code = search.replace(/^cl-?/i, "").toLowerCase();
        filtered = filtered.or(`tracking_code.ilike.*${code}*,customer->>name.ilike.*${search}*`);
    }
    return filtered;
}

async function countAdminOrders(supabase, view, search, hasPaymentColumns, branch) {
    const query = supabase.from("orders").select("id", { count: "exact", head: true });
    const { count, error } = await applyAdminOrderFilters(query, { view, search, branch }, hasPaymentColumns);
    return error ? null : count || 0;
}

async function listAdminOrders(request, response, next) {
    try {
        const pageSize = 50;
        const page = Number(request.query.page) || 1;
        const view = request.query.view || "all";
        const search = request.query.q || "";
        const requestedBranch = request.query.branch || null;
        let branch = requestedBranch;
        const supabase = getAdminClient();
        let data;
        let error;
        let count;
        let schemaWarning = null;
        for (const [setIndex, columns] of ADMIN_ORDER_COLUMN_SETS.entries()) {
            const hasPaymentColumns = setIndex <= 1;
            // Without the branch column (older schema) the branch filter can't apply.
            branch = setIndex === 0 ? requestedBranch : null;
            ({ data, error, count } = await applyAdminOrderFilters(
                supabase.from("orders").select(columns, { count: "exact" }),
                { view, search, branch },
                hasPaymentColumns
            )
                // Newest first in every view (the age badge still flags orders that have waited long).
                .order("created_at", { ascending: false })
                .range((page - 1) * pageSize, page * pageSize - 1));
            const isLastFallback = setIndex === ADMIN_ORDER_COLUMN_SETS.length - 1;
            if (!error || !(hasMissingOptionalOrderColumns(error) || isMissingBranchesTable(error)) || isLastFallback)
                break;
            console.warn("Admin orders query is falling back to an older schema; apply the latest migrations.");
            // Only the branch is missing: everything else still works, so no warning banner.
            if (setIndex === 0) continue;
            schemaWarning =
                "Some order details (receipts, approvals, or cash collection) are unavailable until the latest Supabase migrations are applied.";
        }
        if (error && isMissingOrdersTable(error)) {
            return response.status(503).json({
                error: "The Coffee Lab orders table is missing from this Supabase project. Apply the base coffee_lab migration before loading admin orders."
            });
        }
        if (error) throw error;
        // Tab counts (head-only count queries; no rows are transferred).
        const hasPaymentColumns = !schemaWarning;
        const [activeCount, doneCount, allCount] = await Promise.all(
            ["active", "done", "all"].map((countView) =>
                countView === view
                    ? count || 0
                    : countAdminOrders(supabase, countView, search, hasPaymentColumns, branch)
            )
        );
        response.json({
            page,
            pageSize,
            view,
            totalCount: count || 0,
            counts: { active: activeCount, done: doneCount, all: allCount },
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
                receiptStatus: order.receipt_status || "unavailable",
                deliveryReportedAt: order.delivery_reported_at,
                deliveryApprovedAt: order.delivery_approved_at,
                pickupApprovedAt: order.pickup_approved_at,
                paymentMethod: order.payment_method || DEFAULT_PAYMENT_METHOD,
                // Omitted (undefined) when the cash migration isn't applied, so the dashboard hides the button.
                cashCollectedAt: "cash_collected_at" in order ? order.cash_collected_at : undefined,
                branchName: order.branch?.name || null,
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
        if (!canApproveFulfillment("delivery", order.status) || order.delivery_approved_at) {
            return response.status(409).json({ error: "This order is already approved as delivered." });
        }
        const approvedAt = new Date().toISOString();
        const { data, error } = await supabase
            .from("orders")
            .update({
                status: getApprovalStatus("delivery"),
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
        await recordOrderEvent(supabase, { orderId: data.id, actorId: request.user.id, action: ORDER_EVENT.CLOSED });
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
        if (!canApproveFulfillment("pickup", order.status) || order.pickup_approved_at) {
            return response.status(409).json({ error: "This order is already approved as ready for pickup." });
        }
        const approvedAt = new Date().toISOString();
        const { data, error } = await supabase
            .from("orders")
            .update({
                status: getApprovalStatus("pickup"),
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
        await recordOrderEvent(supabase, { orderId: data.id, actorId: request.user.id, action: ORDER_EVENT.CLOSED });
        response.json({ order: { id: data.id, status: data.status, pickupApprovedAt: data.pickup_approved_at } });
    } catch (error) {
        next(error);
    }
}

// Records that the customer paid cash. Idempotent and race-safe: the update only
// matches while cash_collected_at is still null, so two admins clicking at once
// produce one record and one 409, never a double entry.
async function markCashCollected(request, response, next) {
    try {
        const supabase = getAdminClient();
        const { data: order, error: readError } = await supabase
            .from("orders")
            .select("id, status, payment_method, cash_collected_at")
            .eq("id", request.params.orderId)
            .maybeSingle();
        if (readError) throw readError;
        if (!order) return response.status(404).json({ error: "Order not found." });
        if (order.status === "Cancelled") {
            return response.status(409).json({ error: "This order was cancelled, so there is no cash to collect." });
        }
        if (!canMarkCashCollected(order)) {
            return response.status(409).json({ error: "Cash has already been recorded as collected for this order." });
        }
        const collectedAt = new Date().toISOString();
        const { data, error } = await supabase
            .from("orders")
            .update({ cash_collected_at: collectedAt, cash_collected_by: request.user.id, updated_at: collectedAt })
            .eq("id", order.id)
            .is("cash_collected_at", null)
            .select("id, cash_collected_at")
            .maybeSingle();
        if (error) throw error;
        if (!data) return response.status(409).json({ error: "Order changed; refresh and try again." });
        await recordOrderEvent(supabase, {
            orderId: data.id,
            actorId: request.user.id,
            action: ORDER_EVENT.CASH_COLLECTED
        });
        response.json({ order: { id: data.id, cashCollectedAt: data.cash_collected_at } });
        // Reissue the receipt so the customer's copy says PAID (queued; retried on failure).
        enqueueReceipt(data.id);
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

// Cancels instead of deleting: the order keeps its record but leaves the sales totals.
// Race-safe: the update only matches while the status is still the one we checked.
async function cancelAdminOrder(request, response, next) {
    try {
        const supabase = getAdminClient();
        const { data: order, error: readError } = await supabase
            .from("orders")
            .select("id, status")
            .eq("id", request.params.orderId)
            .maybeSingle();
        if (readError) throw readError;
        if (!order) return response.status(404).json({ error: "Order not found." });
        if (!canCancel(order.status)) {
            return response.status(409).json({ error: `This order is already ${order.status.toLowerCase()}.` });
        }
        const { data, error } = await supabase
            .from("orders")
            .update({ status: "Cancelled", updated_at: new Date().toISOString() })
            .eq("id", order.id)
            .eq("status", order.status)
            .select("id, status")
            .maybeSingle();
        if (error) throw error;
        if (!data) return response.status(409).json({ error: "Order changed; refresh and try again." });
        await recordOrderEvent(supabase, { orderId: data.id, actorId: request.user.id, action: ORDER_EVENT.CANCELLED });
        response.json({ order: data });
    } catch (error) {
        next(error);
    }
}

// Superadmin only (see routes/orderRoutes.js): erases the order and its receipt for good.
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

        const { data, error } = await supabase.from("orders").delete().eq("id", order.id).select("id").maybeSingle();
        if (error) throw error;
        if (!data) return response.status(409).json({ error: "Order changed; refresh and try again." });
        response.json({ message: "Order deleted." });
    } catch (error) {
        next(error);
    }
}

async function advanceOrderStatus(request, response, next) {
    try {
        if (
            !request.body ||
            typeof request.body !== "object" ||
            Array.isArray(request.body) ||
            Object.keys(request.body).some((key) => key !== "status")
        ) {
            throw badRequest("Request must contain only the next status.");
        }
        const { status } = request.body;
        if (!isKnownStatus(status)) throw badRequest("Unsupported order status.");
        const supabase = getAdminClient();
        const { data: currentOrder, error: readError } = await supabase
            .from("orders")
            .select("id, status, tracking_code, fulfillment_method")
            .eq("id", request.params.orderId)
            .maybeSingle();
        if (readError) throw readError;
        if (!currentOrder) return response.status(404).json({ error: "Order not found." });
        // The state machine decides; e.g. pickup orders can't go "Out for Delivery",
        // and final (admin-approved) orders can't move at all.
        if (!canStaffAdvance(currentOrder.fulfillment_method, currentOrder.status, status)) {
            return response.status(409).json({ error: "Order status can only advance one stage at a time." });
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
        await recordOrderEvent(supabase, {
            orderId: data.id,
            actorId: request.user.id,
            action: EVENT_FOR_STATUS[status]
        });
        response.json({ order: { id: data.id, trackingCode: data.tracking_code, status: data.status } });
    } catch (error) {
        next(error);
    }
}

async function listMyOrders(request, response, next) {
    try {
        const { data, error } = await getAdminClient()
            .from("orders")
            .select(
                "id, tracking_code, status, fulfillment_method, pricing, receipt_status, created_at, updated_at, order_items(name, classification, price_cents, configuration)"
            )
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

// The signed-in customer's points, for the checkout reward checkbox.
async function myRewards(request, response, next) {
    try {
        response.set("Cache-Control", "no-store");
        response.json({ points: await getLoyaltyBalance(getAdminClient(), request.user.id) });
    } catch (error) {
        next(error);
    }
}

module.exports = {
    myRewards,
    createOrderQuote,
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
    cancelAdminOrder,
    deleteAdminOrder,
    downloadReceipt,
    retryReceipt,
    advanceOrderStatus,
    listMyOrders
};
