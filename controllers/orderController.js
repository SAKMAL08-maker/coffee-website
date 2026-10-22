const crypto = require("crypto");
const Order = require("../models/Order");
const {
    normalizeConfiguration,
    classifyDrink,
    calculateNutrition
} = require("../services/coffeeService");

const SERVICE_FEE_BASIS_POINTS = 800;
const TAX_BASIS_POINTS = 825;
const DELIVERY_FEE_CENTS = 249;
const ORDER_STATUSES = ["Received", "Crafting", "Out for Delivery", "Arrived"];

function badRequest(message) {
    return Object.assign(new Error(message), { statusCode: 400 });
}

function roundBasisPoints(amountCents, basisPoints) {
    return Math.round(amountCents * basisPoints / 10000);
}

function calculateDrinkPriceCents(configuration) {
    const baseCents = 450 + Math.max(0, Math.ceil((configuration.volumeMl - 240) / 120)) * 50;
    const extraShotCents = Math.max(0, configuration.shots - 2) * 100;
    const milkModifierCents = configuration.milk === "oat" ? 70 : configuration.milk === "almond" ? 50 : 0;
    const syrupModifierCents = Object.values(configuration.syrups).reduce((total, pumps) => total + pumps * 50, 0);
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
        const allowedKeys = ["name", "configuration"];
        if (Object.keys(item).some((key) => !allowedKeys.includes(key))) {
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
            priceCents: calculateDrinkPriceCents(configuration)
        };
    });

    const subtotalCents = lineItems.reduce((total, item) => total + item.priceCents, 0);
    const deliveryFeeCents = fulfillmentMethod === "delivery" ? DELIVERY_FEE_CENTS : 0;
    const serviceFeeCents = roundBasisPoints(subtotalCents, SERVICE_FEE_BASIS_POINTS);
    const taxCents = roundBasisPoints(subtotalCents, TAX_BASIS_POINTS);
    const tipCents = Math.round(subtotalCents * tipPercent / 100);

    return {
        lineItems,
        pricing: {
            subtotalCents,
            deliveryFeeCents,
            serviceFeeCents,
            taxCents,
            tipPercent,
            tipCents,
            totalCents: subtotalCents + deliveryFeeCents + serviceFeeCents + taxCents + tipCents
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
        if (!request.body || typeof request.body !== "object" || Array.isArray(request.body)
            || Object.keys(request.body).some((key) => ![
                "items", "fulfillmentMethod", "deliveryAddress", "deliveryCoordinates",
                "tipPercent", "customer", "notes"
            ].includes(key))) {
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
        if (customer.email !== undefined && (typeof customer.email !== "string" || customer.email.length > 254)) {
            throw badRequest("customer.email must be a valid email address.");
        }
        if (customer.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email)) {
            throw badRequest("customer.email must be a valid email address.");
        }
        if (fulfillmentMethod === "delivery" && (typeof deliveryAddress !== "string" || !deliveryAddress.trim() || deliveryAddress.trim().length > 300)) {
            throw badRequest("A delivery address of 300 characters or fewer is required for delivery.");
        }
        if (notes !== undefined && (typeof notes !== "string" || notes.length > 500)) {
            throw badRequest("notes must be 500 characters or fewer.");
        }

        const coordinates = validateCoordinates(deliveryCoordinates);
        const { lineItems, pricing } = calculateOrderPricing(items, fulfillmentMethod, tipPercent);
        const order = await Order.create({
            trackingCode: crypto.randomBytes(16).toString("hex"),
            userId: request.user?.id,
            customer: {
                name: customer.name.trim(),
                phone: customer.phone.trim(),
                ...(customer.email ? { email: customer.email.trim().toLowerCase() } : {})
            },
            items: lineItems,
            fulfillmentMethod,
            ...(fulfillmentMethod === "delivery" ? { deliveryAddress: deliveryAddress.trim() } : {}),
            ...(coordinates ? { deliveryCoordinates: coordinates } : {}),
            ...(notes ? { notes: notes.trim() } : {}),
            pricing
        });

        response.status(201).json({
            order: {
                id: order.id,
                trackingCode: order.trackingCode,
                status: order.status,
                fulfillmentMethod: order.fulfillmentMethod,
                itemCount: order.items.length,
                pricing: order.pricing,
                createdAt: order.createdAt
            }
        });
    } catch (error) {
        next(error);
    }
}

async function trackOrder(request, response, next) {
    try {
        const order = await Order.findOne({ trackingCode: request.params.trackingCode })
            .select("trackingCode status fulfillmentMethod items.name createdAt updatedAt");
        if (!order) return response.status(404).json({ error: "Order not found." });
        response.json({ order });
    } catch (error) {
        next(error);
    }
}

async function advanceOrderStatus(request, response, next) {
    try {
        const status = request.body?.status;
        const nextStatus = ORDER_STATUSES[ORDER_STATUSES.indexOf(status)];
        if (!nextStatus) return response.status(400).json({ error: "Unsupported order status." });

        const order = await Order.findById(request.params.orderId);
        if (!order) return response.status(404).json({ error: "Order not found." });
        const currentIndex = ORDER_STATUSES.indexOf(order.status);
        if (ORDER_STATUSES.indexOf(nextStatus) !== currentIndex + 1) {
            return response.status(409).json({ error: "Order status can only advance one stage at a time." });
        }

        order.status = nextStatus;
        await order.save();
        response.json({ order: { id: order.id, trackingCode: order.trackingCode, status: order.status } });
    } catch (error) {
        next(error);
    }
}

async function listMyOrders(request, response, next) {
    try {
        const orders = await Order.find({ userId: request.user.id })
            .select("trackingCode status fulfillmentMethod items.name pricing createdAt updatedAt")
            .sort({ createdAt: -1 })
            .limit(50);
        response.json({ orders });
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
