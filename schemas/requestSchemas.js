const { z } = require("zod");

const emptyQuery = z.object({}).strict();
const emptyParams = z.object({}).strict();
const emptyBody = z.object({}).strict().optional();
const uuid = z.string().uuid();

const configuration = z.object({
    base: z.enum(["espresso", "drip", "coldBrew", "matcha"]).optional(),
    caffeineMode: z.enum(["regular", "decaf", "half"]).optional(),
    volumeMl: z.number().int().min(60).max(480).optional(),
    shots: z.number().int().min(1).max(4).optional(),
    extraction: z.enum(["ristretto", "standard", "lungo"]).optional(),
    temperature: z.enum(["hot", "iced", "blended"]).optional(),
    iceStyle: z.enum(["cube", "coffee", "crushed"]).optional(),
    milk: z.enum(["whole", "skim", "oat", "almond"]).optional(),
    foam: z.number().int().min(0).max(100).optional(),
    syrups: z.object({
        vanilla: z.number().int().min(0).max(6).optional(),
        caramel: z.number().int().min(0).max(6).optional(),
        chocolate: z.number().int().min(0).max(6).optional()
    }).strict().optional(),
    sweeteners: z.array(z.enum(["whiteSugar", "rawSugar", "honey", "stevia"]))
        .max(4).refine((values) => new Set(values).size === values.length).optional(),
    toppings: z.object({
        cinnamon: z.boolean().optional(),
        whippedCream: z.boolean().optional(),
        cocoa: z.boolean().optional()
    }).strict().optional()
}).strict();

const password = z.string().min(12).max(128);
const username = z.string().trim().min(3).max(24).regex(/^[a-zA-Z0-9_]+$/);

const signupBody = z.object({
    username,
    password
}).strict();

const loginBody = z.object({
    username,
    password: z.string().min(1).max(128),
    staySignedIn: z.boolean().default(false)
}).strict();

const adminMfaVerifyBody = z.object({
    factorId: uuid,
    code: z.string().regex(/^\d{6}$/)
}).strict();

const adminMfaEnrollBody = z.object({
    bootstrapToken: z.string().min(32).max(256)
}).strict();

const recoveryBody = z.object({
    username,
    recoveryCode: z.string().trim().min(20).max(32)
}).strict();

const resetPasswordBody = recoveryBody.extend({
    password
}).strict();

const namedConfigurationBody = z.object({
    name: z.string().trim().min(1).max(48),
    configuration
}).strict();

const quoteBody = z.object({ configuration }).strict();

const orderItem = z.object({
    name: z.string().trim().min(1).max(80).optional(),
    configuration
}).strict();

const coordinates = z.object({
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180)
}).strict();

const checkoutBody = z.object({
    items: z.array(orderItem).min(1).max(20),
    fulfillmentMethod: z.enum(["delivery", "pickup"]),
    deliveryAddress: z.string().trim().min(1).max(300).optional(),
    deliveryCoordinates: coordinates.optional(),
    tipPercent: z.number().finite().min(0).max(100).default(15),
    customer: z.object({
        name: z.string().trim().min(1).max(80),
        phone: z.string().trim().min(1).max(32),
        email: z.string().trim().email().max(254).optional()
    }).strict(),
    notes: z.string().max(500).optional()
}).strict().superRefine((value, context) => {
    if (value.fulfillmentMethod === "delivery" && !value.deliveryAddress) {
        context.addIssue({ code: "custom", path: ["deliveryAddress"], message: "Required for delivery." });
    }
    if (value.fulfillmentMethod === "pickup" && (value.deliveryAddress || value.deliveryCoordinates)) {
        context.addIssue({ code: "custom", path: ["fulfillmentMethod"], message: "Pickup cannot include delivery details." });
    }
});

const schemas = {
    emptyQuery,
    emptyParams,
    signup: { body: signupBody, query: emptyQuery, params: emptyParams },
    login: { body: loginBody, query: emptyQuery, params: emptyParams },
    adminMfaVerify: {
        body: adminMfaVerifyBody,
        params: emptyParams,
        query: emptyQuery
    },
    adminMfaEnroll: {
        body: adminMfaEnrollBody,
        params: emptyParams,
        query: emptyQuery
    },
    recovery: { body: recoveryBody, query: emptyQuery, params: emptyParams },
    resetPassword: { body: resetPasswordBody, query: emptyQuery, params: emptyParams },
    logout: { body: emptyBody, query: emptyQuery, params: emptyParams },
    savedRecipe: { body: namedConfigurationBody, query: emptyQuery, params: emptyParams },
    quote: { body: quoteBody, query: emptyQuery, params: emptyParams },
    checkout: { body: checkoutBody, query: emptyQuery, params: emptyParams },
    tracking: {
        params: z.object({ trackingCode: z.string().regex(/^[a-f0-9]{48}$/) }).strict(),
        query: emptyQuery
    },
    recipeId: {
        params: z.object({ recipeId: uuid }).strict(),
        query: emptyQuery
    },
    orderId: {
        params: z.object({ orderId: uuid }).strict(),
        query: emptyQuery
    },
    receiptRetry: {
        body: emptyBody,
        params: z.object({ orderId: uuid }).strict(),
        query: emptyQuery
    },
    deliveryReport: {
        body: emptyBody,
        params: z.object({ orderId: uuid }).strict(),
        query: emptyQuery
    },
    adminOrders: {
        params: emptyParams,
        query: z.object({ page: z.coerce.number().int().min(1).max(100000).default(1) }).strict()
    },
    status: {
        body: z.object({ status: z.enum(["Received", "Crafting", "Out for Delivery", "Arrived"]) }).strict(),
        params: z.object({ orderId: uuid }).strict(),
        query: emptyQuery
    },
    empty: { query: emptyQuery, params: emptyParams }
};

module.exports = schemas;
