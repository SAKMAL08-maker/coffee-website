// Display helpers only. Prices are calculated by the server (services/pricingService.js)
// and fetched through pricingApi.js, so the browser never keeps its own copy of the rules.
window.CoffeeLabPricing = (() => {
    const pesoFormatter = new Intl.NumberFormat("en-PH", {
        style: "currency",
        currency: "PHP",
        minimumFractionDigits: 2
    });

    function money(amount) {
        return pesoFormatter.format(amount);
    }

    // Server amounts are integer centavos; divide only at the moment of display.
    function moneyFromCents(amountCents) {
        return money(amountCents / 100);
    }

    function getEstimatedEta(state, itemCount = Math.max(1, state.cartItems.length)) {
        if (state.fulfillmentMethod === "pickup")
            return `Ready for pickup in ${7 + Math.max(0, itemCount - 2) * 2} mins`;
        const extra = Math.max(0, itemCount - 2) * 5;
        return `Arriving in ${15 + extra}–${25 + extra} mins`;
    }

    return { money, moneyFromCents, getEstimatedEta };
})();
