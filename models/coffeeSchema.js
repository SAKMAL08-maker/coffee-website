const mongoose = require("mongoose");

const coffeeConfigurationSchema = new mongoose.Schema({
    base: {
        type: String,
        enum: ["espresso", "drip", "coldBrew", "matcha"],
        default: "espresso"
    },
    caffeineMode: {
        type: String,
        enum: ["regular", "decaf", "half"],
        default: "regular"
    },
    volumeMl: { type: Number, min: 60, max: 480, default: 240 },
    shots: { type: Number, min: 1, max: 4, default: 2 },
    extraction: {
        type: String,
        enum: ["ristretto", "standard", "lungo"],
        default: "standard"
    },
    temperature: {
        type: String,
        enum: ["hot", "iced", "blended"],
        default: "hot"
    },
    iceStyle: {
        type: String,
        enum: ["cube", "coffee", "crushed"],
        default: "cube"
    },
    milk: {
        type: String,
        enum: ["whole", "skim", "oat", "almond"],
        default: "whole"
    },
    foam: { type: Number, min: 0, max: 100, default: 25 },
    syrups: {
        vanilla: { type: Number, min: 0, max: 6, default: 0 },
        caramel: { type: Number, min: 0, max: 6, default: 0 },
        chocolate: { type: Number, min: 0, max: 6, default: 0 }
    },
    sweeteners: {
        type: [{
            type: String,
            enum: ["whiteSugar", "rawSugar", "honey", "stevia"]
        }],
        default: []
    },
    toppings: {
        cinnamon: { type: Boolean, default: false },
        whippedCream: { type: Boolean, default: false },
        cocoa: { type: Boolean, default: false }
    }
}, { _id: false, strict: "throw" });

module.exports = coffeeConfigurationSchema;
