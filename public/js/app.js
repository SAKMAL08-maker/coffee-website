(() => {
    const { BASES, MILKS, SYRUPS, SWEETENERS, CLASSICS, state } = window.CoffeeLabState;
    let editingCartItemId = null;
    let drawerReturnFocus = null;
    let trackingPollTimer = null;
    let activePreview = "creation";
    const $ = (selector) => document.querySelector(selector);
    const $$ = (selector) => [...document.querySelectorAll(selector)];
    const elements = {
        volume: $("#volume-range"), shots: $("#shot-range"), foam: $("#foam-range"),
        liquid: $("#liquid"), classification: $("#drink-classification"), legend: $("#ingredient-legend"),
        notice: $("#app-notice")
    };

    function round(value, places = 0) {
        const factor = 10 ** places;
        return Math.round(value * factor) / factor;
    }

    const { money, getDrinkPrice, getPricing, getCartSubtotal, getEstimatedEta } = window.CoffeeLabPricing;

    function displayVolume(ml) {
        return state.metric ? `${Math.round(ml)} ml` : `${round(ml / 29.5735, 1)} oz`;
    }

    function getComposition() {
        const shotMl = { ristretto: 22, standard: 30, lungo: 40 }[state.extraction] || 30;
        const baseMl = state.base === "espresso" ? state.shots * shotMl : 0;
        const syrupMl = Object.entries(state.syrups).reduce((sum, [key, count]) => sum + count * SYRUPS[key].ml, 0);
        const milkTotal = state.base === "espresso"
            ? Math.max(0, state.volumeMl - baseMl - syrupMl)
            : state.base === "matcha" ? Math.max(0, state.volumeMl - syrupMl) * 0.3 : 0;
        const foamMl = milkTotal * (state.foam / 100) * 0.6;
        const milkMl = milkTotal - foamMl;
        const otherBaseMl = state.base === "espresso" ? 0 : Math.max(0, state.volumeMl - syrupMl - milkTotal);
        return { baseMl, milkMl, foamMl, syrupMl, otherBaseMl };
    }

    function getDrinkName(composition) {
        const hasExtras = Object.values(state.syrups).some(Boolean) || state.sweeteners.length || Object.values(state.toppings).some(Boolean);
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
        const caffeine = state.base === "espresso" ? base.caffeine * state.shots : base.caffeine * state.volumeMl / 240;
        const milk = MILKS[state.milk];
        let calories = base.calories + composition.milkMl * milk.calories / 100;
        let sugar = composition.milkMl * milk.sugar / 100;
        Object.entries(state.syrups).forEach(([key, count]) => {
            calories += SYRUPS[key].calories * count;
            sugar += SYRUPS[key].sugar * count;
        });
        state.sweeteners.forEach((key) => {
            calories += SWEETENERS[key].calories;
            sugar += SWEETENERS[key].sugar;
        });
        if (state.toppings.whippedCream) { calories += 50; sugar += 3; }
        return { caffeine: Math.round(caffeine * caffeineFactor), calories: Math.round(calories), sugar: round(sugar, 1) };
    }

    function renderLayers(composition) {
        const liquidHeight = Math.min(100, state.volumeMl / 480 * 100);
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
            layer.style.height = `${volume / total * 100}%`;
        });
        $("#ice-layer").hidden = state.temperature === "hot";
        $("#cup-capacity").textContent = displayVolume(state.volumeMl);
        $("#cup").setAttribute("aria-label", `${getDrinkName(composition)}, ${displayVolume(state.volumeMl)} drink`);
        $("#temperature-caption").textContent = state.temperature === "hot"
            ? `Served warm · approximately ${state.metric ? "65°C" : "149°F"}`
            : state.temperature === "iced" ? `Served chilled · ${state.iceStyle.replace(/^./, (letter) => letter.toUpperCase())} ice` : "Blended smooth with ice";
        $("#drink-summary").textContent = `${BASES[state.base].label} · ${displayVolume(state.volumeMl)} · ${state.temperature}`;
    }

    function renderLegend(composition) {
        const rows = [];
        const add = (label, amount, color) => { if (amount > 0.4) rows.push(`<tr><td><span class="legend-color" style="--swatch:${color}"></span>${label}</td><td>${displayVolume(amount)}</td></tr>`); };
        if (state.base === "espresso") add(`${state.extraction} espresso`, composition.baseMl, "#3b2314");
        else add(BASES[state.base].label, composition.otherBaseMl, state.base === "matcha" ? "#819263" : "#70472e");
        add(`${MILKS[state.milk].label} · steamed`, composition.milkMl, "#f1e6d5");
        add("Milk foam", composition.foamMl, "#fff");
        Object.entries(state.syrups).forEach(([key, count]) => {
            if (count) add(`${SYRUPS[key].label} · ${count} pump${count === 1 ? "" : "s"}`, count * SYRUPS[key].ml, key === "chocolate" ? "#2b1a10" : "#c68a4c");
        });
        state.sweeteners.forEach((key) => rows.push(`<tr><td><span class="legend-color" style="--swatch:#d9b872"></span>${SWEETENERS[key].label}</td><td>1 serving</td></tr>`));
        if (state.toppings.whippedCream) rows.push(`<tr><td><span class="legend-color" style="--swatch:#fff"></span>Whipped cream</td><td>1 swirl</td></tr>`);
        elements.legend.innerHTML = rows.length ? rows.join("") : "<tr><td>Choose ingredients to begin</td><td>—</td></tr>";
    }

    function render() {
        const composition = getComposition();
        const metrics = getMetrics(composition);
        const drinkPrice = getDrinkPrice(state);
        const pricing = getPricing(state, drinkPrice.subtotal);
        renderLayers(composition);
        renderLegend(composition);
        elements.classification.textContent = getDrinkName(composition);
        $("#caffeine-value").textContent = `${metrics.caffeine} mg`;
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
            if (group) button.setAttribute("aria-pressed", String(state[group.dataset.choiceGroup] === button.dataset.value));
        });
        $$(".chip").forEach((button) => button.setAttribute("aria-pressed", String(state.sweeteners.includes(button.dataset.value))));
        $$(".topping-switch").forEach((button) => button.setAttribute("aria-checked", String(state.toppings[button.dataset.topping])));
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
        $("#drink-price").textContent = money(drinkPrice.basePrice);
        $("#modifier-price").textContent = money(drinkPrice.modifiers);
        $("#delivery-fee-label").textContent = state.fulfillmentMethod === "delivery" ? "Delivery fee" : "Pickup";
        $("#delivery-fee").textContent = money(pricing.delivery);
        $("#service-fee").textContent = money(pricing.service);
        $("#tax-fee").textContent = money(pricing.tax);
        $("#tip-percent").textContent = round(pricing.tipRate, 0);
        $("#tip-fee").textContent = money(pricing.tip);
        $("#order-total").textContent = money(pricing.total);
        $("#custom-tip-input").hidden = state.tipPercent !== "custom";
        $("#custom-tip-input").value = state.customTipPercent;
        $$(".tip-button").forEach((button) => button.setAttribute("aria-pressed", String(String(state.tipPercent) === button.dataset.tip)));
        $("#add-to-cart-button").textContent = editingCartItemId ? "↻ Update order item" : "＋ Add to order basket";
        renderCart();
        elements.volume.value = state.volumeMl;
        elements.shots.value = state.shots;
        elements.foam.value = state.foam;
    }

    function setNotice(message) {
        elements.notice.textContent = message;
        window.clearTimeout(setNotice.timer);
        setNotice.timer = window.setTimeout(() => { elements.notice.textContent = ""; }, 4500);
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
        const subtotal = getCartSubtotal(state);
        const pricing = getPricing(state, subtotal);
        $("#cart-total").textContent = money(pricing.total);
        $("#fab-total").textContent = money(pricing.total);

        if (!count) {
            const empty = document.createElement("p");
            empty.className = "field-help";
            empty.textContent = "Your basket is empty. Add a custom drink to get started.";
            container.appendChild(empty);
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
            price.textContent = money(item.price);
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
        const pricing = getDrinkPrice(state);
        const name = getDrinkName(composition) === "Custom Concoction"
            ? `Custom ${BASES[state.base].label} drink`
            : getDrinkName(composition);
        const metrics = getMetrics(composition);
        const existingIndex = state.cartItems.findIndex((item) => item.id === editingCartItemId);
        const item = {
            id: editingCartItemId || (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`),
            name,
            state: getDrinkConfiguration(),
            metrics,
            price: pricing.subtotal
        };
        if (existingIndex >= 0) state.cartItems[existingIndex] = item;
        else state.cartItems.push(item);
        editingCartItemId = null;
        resetEditor();
        setNotice(existingIndex >= 0 ? `${name} updated in your basket.` : `${name} added to your basket.`);
    }

    function resetEditor() {
        Object.assign(state, {
            base: "espresso", caffeineMode: "regular", volumeMl: 240, shots: 2,
            extraction: "standard", temperature: "hot", iceStyle: "cube", milk: "whole",
            foam: 25, syrups: { vanilla: 0, caramel: 0, chocolate: 0 },
            sweeteners: [], toppings: { cinnamon: false, whippedCream: false, cocoa: false }
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
        window.setTimeout(() => { $("#drawer-backdrop").hidden = true; }, 280);
        if (restoreFocus && drawerReturnFocus && typeof drawerReturnFocus.focus === "function") drawerReturnFocus.focus();
    }

    function updateCheckoutSummary() {
        const subtotal = getCartSubtotal(state);
        const pricing = getPricing(state, subtotal);
        const summary = $("#checkout-summary");
        summary.textContent = `${state.cartItems.length} drink${state.cartItems.length === 1 ? "" : "s"} · ${money(subtotal)} drinks subtotal · estimated total ${money(pricing.total)} · ${getEstimatedEta(state, state.cartItems.length)}`;
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

    function renderTracking() {
        const order = state.orderStatus;
        if (!order) return;
        $("#tracking-order-number").textContent = order.number;
        $("#tracking-eta").textContent = order.fulfillmentMethod === "pickup"
            ? "Ready for pickup in about 7 minutes."
            : `Estimated arrival: ${getEstimatedEta(state, order.itemCount)}.`;
        const labels = order.fulfillmentMethod === "pickup"
            ? ["Received", "Barista crafting", "Ready for pickup", "Picked up"]
            : ["Received", "Barista crafting", "Out for delivery", "Arrived"];
        $$(".tracking-step").forEach((step, index) => {
            step.classList.toggle("complete", index < order.stage);
            step.classList.toggle("current", index === order.stage);
            step.querySelector(".step-label").textContent = labels[index];
        });
        const messages = order.fulfillmentMethod === "pickup"
            ? ["Your order is in the queue.", "Your barista is crafting your coffee.", "Your order is ready at the pickup counter.", "Enjoy your coffee! Your pickup is complete."]
            : ["Your order is confirmed and in the queue.", "Your barista is crafting your coffee.", "Your delivery partner is heading your way.", "Your coffee has arrived. Enjoy!"];
        $("#tracking-status-message").textContent = messages[order.stage];
        $("#driver-section").hidden = order.fulfillmentMethod === "pickup";
        $("#refresh-order-button").hidden = order.stage >= 3;
        $("#tracking-order-number").setAttribute("title", `Tracking code: ${order.trackingCode}`);
    }

    function showTracking() {
        $("#customizer-page").hidden = true;
        $("#tracking-page").hidden = false;
        renderTracking();
        $("#tracking-title").focus();
        window.clearInterval(trackingPollTimer);
        if (state.orderStatus && state.orderStatus.stage < 3) {
            refreshTrackingStatus();
            trackingPollTimer = window.setInterval(refreshTrackingStatus, 20000);
        }
    }

    async function refreshTrackingStatus() {
        if (!state.orderStatus?.trackingCode) return;
        try {
            const response = await fetch(`/api/orders/track/${encodeURIComponent(state.orderStatus.trackingCode)}`);
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || `Tracking request failed (${response.status}).`);
            const statusStages = ["Received", "Crafting", "Out for Delivery", "Arrived"];
            const stage = statusStages.indexOf(result.order.status);
            if (stage < 0) throw new Error("The server returned an unknown order status.");
            state.orderStatus.stage = stage;
            renderTracking();
            if (stage >= 3) window.clearInterval(trackingPollTimer);
        } catch (error) {
            $("#tracking-status-message").textContent = `Could not refresh order status: ${error.message}`;
        }
    }

    function applyRecipe(recipe) {
        Object.assign(state, JSON.parse(JSON.stringify(recipe)));
        state.metric = state.metric === undefined ? true : state.metric;
        $("#classics-select").value = "";
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
            const nextIndex = event.key === "ArrowRight" ? (index + 1) % tabs.length
                : event.key === "ArrowLeft" ? (index - 1 + tabs.length) % tabs.length
                    : event.key === "Home" ? 0
                        : event.key === "End" ? tabs.length - 1
                            : -1;
            if (nextIndex < 0) return;
            event.preventDefault();
            setTab(tabs[nextIndex].id, true);
        });
    });

    $("#unit-toggle").addEventListener("click", () => { state.metric = !state.metric; render(); });
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
        navigator.geolocation.getCurrentPosition((position) => {
            const { latitude, longitude } = position.coords;
            state.deliveryAddress = `Pinned location: ${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
            $("#delivery-address").value = state.deliveryAddress;
            setNotice("Location pinned. Add a street address or delivery instructions if needed.");
        }, (error) => {
            setNotice(`Could not get your location: ${error.message}`);
        }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 });
    });
    $$(".tip-button").forEach((button) => button.addEventListener("click", () => {
        state.tipPercent = button.dataset.tip === "custom" ? "custom" : Number(button.dataset.tip);
        render();
        if (state.tipPercent === "custom") $("#custom-tip-input").focus();
    }));
    $("#custom-tip-input").addEventListener("input", (event) => {
        const amount = Number(event.target.value);
        state.customTipPercent = Number.isFinite(amount) ? Math.max(0, Math.min(100, amount)) : 0;
        render();
    });
    $("#add-to-cart-button").addEventListener("click", addCurrentDrinkToCart);
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
                        configuration: item.state
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
                stage: 0,
                fulfillmentMethod: result.order.fulfillmentMethod,
                deliveryAddress: state.deliveryAddress,
                itemCount: result.order.itemCount
            };
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
    $("#driver-contact").addEventListener("click", () => {
        $("#tracking-status-message").textContent = "Driver contact is not connected in this demo.";
    });
    $("#back-to-customizer-button").addEventListener("click", () => {
        window.clearInterval(trackingPollTimer);
        $("#tracking-page").hidden = true;
        $("#customizer-page").hidden = false;
        $("#page-title").focus();
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
        if (recipe) applyRecipe(recipe);
    });
    $("#surprise-button").addEventListener("click", () => {
        const pick = (values) => values[Math.floor(Math.random() * values.length)];
        Object.assign(state, {
            base: pick(Object.keys(BASES)), caffeineMode: pick(["regular", "decaf", "half"]),
            volumeMl: pick([150, 180, 210, 240, 300, 360, 420]), shots: pick([1, 2, 2, 3, 4]),
            extraction: pick(["ristretto", "standard", "lungo"]), temperature: pick(["hot", "iced", "blended"]),
            iceStyle: pick(["cube", "coffee", "crushed"]), milk: pick(Object.keys(MILKS)),
            foam: pick([0, 15, 30, 50, 70, 90]),
            syrups: { vanilla: Math.floor(Math.random() * 3), caramel: Math.floor(Math.random() * 3), chocolate: Math.floor(Math.random() * 3) },
            sweeteners: Math.random() > .6 ? [pick(Object.keys(SWEETENERS))] : [],
            toppings: { cinnamon: Math.random() > .75, whippedCream: Math.random() > .8, cocoa: Math.random() > .8 }
        });
        render();
        setNotice("A new little coffee idea, just for you.");
    });
    showPreview(activePreview);
    render();
})();
