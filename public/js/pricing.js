window.CoffeeLabPricing = (() => {
    function money(amount) {
        return new Intl.NumberFormat("en-PH", {
            style: "currency",
            currency: "PHP",
            minimumFractionDigits: 2
        }).format(amount);
    }

    function roundMoney(amount) {
        return Math.round((amount + Number.EPSILON) * 100) / 100;
    }

    function getDrinkPrice(state) {
        let basePrice = 250;
        basePrice += Math.max(0, Math.ceil((state.volumeMl - 240) / 120)) * 28;
        const modifiers = Math.max(0, state.shots - 2) * 55
            + (state.milk === "oat" ? 39 : state.milk === "almond" ? 28 : 0)
            + Object.values(state.syrups).reduce((sum, pumps) => sum + pumps * 25, 0);
        basePrice = roundMoney(basePrice);
        const roundedModifiers = roundMoney(modifiers);
        return { basePrice, modifiers: roundedModifiers, subtotal: roundMoney(basePrice + roundedModifiers) };
    }

    function getPricing(state, subtotal) {
        const delivery = subtotal > 0 && state.fulfillmentMethod === "delivery" ? 49 : 0;
        const service = roundMoney(subtotal * 0.08);
        const tax = roundMoney(subtotal * 0.12);
        const tipRate = state.tipPercent === "custom" ? state.customTipPercent : state.tipPercent;
        const tip = roundMoney(subtotal * tipRate / 100);
        return { delivery, service, tax, tip, total: roundMoney(subtotal + delivery + service + tax + tip), tipRate };
    }

    function getCartSubtotal(state) {
        return state.cartItems.reduce((sum, item) => sum + item.price, 0);
    }

    function getEstimatedEta(state, itemCount = Math.max(1, state.cartItems.length)) {
        if (state.fulfillmentMethod === "pickup") return `Ready for pickup in ${7 + Math.max(0, itemCount - 2) * 2} mins`;
        const extra = Math.max(0, itemCount - 2) * 5;
        return `Arriving in ${15 + extra}–${25 + extra} mins`;
    }

    return { money, getDrinkPrice, getPricing, getCartSubtotal, getEstimatedEta };
})();
