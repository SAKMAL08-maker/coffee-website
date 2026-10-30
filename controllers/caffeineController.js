const { getAdminClient } = require("../config/supabase");
const { checkDrinkForCustomer, saveCutoffTime } = require("../services/caffeineGuardianService");

// Today's ordered caffeine + basket + this drink, and a half-caf suggestion when needed.
async function checkDrink(request, response, next) {
    try {
        const result = await checkDrinkForCustomer(getAdminClient(), request.user.id, request.body);
        response.set("Cache-Control", "no-store");
        response.json(result);
    } catch (error) {
        next(error);
    }
}

// cutoffTime "HH:MM" sets the customer's "no caffeine after" time; null clears it.
async function updateSettings(request, response, next) {
    try {
        const cutoffTime = await saveCutoffTime(getAdminClient(), request.user.id, request.body.cutoffTime);
        response.json({ cutoffTime });
    } catch (error) {
        next(error);
    }
}

module.exports = { checkDrink, updateSettings };
