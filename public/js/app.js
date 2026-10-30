(() => {
    const { BASES, MILKS, SYRUPS, SWEETENERS, CLASSICS, state } = window.CoffeeLabState;
    let editingCartItemId = null;
    let drawerReturnFocus = null;
    let trackingPollTimer = null;
    let activePreview = "creation";
    let historyReturnView = "customizer";
    const $ = (selector) => document.querySelector(selector);
    const $$ = (selector) => [...document.querySelectorAll(selector)];
    const elements = {
        volume: $("#volume-range"),
        shots: $("#shot-range"),
        foam: $("#foam-range"),
        liquid: $("#liquid"),
        classification: $("#drink-classification"),
        legend: $("#ingredient-legend"),
        notice: $("#app-notice")
    };

    function round(value, places = 0) {
        const factor = 10 ** places;
        return Math.round(value * factor) / factor;
    }

    const { money, moneyFromCents, getEstimatedEta } = window.CoffeeLabPricing;
    const { createQuoteScheduler } = window.CoffeeLabQuotes;
    const PRICE_PLACEHOLDER = "—";
    // The last server quote for the cart; null while a new one is loading.
    let latestCartQuote = null;

    function displayVolume(ml) {
        return state.metric ? `${Math.round(ml)} ml` : `${round(ml / 29.5735, 1)} oz`;
    }

    function getComposition() {
        const shotMl = { ristretto: 22, standard: 30, lungo: 40 }[state.extraction] || 30;
        const baseMl = state.base === "espresso" ? state.shots * shotMl : 0;
        const syrupMl = Object.entries(state.syrups).reduce((sum, [key, count]) => sum + count * SYRUPS[key].ml, 0);
        const milkTotal =
            state.base === "espresso"
                ? Math.max(0, state.volumeMl - baseMl - syrupMl)
                : state.base === "matcha"
                  ? Math.max(0, state.volumeMl - syrupMl) * 0.3
                  : 0;
        const foamMl = milkTotal * (state.foam / 100) * 0.6;
        const milkMl = milkTotal - foamMl;
        const otherBaseMl = state.base === "espresso" ? 0 : Math.max(0, state.volumeMl - syrupMl - milkTotal);
        return { baseMl, milkMl, foamMl, syrupMl, otherBaseMl };
    }

    function getDrinkName(composition) {
        const hasExtras =
            Object.values(state.syrups).some(Boolean) ||
            state.sweeteners.length ||
            Object.values(state.toppings).some(Boolean);
        if (state.base === "drip" && state.temperature === "hot" && !hasExtras) return "Americano";
        if (state.base !== "espresso") return "Custom Concoction";
        if (state.temperature !== "hot" || hasExtras) return "Custom Concoction";
        const { baseMl, milkMl, foamMl } = composition;
        if (baseMl <= 0) return "Custom Concoction";
        const ratio = (milkMl + foamMl) / baseMl;
        const foamRatio = foamMl / (milkMl + foamMl || 1);
        if (ratio < 0.65 && foamRatio > 0.45) return "Macchiato";
        if (ratio >= 0.8 && ratio <= 1.2 && foamRatio < 0.3) return "Cortado";
        if (ratio >= 1.4 && ratio <= 2.6 && foamRatio >= 0.38) return "Cappuccino";
        if (ratio >= 1.4 && ratio <= 2.6 && foamRatio < 0.38) return "Flat White";
        if (ratio > 2.6 && foamRatio < 0.48) return "Latte";
        if (ratio < 0.2) return "Espresso";
        return "Custom Concoction";
    }

    function getMetrics(composition) {
        const base = BASES[state.base];
        const caffeineFactor = state.caffeineMode === "decaf" ? 0.05 : state.caffeineMode === "half" ? 0.5 : 1;
        const caffeine =
            state.base === "espresso" ? base.caffeine * state.shots : (base.caffeine * state.volumeMl) / 240;
        const milk = MILKS[state.milk];
        let calories = base.calories + (composition.milkMl * milk.calories) / 100;
        let sugar = (composition.milkMl * milk.sugar) / 100;
        Object.entries(state.syrups).forEach(([key, count]) => {
            calories += SYRUPS[key].calories * count;
            sugar += SYRUPS[key].sugar * count;
        });
        state.sweeteners.forEach((key) => {
            calories += SWEETENERS[key].calories;
            sugar += SWEETENERS[key].sugar;
        });
        if (state.toppings.whippedCream) {
            calories += 50;
            sugar += 3;
        }
        return {
            caffeine: Math.round(caffeine * caffeineFactor),
            calories: Math.round(calories),
            sugar: round(sugar, 1)
        };
    }

    function renderLayers(composition) {
        const liquidHeight = Math.min(100, (state.volumeMl / 480) * 100);
        elements.liquid.style.height = `${liquidHeight}%`;
        const total = Math.max(state.volumeMl, 1);
        const layers = [
            ["#espresso-layer", composition.baseMl],
            ["#drip-layer", state.base === "drip" ? composition.otherBaseMl : 0],
            ["#matcha-layer", state.base === "matcha" ? composition.otherBaseMl : 0],
            ["#milk-layer", composition.milkMl],
            ["#syrup-layer", composition.syrupMl],
            ["#foam-layer", composition.foamMl]
        ];
        layers.forEach(([selector, volume]) => {
            const layer = $(selector);
            layer.style.height = `${(volume / total) * 100}%`;
        });
        $("#ice-layer").hidden = state.temperature === "hot";
        $("#cup-capacity").textContent = displayVolume(state.volumeMl);
        $("#cup").setAttribute("aria-label", `${getDrinkName(composition)}, ${displayVolume(state.volumeMl)} drink`);
        $("#temperature-caption").textContent =
            state.temperature === "hot"
                ? `Served warm · approximately ${state.metric ? "65°C" : "149°F"}`
                : state.temperature === "iced"
                  ? `Served chilled · ${state.iceStyle.replace(/^./, (letter) => letter.toUpperCase())} ice`
                  : "Blended smooth with ice";
        $("#drink-summary").textContent =
            `${BASES[state.base].label} · ${displayVolume(state.volumeMl)} · ${state.temperature}`;
    }

    function renderLegend(composition) {
        const rows = [];
        const add = (label, amount, color) => {
            if (amount > 0.4)
                rows.push(
                    `<tr><td><span class="legend-color" style="--swatch:${color}"></span>${label}</td><td>${displayVolume(amount)}</td></tr>`
                );
        };
        if (state.base === "espresso") add(`${state.extraction} espresso`, composition.baseMl, "#3b2314");
        else add(BASES[state.base].label, composition.otherBaseMl, state.base === "matcha" ? "#819263" : "#70472e");
        add(`${MILKS[state.milk].label} · steamed`, composition.milkMl, "#f1e6d5");
        add("Milk foam", composition.foamMl, "#fff");
        Object.entries(state.syrups).forEach(([key, count]) => {
            if (count)
                add(
                    `${SYRUPS[key].label} · ${count} pump${count === 1 ? "" : "s"}`,
                    count * SYRUPS[key].ml,
                    key === "chocolate" ? "#2b1a10" : "#c68a4c"
                );
        });
        state.sweeteners.forEach((key) =>
            rows.push(
                `<tr><td><span class="legend-color" style="--swatch:#d9b872"></span>${SWEETENERS[key].label}</td><td>1 serving</td></tr>`
            )
        );
        if (state.toppings.whippedCream)
            rows.push(
                `<tr><td><span class="legend-color" style="--swatch:#fff"></span>Whipped cream</td><td>1 swirl</td></tr>`
            );
        elements.legend.innerHTML = rows.length
            ? rows.join("")
            : "<tr><td>Choose ingredients to begin</td><td>—</td></tr>";
    }

    function getSelectedTipPercent() {
        return state.tipPercent === "custom" ? state.customTipPercent : state.tipPercent;
    }

    // Item names don't affect price, so they're left out; identical carts then share a cached quote.
    function buildQuoteRequest(configurations) {
        return {
            items: configurations.map((configuration) => ({ configuration })),
            fulfillmentMethod: state.fulfillmentMethod,
            tipPercent: getSelectedTipPercent()
        };
    }

    function notifyQuoteFailure() {
        setNotice("Prices couldn't be updated right now. Your order total is still calculated at checkout.");
    }

    // Live price panel for the drink being customized. Previous numbers stay on
    // screen until the new quote arrives, so values change without flickering.
    function renderDrinkQuote(quote) {
        const drink = quote?.items[0];
        const showCents = (cents) => (quote ? moneyFromCents(cents) : PRICE_PLACEHOLDER);
        $("#drink-price").textContent = drink ? moneyFromCents(drink.basePriceCents) : PRICE_PLACEHOLDER;
        $("#modifier-price").textContent = drink ? moneyFromCents(drink.modifiersCents) : PRICE_PLACEHOLDER;
        $("#delivery-fee").textContent = showCents(quote?.pricing.deliveryFeeCents);
        $("#service-fee").textContent = showCents(quote?.pricing.serviceFeeCents);
        $("#tax-fee").textContent = showCents(quote?.pricing.taxCents);
        $("#tip-fee").textContent = showCents(quote?.pricing.tipCents);
        $("#order-total").textContent = showCents(quote?.pricing.totalCents);
    }

    function renderCartQuote(quote) {
        latestCartQuote = quote;
        const emptyCartTotal = state.cartItems.length ? PRICE_PLACEHOLDER : money(0);
        const totalText = quote ? moneyFromCents(quote.pricing.totalCents) : emptyCartTotal;
        $("#cart-total").textContent = totalText;
        $("#fab-total").textContent = totalText;
        $$(".cart-item-price").forEach((priceElement, index) => {
            const item = quote?.items[index];
            priceElement.textContent = item ? moneyFromCents(item.priceCents) : PRICE_PLACEHOLDER;
        });
        renderCheckoutSummaryText();
    }

    const scheduleDrinkQuote = createQuoteScheduler(renderDrinkQuote, () => {
        renderDrinkQuote(null);
        notifyQuoteFailure();
    });
    const scheduleCartQuote = createQuoteScheduler(renderCartQuote, () => {
        renderCartQuote(null);
        notifyQuoteFailure();
    });

    function render() {
        const composition = getComposition();
        const metrics = getMetrics(composition);
        renderLayers(composition);
        renderLegend(composition);
        elements.classification.textContent = getDrinkName(composition);
        $("#caffeine-value").textContent = `${metrics.caffeine} mg`;
        if (isCaffeineGuardianActive) caffeineChecker.schedule(getDrinkConfiguration());
        $("#calories-value").textContent = `${metrics.calories} kcal`;
        $("#sugar-value").textContent = `${metrics.sugar} g`;
        $("#volume-readout").textContent = displayVolume(state.volumeMl);
        $("#shot-readout").textContent = `${state.shots} shot${state.shots === 1 ? "" : "s"}`;
        $("#foam-readout").textContent = `${state.foam}%`;
        Object.entries(state.syrups).forEach(([key, count]) => {
            $(`#${key}-count`).textContent = `${count} pump${count === 1 ? "" : "s"}`;
        });
        $$(".segment, .option-card").forEach((button) => {
            const group = button.closest("[data-choice-group]");
            if (group)
                button.setAttribute("aria-pressed", String(state[group.dataset.choiceGroup] === button.dataset.value));
        });
        $$(".chip").forEach((button) =>
            button.setAttribute("aria-pressed", String(state.sweeteners.includes(button.dataset.value)))
        );
        $$(".topping-switch").forEach((button) =>
            button.setAttribute("aria-checked", String(state.toppings[button.dataset.topping]))
        );
        $("#extraction-field").hidden = state.base !== "espresso";
        $("#ice-field").hidden = state.temperature === "hot";
        $("#unit-toggle").setAttribute("aria-checked", String(state.metric));
        $("#unit-label").textContent = state.metric ? "Metric" : "Imperial";
        $("#theme-toggle").setAttribute("aria-pressed", String(state.darkMode));
        $("#theme-toggle").setAttribute("aria-label", state.darkMode ? "Enable light mode" : "Enable dark mode");
        $("#theme-icon").textContent = state.darkMode ? "☀" : "☾";
        $("#theme-label").textContent = state.darkMode ? "Light" : "Dark";
        document.querySelector('meta[name="theme-color"]').content = state.darkMode ? "#171512" : "#f7f3ed";
        $("#delivery-option").setAttribute("aria-pressed", String(state.fulfillmentMethod === "delivery"));
        $("#pickup-option").setAttribute("aria-pressed", String(state.fulfillmentMethod === "pickup"));
        $("#delivery-address-wrap").hidden = state.fulfillmentMethod !== "delivery";
        $("#delivery-address").value = state.deliveryAddress;
        $("#eta-text").textContent = getEstimatedEta(state);
        $("#delivery-fee-label").textContent = state.fulfillmentMethod === "delivery" ? "Delivery fee" : "Pickup";
        $("#tip-percent").textContent = round(getSelectedTipPercent(), 0);
        scheduleDrinkQuote(buildQuoteRequest([getDrinkConfiguration()]));
        $("#custom-tip-input").hidden = state.tipPercent !== "custom";
        $("#custom-tip-input").value = state.customTipPercent;
        $$(".tip-button").forEach((button) =>
            button.setAttribute("aria-pressed", String(String(state.tipPercent) === button.dataset.tip))
        );
        $("#add-to-cart-button").textContent = editingCartItemId ? "↻ Update order item" : "＋ Add to order basket";
        renderCart();
        elements.volume.value = state.volumeMl;
        elements.shots.value = state.shots;
        elements.foam.value = state.foam;
    }

    function setNotice(message) {
        elements.notice.textContent = message;
        window.clearTimeout(setNotice.timer);
        setNotice.timer = window.setTimeout(() => {
            elements.notice.textContent = "";
        }, 4500);
    }

    function showPreview(view, moveFocus = false) {
        activePreview = view;
        $("#creation-view").hidden = view !== "creation";
        $("#summary-view").hidden = view !== "summary";
        if (moveFocus) {
            $(`#${view}-view-toggle`).focus();
        }
    }

    function renderCart() {
        const container = $("#cart-items");
        container.replaceChildren();
        const count = state.cartItems.length;
        $("#cart-count").textContent = count;
        $("#drawer-count").textContent = `(${count})`;
        $("#checkout-fab").hidden = count === 0;
        $("#checkout-button").disabled = count === 0;
        // Forget the old quote: the cart may have changed. A cached quote refills it instantly below.
        latestCartQuote = null;

        if (!count) {
            const empty = document.createElement("p");
            empty.className = "field-help";
            empty.textContent = "Your basket is empty. Add a custom drink to get started.";
            container.appendChild(empty);
            scheduleCartQuote(null);
            return;
        }

        state.cartItems.forEach((item) => {
            const row = document.createElement("article");
            row.className = "cart-item";
            const details = document.createElement("div");
            const title = document.createElement("h3");
            title.textContent = item.name;
            const description = document.createElement("p");
            description.textContent = `${BASES[item.state.base].label} · ${displayVolume(item.state.volumeMl)} · ${MILKS[item.state.milk].label}`;
            details.append(title, description);
            const price = document.createElement("strong");
            price.className = "cart-item-price";
            price.textContent = PRICE_PLACEHOLDER;
            const actions = document.createElement("div");
            actions.className = "cart-item-actions";
            const edit = document.createElement("button");
            edit.className = "recipe-link";
            edit.type = "button";
            edit.textContent = "Edit";
            edit.addEventListener("click", () => {
                editingCartItemId = item.id;
                applyRecipe(item.state);
                closeCart(false);
                setTab("tab-foundation", true);
                setNotice("Edit this drink and update it in your basket when ready.");
            });
            const remove = document.createElement("button");
            remove.className = "delete-recipe";
            remove.type = "button";
            remove.textContent = "Remove";
            remove.addEventListener("click", () => {
                state.cartItems = state.cartItems.filter((cartItem) => cartItem.id !== item.id);
                if (editingCartItemId === item.id) editingCartItemId = null;
                render();
                setNotice(`${item.name} removed from your basket.`);
            });
            actions.append(edit, remove);
            row.append(details, price, actions);
            container.appendChild(row);
        });
        // Runs after the rows exist so the quote can fill each .cart-item-price in order.
        scheduleCartQuote(buildQuoteRequest(state.cartItems.map((item) => item.state)));
    }

    function getDrinkConfiguration() {
        return {
            base: state.base,
            caffeineMode: state.caffeineMode,
            volumeMl: state.volumeMl,
            shots: state.shots,
            extraction: state.extraction,
            temperature: state.temperature,
            iceStyle: state.iceStyle,
            milk: state.milk,
            foam: state.foam,
            syrups: { ...state.syrups },
            sweeteners: [...state.sweeteners],
            toppings: { ...state.toppings }
        };
    }

    function addCurrentDrinkToCart() {
        const composition = getComposition();
        const name =
            getDrinkName(composition) === "Custom Concoction"
                ? `Custom ${BASES[state.base].label} drink`
                : getDrinkName(composition);
        const metrics = getMetrics(composition);
        const existingIndex = state.cartItems.findIndex((item) => item.id === editingCartItemId);
        // Which shared recipe this drink came from (kept when editing). The server pays a
        // royalty only if the final drink still exactly matches the published recipe.
        const recipeSlug = activeSharedRecipe?.slug || state.cartItems[existingIndex]?.recipeSlug;
        const item = {
            id: editingCartItemId || (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`),
            name: activeSharedRecipe?.name || name,
            state: getDrinkConfiguration(),
            metrics,
            ...(recipeSlug ? { recipeSlug } : {})
        };
        if (existingIndex >= 0) state.cartItems[existingIndex] = item;
        else state.cartItems.push(item);
        editingCartItemId = null;
        clearSharedRecipe();
        resetEditor();
        setNotice(existingIndex >= 0 ? `${name} updated in your basket.` : `${name} added to your basket.`);
    }

    function resetEditor() {
        Object.assign(state, {
            base: "espresso",
            caffeineMode: "regular",
            volumeMl: 240,
            shots: 2,
            extraction: "standard",
            temperature: "hot",
            iceStyle: "cube",
            milk: "whole",
            foam: 25,
            syrups: { vanilla: 0, caramel: 0, chocolate: 0 },
            sweeteners: [],
            toppings: { cinnamon: false, whippedCream: false, cocoa: false }
        });
        editingCartItemId = null;
        $("#classics-select").value = "";
        render();
        setTab("tab-foundation");
    }

    function openCart() {
        drawerReturnFocus = document.activeElement;
        const drawer = $("#cart-drawer");
        drawer.setAttribute("open", "");
        drawer.setAttribute("aria-hidden", "false");
        $("#drawer-backdrop").hidden = false;
        requestAnimationFrame(() => $("#drawer-backdrop").classList.add("visible"));
        $("#close-cart-button").focus();
    }

    function closeCart(restoreFocus = true) {
        const drawer = $("#cart-drawer");
        drawer.removeAttribute("open");
        drawer.setAttribute("aria-hidden", "true");
        $("#drawer-backdrop").classList.remove("visible");
        window.setTimeout(() => {
            $("#drawer-backdrop").hidden = true;
        }, 280);
        if (restoreFocus && drawerReturnFocus && typeof drawerReturnFocus.focus === "function")
            drawerReturnFocus.focus();
    }

    // Text only, so a quote arriving while the dialog is open never touches the form fields.
    function renderCheckoutSummaryText() {
        const count = state.cartItems.length;
        const pricesText = latestCartQuote
            ? `${moneyFromCents(latestCartQuote.pricing.subtotalCents)} drinks subtotal · total ${moneyFromCents(latestCartQuote.pricing.totalCents)}`
            : "calculating total…";
        $("#checkout-summary").textContent =
            `${count} drink${count === 1 ? "" : "s"} · ${pricesText} · ${getEstimatedEta(state, count)}`;
        // Wording comes from the server (services/paymentService.js) so it matches the receipt.
        $("#checkout-payment-note").textContent = latestCartQuote?.paymentInstruction || "";
    }

    function updateCheckoutSummary() {
        renderCheckoutSummaryText();
        const delivery = state.fulfillmentMethod === "delivery";
        $("#checkout-address-field").hidden = !delivery;
        $("#checkout-address").required = delivery;
        $("#checkout-address").value = state.deliveryAddress;
    }

    function openCheckout() {
        if (!state.cartItems.length) return;
        updateCheckoutSummary();
        closeCart();
        $("#checkout-dialog").showModal();
    }

    function isFulfillmentComplete(order) {
        return order.fulfillmentMethod === "pickup"
            ? order.status === "Ready for Pickup"
            : order.status === "Delivered";
    }

    function setCustomerView(view) {
        window.clearInterval(trackingPollTimer);
        $("#customizer-page").hidden = view !== "customizer";
        $("#order-history-page").hidden = view !== "history";
        $("#tracking-page").hidden = true;
        $("#customizer-nav-button").classList.toggle("is-active", view === "customizer");
        $("#order-history-nav-button").classList.toggle("is-active", view === "history");
        if (view === "history") {
            $("#order-history-nav-button").setAttribute("aria-current", "page");
            $("#customizer-nav-button").removeAttribute("aria-current");
            loadOrderHistory();
            $("#order-history-title").focus();
        } else {
            $("#customizer-nav-button").setAttribute("aria-current", "page");
            $("#order-history-nav-button").removeAttribute("aria-current");
            $("#page-title").focus();
        }
    }

    function getHistoryFulfillmentStatus(order) {
        if (order.fulfillmentMethod === "pickup") {
            return order.status === "Ready for Pickup"
                ? { label: "Ready for pickup", complete: true }
                : { label: "Pickup not yet ready", complete: false };
        }
        return order.status === "Delivered"
            ? { label: "Delivered", complete: true }
            : { label: "Not yet delivered", complete: false };
    }

    function renderOrderHistory(orders) {
        const list = $("#order-history-list");
        list.replaceChildren();
        if (!orders.length) {
            const empty = document.createElement("p");
            empty.className = "order-history-empty";
            empty.textContent =
                "You have no past orders yet. Your orders will appear here after you place them while signed in.";
            list.append(empty);
            return;
        }

        orders.forEach((order) => {
            const card = document.createElement("article");
            card.className = "order-history-card";
            const heading = document.createElement("div");
            heading.className = "order-history-card-heading";
            const title = document.createElement("h2");
            title.textContent = `Order CL-${order.trackingCode.slice(-6).toUpperCase()}`;
            const fulfillmentStatus = getHistoryFulfillmentStatus(order);
            const status = document.createElement("span");
            status.className = `order-history-status${fulfillmentStatus.complete ? " is-complete" : ""}`;
            status.textContent = fulfillmentStatus.label;
            heading.append(title, status);

            const placed = new Date(order.created_at);
            const summary = document.createElement("p");
            summary.textContent = `${order.fulfillmentMethod === "pickup" ? "Pickup" : "Delivery"} · ${
                Number.isNaN(placed.getTime()) ? "Date unavailable" : placed.toLocaleString()
            } · ${money((Number(order.pricing?.total_cents) || 0) / 100)}`;
            const items = document.createElement("ul");
            items.className = "order-history-items";
            (order.items || []).forEach((item) => {
                const row = document.createElement("li");
                const classification = item.classification ? ` · ${item.classification}` : "";
                row.textContent = `${item.name}${classification} — ${money((Number(item.price_cents) || 0) / 100)}`;
                items.append(row);
            });
            const detailsButton = document.createElement("button");
            detailsButton.type = "button";
            detailsButton.className = "button button-small";
            detailsButton.dataset.historyOrderId = order.id;
            detailsButton.dataset.trackingCode = order.trackingCode;
            detailsButton.dataset.orderStatus = order.status;
            detailsButton.dataset.fulfillmentMethod = order.fulfillmentMethod;
            detailsButton.dataset.receiptStatus = order.receiptStatus;
            detailsButton.textContent =
                order.receiptStatus === "available" ? "View status and receipt" : "View order status";
            card.append(heading, summary, items, detailsButton);
            list.append(card);
        });
    }

    async function loadOrderHistory() {
        const message = $("#order-history-message");
        const refreshButton = $("#refresh-order-history-button");
        refreshButton.disabled = true;
        message.textContent = "Loading your orders…";
        try {
            const response = await fetch("/api/orders/mine", { credentials: "same-origin" });
            let result;
            try {
                result = await response.json();
            } catch {
                throw new Error(`The server returned an unreadable response (${response.status}).`);
            }
            if (!response.ok) {
                if (response.status === 401)
                    throw new Error("Your session expired. Sign in again to view order history.");
                throw new Error(result.error || `Could not load orders (${response.status}).`);
            }
            if (!Array.isArray(result.orders)) throw new Error("The server returned an invalid order history.");
            renderOrderHistory(result.orders);
            message.textContent = result.orders.length
                ? `${result.orders.length} recent order${result.orders.length === 1 ? "" : "s"} shown.`
                : "";
        } catch (error) {
            message.textContent = `Could not load order history: ${error.message}`;
        } finally {
            refreshButton.disabled = false;
        }
    }

    function renderTracking() {
        const order = state.orderStatus;
        if (!order) return;
        $("#tracking-order-number").textContent = order.number;
        const isComplete = isFulfillmentComplete(order);
        const isDelivery = order.fulfillmentMethod === "delivery";
        const completionLabel = isDelivery ? "Delivered" : "Ready for pickup";
        $("#tracking-eyebrow").textContent = isDelivery ? "Your coffee is on its way" : "Pickup order";
        $("#tracking-eta").textContent = isComplete
            ? isDelivery
                ? "Your delivery has been verified by Coffee Lab."
                : "Your order is ready for pickup."
            : isDelivery
              ? "We’ll update this page once delivery is verified."
              : "We’ll update this page once your order is ready for pickup.";
        $("#fulfillment-progress-card").setAttribute(
            "aria-label",
            isDelivery ? "Delivery confirmation" : "Pickup confirmation"
        );
        $("#fulfillment-progress").classList.toggle("is-complete", isComplete);
        $("#fulfillment-progress-icon").textContent = isComplete ? "✓" : "•";
        $("#fulfillment-progress-label").textContent = isComplete
            ? completionLabel
            : isDelivery
              ? "Not yet delivered"
              : "Not yet ready for pickup";
        $("#report-delivered-button").hidden = !isDelivery || isComplete || order.deliveryReported;
        $("#report-delivered-button").disabled = Boolean(order.deliveryReportPending);
        $("#tracking-status-message").textContent = isComplete
            ? isDelivery
                ? "Your delivery was approved by an administrator."
                : "An administrator verified that your order is ready for pickup."
            : order.deliveryReportError
              ? `Could not report delivery: ${order.deliveryReportError}`
              : order.deliveryReported
                ? "Thanks for letting us know. Your delivery report is waiting for administrator verification."
                : isDelivery
                  ? "The green checkmark appears after an administrator verifies your delivery."
                  : "The green checkmark appears after an administrator verifies that your order is ready for pickup.";
        const receiptStatus = order.receiptStatus || "unavailable";
        const receiptMessages = {
            pending: "Your digital receipt is ready to generate.",
            available: "Your receipt image is ready to view, and the PDF is ready to download.",
            failed: "We could not prepare your receipt. You can try again.",
            unavailable: "This receipt has not been saved yet. You can try generating it again."
        };
        $("#receipt-message").textContent = receiptMessages[receiptStatus] || receiptMessages.failed;
        $("#download-receipt-button").hidden = receiptStatus !== "available";
        $("#retry-receipt-button").hidden = !["pending", "failed", "unavailable"].includes(receiptStatus);
        $("#retry-receipt-button").textContent = receiptStatus === "pending" ? "Generate receipt" : "Try receipt again";
        const receiptPreview = $("#receipt-preview-image");
        if (receiptStatus === "available" && order.id) {
            const previewUrl = `/api/orders/${encodeURIComponent(order.id)}/receipt/preview`;
            if (receiptPreview.getAttribute("src") !== previewUrl) receiptPreview.src = previewUrl;
            receiptPreview.hidden = false;
        } else {
            receiptPreview.hidden = true;
            receiptPreview.removeAttribute("src");
        }
        $("#refresh-order-button").hidden = isComplete;
        $("#tracking-order-number").setAttribute("title", `Tracking code: ${order.trackingCode}`);
    }

    function showTracking() {
        $("#customizer-page").hidden = true;
        $("#order-history-page").hidden = true;
        $("#tracking-page").hidden = false;
        $("#back-to-customizer-button").textContent =
            historyReturnView === "history" ? "Back to order history" : "Back to coffee lab";
        renderTracking();
        $("#tracking-title").focus();
        window.clearInterval(trackingPollTimer);
        if (state.orderStatus && !isFulfillmentComplete(state.orderStatus)) {
            refreshTrackingStatus();
            trackingPollTimer = window.setInterval(refreshTrackingStatus, 20000);
        }
    }

    $("#customizer-nav-button").addEventListener("click", () => setCustomerView("customizer"));
    $("#order-history-nav-button").addEventListener("click", () => setCustomerView("history"));
    $("#refresh-order-history-button").addEventListener("click", loadOrderHistory);
    $("#order-history-list").addEventListener("click", (event) => {
        const button = event.target.closest("[data-history-order-id]");
        if (!button) return;
        historyReturnView = "history";
        state.orderStatus = {
            id: button.dataset.historyOrderId,
            trackingCode: button.dataset.trackingCode,
            number: `CL-${button.dataset.trackingCode.slice(-6).toUpperCase()}`,
            status: button.dataset.orderStatus,
            fulfillmentMethod: button.dataset.fulfillmentMethod,
            receiptStatus: button.dataset.receiptStatus,
            deliveryReported: false
        };
        showTracking();
    });

    async function refreshTrackingStatus() {
        if (!state.orderStatus?.trackingCode) return;
        try {
            const response = await fetch(`/api/orders/track/${encodeURIComponent(state.orderStatus.trackingCode)}`);
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || `Tracking request failed (${response.status}).`);
            if (
                !["Received", "Crafting", "Out for Delivery", "Arrived", "Delivered", "Ready for Pickup"].includes(
                    result.order.status
                )
            ) {
                throw new Error("The server returned an unknown order status.");
            }
            state.orderStatus.status = result.order.status;
            state.orderStatus.receiptStatus = result.order.receiptStatus || state.orderStatus.receiptStatus;
            state.orderStatus.deliveryReported = Boolean(result.order.deliveryReported);
            renderTracking();
            if (isFulfillmentComplete(state.orderStatus)) window.clearInterval(trackingPollTimer);
        } catch (error) {
            $("#tracking-status-message").textContent = `Could not refresh order status: ${error.message}`;
        }
    }

    // ---- Caffeine guardian (network calls in caffeineGuardian.js; decisions on the server) ----
    let isCaffeineGuardianActive = false;
    const caffeineChecker = window.CoffeeLabCaffeine.createCaffeineChecker(renderCaffeineGuardian, () => {
        // Not signed in as a customer, or the check failed: hide rather than show stale numbers.
        $("#caffeine-guardian").hidden = true;
    });

    function describeCaffeineReasons(result) {
        const reasons = [];
        if (result.reasons.includes("over-daily-limit")) {
            reasons.push(`this drink takes you to ${result.projectedMg} mg today (guide: ${result.dailyLimitMg} mg)`);
        }
        if (result.reasons.includes("past-cutoff")) reasons.push(`it is past your ${result.cutoffTime} cutoff`);
        return reasons.join(", and ");
    }

    function renderCaffeineGuardian(result) {
        $("#caffeine-guardian").hidden = false;
        $("#caffeine-today").textContent =
            `Today: ${result.todayMg} mg ordered · this drink ${result.drinkMg} mg · daily guide ${result.dailyLimitMg} mg`;
        const cutoffInput = $("#caffeine-cutoff-input");
        if (document.activeElement !== cutoffInput) cutoffInput.value = result.cutoffTime || "";

        const warning = $("#caffeine-warning");
        warning.hidden = !result.reasons.length;
        if (!result.reasons.length) return;
        const reasonText = describeCaffeineReasons(result);
        const halfCafButton = $("#half-caf-button");
        if (result.suggestion) {
            $("#caffeine-warning-text").textContent = `Heads up: ${reasonText}.`;
            halfCafButton.textContent = `Make it half-caf (${result.suggestion.drinkMg} mg, saves ${result.suggestion.savesMg} mg)`;
            halfCafButton.hidden = false;
        } else {
            $("#caffeine-warning-text").textContent = `Heads up: ${reasonText}. Decaf keeps it to a trace.`;
            halfCafButton.hidden = true;
        }
    }

    function applyHalfCaf() {
        state.caffeineMode = "half";
        render();
        setNotice("Switched to half-caf.");
    }

    async function saveCaffeineCutoff() {
        try {
            const cutoffTime = await window.CoffeeLabCaffeine.saveCutoffTime($("#caffeine-cutoff-input").value || null);
            setNotice(cutoffTime ? `Caffeine cutoff set to ${cutoffTime}.` : "Caffeine cutoff cleared.");
            caffeineChecker.checkNow(getDrinkConfiguration());
        } catch (error) {
            setNotice(error.message);
        }
    }

    // ---- Community recipes (network calls in communityRecipes.js) ----
    let activeSharedRecipe = null;

    function clearSharedRecipe() {
        activeSharedRecipe = null;
        $("#shared-recipe-banner").hidden = true;
        window.CoffeeLabRecipes.clearSharedRecipeSlug();
    }

    async function loadSharedRecipeFromLink() {
        const slug = window.CoffeeLabRecipes.readSharedRecipeSlug();
        if (!slug) return;
        try {
            const recipe = await window.CoffeeLabRecipes.fetchSharedRecipe(slug);
            activeSharedRecipe = recipe;
            applyRecipe({ ...recipe.configuration });
            $("#shared-recipe-title").textContent = `Shared recipe: ${recipe.name}`;
            $("#shared-recipe-creator").textContent = recipe.creatorUsername ? `by ${recipe.creatorUsername}` : "";
            $("#shared-recipe-banner").hidden = false;
        } catch {
            window.CoffeeLabRecipes.clearSharedRecipeSlug();
            setNotice("That shared recipe link is no longer available.");
        }
    }

    // Built with textContent (never innerHTML): recipe names are user-written.
    function renderMyPublishedRecipes(recipes) {
        const list = $("#my-published-recipes");
        list.replaceChildren(
            ...recipes.map((recipe) => {
                const row = document.createElement("li");
                const link = document.createElement("a");
                link.href = recipe.shareUrl;
                link.target = "_blank";
                link.rel = "noopener noreferrer";
                link.textContent = recipe.name;
                const unpublishButton = document.createElement("button");
                unpublishButton.type = "button";
                unpublishButton.className = "button";
                unpublishButton.textContent = "Unpublish";
                unpublishButton.addEventListener("click", async () => {
                    unpublishButton.disabled = true;
                    try {
                        await window.CoffeeLabRecipes.unpublishRecipe(recipe.slug);
                        renderRoyaltySummary(await window.CoffeeLabRecipes.fetchMyRecipes());
                    } catch (error) {
                        $("#recipe-royalty-summary").textContent = `Could not unpublish: ${error.message}`;
                        unpublishButton.disabled = false;
                    }
                });
                row.append(link, " ", unpublishButton);
                return row;
            })
        );
    }

    function renderRoyaltySummary({ royalties, recipes }) {
        renderMyPublishedRecipes(recipes);
        $("#recipe-royalty-summary").textContent = recipes.length
            ? `${recipes.length} published recipe${recipes.length === 1 ? "" : "s"} · ${royalties.earnedPoints} points earned · ${royalties.pendingPoints} pending (awarded once the buyer pays) · ${royalties.pointsPerDrink} points per drink.`
            : `Earn ${royalties.pointsPerDrink} points every time someone else orders and pays for your recipe.`;
    }

    async function openPublishRecipeDialog() {
        $("#publish-recipe-name").value = getDrinkName(getComposition()).slice(0, 48);
        $("#published-recipe-result").hidden = true;
        $("#publish-recipe-submit").disabled = false;
        $("#recipe-royalty-summary").textContent = "";
        $("#my-published-recipes").replaceChildren();
        $("#publish-recipe-dialog").showModal();
        try {
            renderRoyaltySummary(await window.CoffeeLabRecipes.fetchMyRecipes());
        } catch {
            $("#recipe-royalty-summary").textContent = "Could not load your royalty points right now.";
        }
    }

    async function publishCurrentRecipe(event) {
        event.preventDefault();
        const submitButton = $("#publish-recipe-submit");
        submitButton.disabled = true;
        try {
            const recipe = await window.CoffeeLabRecipes.publishRecipe(
                $("#publish-recipe-name").value.trim(),
                getDrinkConfiguration()
            );
            $("#published-recipe-qr").src = recipe.qrCodeUrl;
            $("#published-recipe-link").href = recipe.shareUrl;
            $("#published-recipe-link").textContent = recipe.shareUrl;
            $("#published-recipe-result").hidden = false;
            setNotice(`"${recipe.name}" is published. Share the link or QR code.`);
            renderRoyaltySummary(await window.CoffeeLabRecipes.fetchMyRecipes());
        } catch (error) {
            $("#recipe-royalty-summary").textContent = `Could not publish: ${error.message}`;
            submitButton.disabled = false;
        }
    }

    function applyRecipe(recipe, selectedClassic = "") {
        const { name, ...configuration } = recipe;
        Object.assign(state, JSON.parse(JSON.stringify(configuration)));
        $("#classics-select").value = selectedClassic;
        render();
    }

    function setTab(tabId, focus = false) {
        $$(".tab").forEach((tab) => {
            const selected = tab.id === tabId;
            tab.setAttribute("aria-selected", String(selected));
            tab.tabIndex = selected ? 0 : -1;
            $(`#${tab.getAttribute("aria-controls")}`).hidden = !selected;
        });
        if (focus) $(`#${tabId}`).focus();
    }

    $$(".tab").forEach((tab, index, tabs) => {
        tab.addEventListener("click", () => setTab(tab.id));
        tab.addEventListener("keydown", (event) => {
            const nextIndex =
                event.key === "ArrowRight"
                    ? (index + 1) % tabs.length
                    : event.key === "ArrowLeft"
                      ? (index - 1 + tabs.length) % tabs.length
                      : event.key === "Home"
                        ? 0
                        : event.key === "End"
                          ? tabs.length - 1
                          : -1;
            if (nextIndex < 0) return;
            event.preventDefault();
            setTab(tabs[nextIndex].id, true);
        });
    });

    $$(".segment, .option-card").forEach((button) => {
        button.addEventListener("click", () => {
            const group = button.closest("[data-choice-group]");
            if (!group) return;
            state[group.dataset.choiceGroup] = button.dataset.value;
            $("#classics-select").value = "";
            render();
        });
    });

    $$(".chip").forEach((button) => {
        button.addEventListener("click", () => {
            const sweetener = button.dataset.value;
            state.sweeteners = state.sweeteners.includes(sweetener)
                ? state.sweeteners.filter((value) => value !== sweetener)
                : [...state.sweeteners, sweetener];
            $("#classics-select").value = "";
            render();
        });
    });

    $$(".topping-switch").forEach((button) => {
        button.addEventListener("click", () => {
            const topping = button.dataset.topping;
            state.toppings[topping] = !state.toppings[topping];
            $("#classics-select").value = "";
            render();
        });
    });

    [
        [elements.volume, "volumeMl"],
        [elements.shots, "shots"],
        [elements.foam, "foam"]
    ].forEach(([input, stateKey]) => {
        input.addEventListener("input", () => {
            state[stateKey] = Number(input.value);
            $("#classics-select").value = "";
            render();
        });
    });

    $$("[data-adjust]").forEach((button) => {
        button.addEventListener("click", () => {
            const input = button.dataset.adjust === "volume" ? elements.volume : elements.shots;
            input.value = String(Number(input.value) + Number(button.dataset.delta));
            input.dispatchEvent(new Event("input", { bubbles: true }));
        });
    });

    $$("[data-counter]").forEach((button) => {
        button.addEventListener("click", () => {
            const syrup = button.dataset.counter;
            state.syrups[syrup] = Math.max(0, Math.min(6, state.syrups[syrup] + Number(button.dataset.delta)));
            $("#classics-select").value = "";
            render();
        });
    });

    $("#unit-toggle").addEventListener("click", () => {
        state.metric = !state.metric;
        render();
    });
    $("#creation-view-toggle").addEventListener("click", () => {
        showPreview("summary", true);
    });
    $("#summary-view-toggle").addEventListener("click", () => {
        showPreview("creation", true);
    });
    $("#theme-toggle").addEventListener("click", () => {
        state.darkMode = !state.darkMode;
        document.documentElement.dataset.theme = state.darkMode ? "dark" : "light";
        try {
            localStorage.setItem("coffee-lab-theme", state.darkMode ? "dark" : "light");
        } catch (error) {
            setNotice(`Could not save your theme preference: ${error.message}`);
        }
        render();
    });
    $("#delivery-option").addEventListener("click", () => {
        state.fulfillmentMethod = "delivery";
        render();
    });
    $("#pickup-option").addEventListener("click", () => {
        state.fulfillmentMethod = "pickup";
        render();
    });
    $("#delivery-address").addEventListener("input", (event) => {
        state.deliveryAddress = event.target.value;
    });
    $("#locate-button").addEventListener("click", () => {
        if (!navigator.geolocation) {
            setNotice("Location access is not available in this browser.");
            return;
        }
        navigator.geolocation.getCurrentPosition(
            (position) => {
                const { latitude, longitude } = position.coords;
                state.deliveryAddress = `Pinned location: ${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
                $("#delivery-address").value = state.deliveryAddress;
                setNotice("Location pinned. Add a street address or delivery instructions if needed.");
            },
            (error) => {
                setNotice(`Could not get your location: ${error.message}`);
            },
            { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
        );
    });
    $$(".tip-button").forEach((button) =>
        button.addEventListener("click", () => {
            state.tipPercent = button.dataset.tip === "custom" ? "custom" : Number(button.dataset.tip);
            render();
            if (state.tipPercent === "custom") $("#custom-tip-input").focus();
        })
    );
    $("#custom-tip-input").addEventListener("input", (event) => {
        const amount = Number(event.target.value);
        state.customTipPercent = Number.isFinite(amount) ? Math.max(0, Math.min(100, amount)) : 0;
        render();
    });
    $("#add-to-cart-button").addEventListener("click", addCurrentDrinkToCart);
    $("#order-shared-recipe-button").addEventListener("click", () => {
        addCurrentDrinkToCart();
        openCart();
    });
    $("#publish-recipe-button").addEventListener("click", openPublishRecipeDialog);
    $("#half-caf-button").addEventListener("click", applyHalfCaf);
    $("#caffeine-cutoff-input").addEventListener("change", saveCaffeineCutoff);
    document.addEventListener("coffeelab:signed-in", (event) => {
        isCaffeineGuardianActive = event.detail.role !== "admin";
        $("#caffeine-guardian").hidden = true;
        if (isCaffeineGuardianActive) caffeineChecker.checkNow(getDrinkConfiguration());
    });
    $("#publish-recipe-form").addEventListener("submit", publishCurrentRecipe);
    $("#close-publish-recipe").addEventListener("click", () => $("#publish-recipe-dialog").close());
    $("#open-cart-button").addEventListener("click", openCart);
    $("#close-cart-button").addEventListener("click", closeCart);
    $("#drawer-backdrop").addEventListener("click", closeCart);
    $("#checkout-button").addEventListener("click", openCheckout);
    $("#checkout-fab").addEventListener("click", openCheckout);
    $("#cancel-checkout").addEventListener("click", () => $("#checkout-dialog").close());
    $("#checkout-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!state.cartItems.length) return;
        if (state.fulfillmentMethod === "delivery") {
            const address = $("#checkout-address");
            state.deliveryAddress = address.value.trim();
            if (!state.deliveryAddress) {
                address.setCustomValidity("Enter a delivery address.");
                address.reportValidity();
                return;
            }
            address.setCustomValidity("");
        }
        const submitButton = $("#checkout-form button[type='submit']");
        submitButton.disabled = true;
        submitButton.textContent = "Placing order…";
        try {
            const response = await fetch("/api/orders/checkout", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    items: state.cartItems.map((item) => ({
                        name: item.name,
                        configuration: item.state,
                        ...(item.recipeSlug ? { recipeSlug: item.recipeSlug } : {})
                    })),
                    fulfillmentMethod: state.fulfillmentMethod,
                    ...(state.fulfillmentMethod === "delivery" ? { deliveryAddress: state.deliveryAddress } : {}),
                    tipPercent: state.tipPercent === "custom" ? state.customTipPercent : state.tipPercent,
                    customer: {
                        name: $("#customer-name").value.trim(),
                        phone: $("#customer-phone").value.trim()
                    }
                })
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || `Order request failed (${response.status}).`);
            if (!result.order?.trackingCode) throw new Error("The server did not return an order tracking code.");
            state.orderStatus = {
                number: `CL-${result.order.trackingCode.slice(-6).toUpperCase()}`,
                trackingCode: result.order.trackingCode,
                id: result.order.id,
                status: result.order.status,
                fulfillmentMethod: result.order.fulfillmentMethod,
                deliveryAddress: state.deliveryAddress,
                itemCount: result.order.itemCount,
                receiptStatus: result.order.receiptStatus || "unavailable",
                deliveryReported: false
            };
            historyReturnView = "customizer";
            state.cartItems = [];
            editingCartItemId = null;
            $("#checkout-dialog").close();
            render();
            showTracking();
        } catch (error) {
            setNotice(`Could not place your order: ${error.message}`);
        } finally {
            submitButton.disabled = false;
            submitButton.textContent = "Place order";
        }
    });
    $("#refresh-order-button").addEventListener("click", refreshTrackingStatus);
    $("#report-delivered-button").addEventListener("click", async (event) => {
        if (!state.orderStatus?.id || state.orderStatus.deliveryReported) return;
        const button = event.currentTarget;
        button.disabled = true;
        state.orderStatus.deliveryReportPending = true;
        $("#tracking-status-message").textContent = "Sending your delivery report…";
        try {
            const response = await fetch(`/api/orders/${encodeURIComponent(state.orderStatus.id)}/delivery-report`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "same-origin",
                body: "{}"
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || `Delivery report failed (${response.status}).`);
            state.orderStatus.deliveryReported = result.deliveryReported;
            state.orderStatus.deliveryReportError = "";
        } catch (error) {
            state.orderStatus.deliveryReportError = error.message;
        } finally {
            state.orderStatus.deliveryReportPending = false;
            renderTracking();
        }
    });
    $("#download-receipt-button").addEventListener("click", () => {
        if (!state.orderStatus?.id) return;
        window.location.assign(`/api/orders/${encodeURIComponent(state.orderStatus.id)}/receipt`);
    });
    $("#retry-receipt-button").addEventListener("click", async (event) => {
        if (!state.orderStatus?.id) return;
        const button = event.currentTarget;
        button.disabled = true;
        button.textContent = "Retrying…";
        try {
            const response = await fetch(`/api/orders/${encodeURIComponent(state.orderStatus.id)}/receipt/retry`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: "{}"
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || `Receipt request failed (${response.status}).`);
            state.orderStatus.receiptStatus = result.receiptStatus;
            renderTracking();
        } catch (error) {
            $("#receipt-message").textContent = `Could not prepare your receipt: ${error.message}`;
        } finally {
            button.disabled = false;
            button.textContent =
                state.orderStatus.receiptStatus === "pending" ? "Generate receipt" : "Try receipt again";
        }
    });
    $("#receipt-preview-image").addEventListener("error", () => {
        const image = $("#receipt-preview-image");
        image.hidden = true;
        image.removeAttribute("src");
        $("#receipt-message").textContent =
            "The receipt image could not be loaded. Please try refreshing or generating the receipt again.";
    });
    $("#back-to-customizer-button").addEventListener("click", () => {
        window.clearInterval(trackingPollTimer);
        setCustomerView(historyReturnView);
    });
    document.addEventListener("keydown", (event) => {
        const drawer = $("#cart-drawer");
        if (!drawer.hasAttribute("open")) return;
        if (event.key === "Escape") {
            event.preventDefault();
            closeCart();
            return;
        }
        if (event.key !== "Tab") return;
        const focusable = [...drawer.querySelectorAll("button:not(:disabled)")];
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    });
    $("#classics-select").addEventListener("change", (event) => {
        const recipe = CLASSICS[event.target.value];
        if (recipe) applyRecipe(recipe, event.target.value);
    });
    $("#surprise-button").addEventListener("click", () => {
        const pick = (values) => values[Math.floor(Math.random() * values.length)];
        Object.assign(state, {
            base: pick(Object.keys(BASES)),
            caffeineMode: pick(["regular", "decaf", "half"]),
            volumeMl: pick([150, 180, 210, 240, 300, 360, 420]),
            shots: pick([1, 2, 2, 3, 4]),
            extraction: pick(["ristretto", "standard", "lungo"]),
            temperature: pick(["hot", "iced", "blended"]),
            iceStyle: pick(["cube", "coffee", "crushed"]),
            milk: pick(Object.keys(MILKS)),
            foam: pick([0, 15, 30, 50, 70, 90]),
            syrups: {
                vanilla: Math.floor(Math.random() * 3),
                caramel: Math.floor(Math.random() * 3),
                chocolate: Math.floor(Math.random() * 3)
            },
            sweeteners: Math.random() > 0.6 ? [pick(Object.keys(SWEETENERS))] : [],
            toppings: { cinnamon: Math.random() > 0.75, whippedCream: Math.random() > 0.8, cocoa: Math.random() > 0.8 }
        });
        $("#classics-select").value = "";
        render();
        setNotice("A new little coffee idea, just for you.");
    });
    showPreview(activePreview);
    render();
    loadSharedRecipeFromLink();
})();
