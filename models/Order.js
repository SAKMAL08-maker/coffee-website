const mongoose = require("mongoose");
const coffeeConfigurationSchema = require("./coffeeSchema");

const orderItemSchema = new mongoose.Schema({
    name: { type: String, trim: true, maxlength: 80, required: true },
    configuration: { type: coffeeConfigurationSchema, required: true },
    classification: { type: String, trim: true, maxlength: 40, required: true },
    nutrition: {
        caffeineMg: { type: Number, min: 0, required: true },
        calories: { type: Number, min: 0, required: true },
        sugarGrams: { type: Number, min: 0, required: true }
    },
    priceCents: { type: Number, min: 0, required: true }
}, { _id: true, strict: "throw" });

const orderSchema = new mongoose.Schema({
    trackingCode: { type: String, unique: true, index: true, required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    customer: {
        name: { type: String, trim: true, maxlength: 80, required: true },
        phone: { type: String, trim: true, maxlength: 32, required: true },
        email: { type: String, trim: true, lowercase: true, maxlength: 254 }
    },
    items: {
        type: [orderItemSchema],
        validate: {
            validator: (items) => items.length > 0 && items.length <= 20,
            message: "An order must contain between 1 and 20 drinks."
        }
    },
    fulfillmentMethod: { type: String, enum: ["delivery", "pickup"], required: true },
    deliveryAddress: {
        type: String,
        trim: true,
        maxlength: 300,
        required: function deliveryAddressRequired() {
            return this.fulfillmentMethod === "delivery";
        }
    },
    deliveryCoordinates: {
        latitude: { type: Number, min: -90, max: 90 },
        longitude: { type: Number, min: -180, max: 180 }
    },
    notes: { type: String, trim: true, maxlength: 500 },
    pricing: {
        subtotalCents: { type: Number, min: 0, required: true },
        deliveryFeeCents: { type: Number, min: 0, required: true },
        serviceFeeCents: { type: Number, min: 0, required: true },
        taxCents: { type: Number, min: 0, required: true },
        tipPercent: { type: Number, min: 0, max: 100, required: true },
        tipCents: { type: Number, min: 0, required: true },
        totalCents: { type: Number, min: 0, required: true }
    },
    status: {
        type: String,
        enum: ["Received", "Crafting", "Out for Delivery", "Arrived"],
        default: "Received",
        index: true
    }
}, { timestamps: true, strict: "throw" });

module.exports = mongoose.models.Order || mongoose.model("Order", orderSchema);
