/**
 * Loyalty points and the free-drink reward.
 *
 * Earning (stored per drink at checkout, so a later rate change never rewrites history):
 *   - 10 points for each drink a signed-in customer buys (not for a drink that was itself free);
 *   - 10 points to a recipe's creator each time someone else orders it (communityRecipeService).
 * Points count once the order is paid (cash collected) and never for cancelled orders.
 *
 * Spending: 100 points make the most expensive drink in the basket free. The balance check and the
 * order are one database transaction (create_coffee_order), so two checkouts at once can't spend
 * the same points twice. Cancelling the order gives the points back automatically.
 */
const POINTS_PER_PURCHASED_DRINK = 10;
const FREE_DRINK_POINTS = 100;

function isMissingFunction(error) {
    return error?.code === "PGRST202" || error?.code === "42883";
}

/** { earned, pending, redeemed, available, freeDrinkPoints }; zeros if the migration isn't applied yet. */
async function getLoyaltyBalance(supabase, accountId) {
    const { data, error } = await supabase.rpc("loyalty_balance", { p_account_id: accountId }).maybeSingle();
    if (error && !isMissingFunction(error)) throw error;
    const earned = Number(data?.earned_points) || 0;
    const redeemed = Number(data?.redeemed_points) || 0;
    return {
        earned,
        pending: Number(data?.pending_points) || 0,
        redeemed,
        available: Math.max(0, earned - redeemed),
        freeDrinkPoints: FREE_DRINK_POINTS
    };
}

/** Purchase points for each line item; a free (redeemed) drink earns nothing. Guests earn nothing. */
function withPurchasePoints(lineItems, accountId) {
    return lineItems.map((item) => ({
        ...item,
        purchase_points: accountId && !item.redeemed_points ? POINTS_PER_PURCHASED_DRINK : 0
    }));
}

/** The database refuses a redemption without enough points; turn that into a clear 409. */
function isInsufficientPointsError(error) {
    return typeof error?.message === "string" && error.message.includes("loyalty:insufficient_points");
}

module.exports = {
    POINTS_PER_PURCHASED_DRINK,
    FREE_DRINK_POINTS,
    getLoyaltyBalance,
    withPurchasePoints,
    isInsufficientPointsError,
    isMissingFunction
};
