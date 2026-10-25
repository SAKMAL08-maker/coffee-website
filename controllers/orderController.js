const crypto = require("crypto");
const { getAdminClient } = require("../config/supabase");
const {
    normalizeConfiguration,
    classifyDrink,
    calculateNutrition
} = require("../services/coffeeService");

const SERVICE_FEE_BASIS_POINTS = 800;
const TAX_BASIS_POINTS = 1200;
const DELIVERY_FEE_CENTS = 4900;
const ORDER_STATUSES = ["Received", "Crafting", "Out for Delivery", "Arrived"];

function badRequest(message) {
    return Object.assign(new Error(message), { statusCode: 400 });
}

function roundBasisPoints(amountCents, basisPoints) {
    return Math.round(amountCents * basisPoints / 10000);
}

function calculateDrinkPriceCents(configuration) {
    const baseCents = 25000 + Math.max(0, Math.ceil((configuration.volumeMl - 240) / 120)) * 2800;
    const extraShotCents = Math.max(0, configuration.shots - 2) * 5500;
    const milkModifierCents = configuration.milk === "oat" ? 3900 : configuration.milk === "almond" ? 2800 : 0;
    const syrupModifierCents = Object.values(configuration.syrups).reduce((total, pumps) => total + pumps * 2500, 0);
    return baseCents + extraShotCents + milkModifierCents + syrupModifierCents;
}

function calculateOrderPricing(items, fulfillmentMethod, tipPercent = 15) {
    if (!Array.isArray(items) || items.length < 1 || items.length > 20) {
        throw badRequest("An order must contain between 1 and 20 drinks.");
    }
    if (!["delivery", "pickup"].includes(fulfillmentMethod)) {
        throw badRequest("fulfillmentMethod must be delivery or pickup.");
    }
    if (typeof tipPercent !== "number" || !Number.isFinite(tipPercent) || tipPercent < 0 || tipPercent > 100) {
        throw badRequest("tipPercent must be a number from 0 to 100.");
    }

    const lineItems = items.map((item, index) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
            throw badRequest(`items[${index}] must be an object.`);
        }
        if (Object.keys(item).some((key) => !["name", "configuration"].includes(key))) {
            throw badRequest(`items[${index}] contains an unsupported field.`);
        }
        const configuration = normalizeConfiguration(item.configuration);
        const name = typeof item.name === "string" && item.name.trim()
            ? item.name.trim().slice(0, 80)
            : classifyDrink(configuration);
        return {
            name,
            configuration,
            classification: classifyDrink(configuration),
            nutrition: calculateNutrition(configuration),
            price_cents: calculateDrinkPriceCents(configuration)
        };
    });

    const subtotalCents = lineItems.reduce((total, item) => total + item.price_cents, 0);
    const deliveryFeeCents = fulfillmentMethod === "delivery" ? DELIVERY_FEE_CENTS : 0;
    const serviceFeeCents = roundBasisPoints(subtotalCents, SERVICE_FEE_BASIS_POINTS);
    const taxCents = roundBasisPoints(subtotalCents, TAX_BASIS_POINTS);
    const tipCents = Math.round(subtotalCents * tipPercent / 100);

    return {
        lineItems,
        pricing: {
            subtotal_cents: subtotalCents,
            delivery_fee_cents: deliveryFeeCents,
            service_fee_cents: serviceFeeCents,
            tax_cents: taxCents,
            tip_percent: tipPercent,
            tip_cents: tipCents,
            total_cents: subtotalCents + deliveryFeeCents + serviceFeeCents + taxCents + tipCents
        }
    };
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
                pricing
            },
            item_data: lineItems
        });
        if (error) throw error;

        response.status(201).json({
            order: {
                id: orderId,
                trackingCode,
                status: "Received",
                fulfillmentMethod,
                itemCount: lineItems.length,
                pricing,
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
            .select("tracking_code, status, fulfillment_method, created_at, updated_at")
            .eq("tracking_code", request.params.trackingCode)
            .maybeSingle();
        if (error) throw error;
        if (!order) return response.status(404).json({ error: "Order not found." });

        response.json({
            order: {
                trackingCode: order.tracking_code,
                status: order.status,
                fulfillmentMethod: order.fulfillment_method,
                createdAt: order.created_at,
                updatedAt: order.updated_at
            }
        });
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
        const statusIndex = ORDER_STATUSES.indexOf(status);
        if (statusIndex < 0) throw badRequest("Unsupported order status.");
        const supabase = getAdminClient();
        const { data: currentOrder, error: readError } = await supabase
            .from("orders")
            .select("id, status, tracking_code")
            .eq("id", request.params.orderId)
            .maybeSingle();
        if (readError) throw readError;
        if (!currentOrder) return response.status(404).json({ error: "Order not found." });
        if (statusIndex !== ORDER_STATUSES.indexOf(currentOrder.status) + 1) {
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
        response.json({ order: { id: data.id, trackingCode: data.tracking_code, status: data.status } });
    } catch (error) {
        next(error);
    }
}

async function listMyOrders(request, response, next) {
    try {
        const { data, error } = await getAdminClient()
            .from("orders")
            .select("id, tracking_code, status, fulfillment_method, pricing, created_at, updated_at")
            .eq("account_id", request.user.id)
            .order("created_at", { ascending: false })
            .limit(50);
        if (error) throw error;
        response.json({
            orders: data.map((order) => ({
                ...order,
                trackingCode: order.tracking_code,
                fulfillmentMethod: order.fulfillment_method
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
    advanceOrderStatus,
    listMyOrders
};
