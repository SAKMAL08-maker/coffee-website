const mongoose = require("mongoose");
const coffeeConfigurationSchema = require("./coffeeSchema");

const nutritionSchema = new mongoose.Schema({
    caffeineMg: { type: Number, min: 0, required: true },
    calories: { type: Number, min: 0, required: true },
    sugarGrams: { type: Number, min: 0, required: true }
}, { _id: false });

const coffeeSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    name: { type: String, trim: true, maxlength: 80, default: "Custom Coffee" },
    configuration: { type: coffeeConfigurationSchema, required: true },
    classification: { type: String, trim: true, maxlength: 40, required: true },
    nutrition: { type: nutritionSchema, required: true }
}, { timestamps: true, strict: "throw" });

module.exports = mongoose.models.Coffee || mongoose.model("Coffee", coffeeSchema);
