const mongoose = require("mongoose");
const coffeeConfigurationSchema = require("./coffeeSchema");

const savedRecipeSchema = new mongoose.Schema({
    name: { type: String, trim: true, required: true, maxlength: 48 },
    configuration: { type: coffeeConfigurationSchema, required: true },
    savedAt: { type: Date, default: Date.now }
}, { _id: true, strict: "throw" });

const userSchema = new mongoose.Schema({
    name: { type: String, trim: true, required: true, maxlength: 80 },
    email: {
        type: String,
        trim: true,
        lowercase: true,
        required: true,
        unique: true,
        maxlength: 254,
        match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ["customer", "staff"], default: "customer" },
    sessionVersion: { type: Number, default: 0, select: false },
    savedBar: { type: [savedRecipeSchema], default: [] }
}, { timestamps: true, strict: "throw" });

module.exports = mongoose.models.User || mongoose.model("User", userSchema);
