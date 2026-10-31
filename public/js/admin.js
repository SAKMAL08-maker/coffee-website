(() => {
    const pageSize = 50;
    const AGE_WARN_MINUTES = 10;
    const AGE_LATE_MINUTES = 20;
    const POLL_INTERVAL_MS = 15000;
    const FINAL_STATUSES = ["Delivered", "Ready for Pickup", "Cancelled"];
    let isSuperadmin = false;
    let currentPage = 1;
    let currentView = "active";
    let searchText = "";
    let totalCount = 0;
    let isLoadingOrders = false;
    let isAdminAuthenticated = false;
    let refreshTimer = null;
    let searchTimer = null;
    let pendingRefresh = false;
    let lastSignature = "";
    let lastOrders = [];
    let newestSeenAt = null;
    let unseenNewOrders = 0;
    const openOrderIds = new Set();
    const baseTitle = document.title;
    const $ = (selector) => document.querySelector(selector);
    const moneyFormatter = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" });
    const timeFormatter = new Intl.DateTimeFormat("en-PH", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit"
    });

    function formatMoney(cents) {
        return moneyFormatter.format((Number(cents) || 0) / 100);
    }

    function formatTime(value) {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? "—" : timeFormatter.format(date);
    }

    function orderCode(order) {
        return `CL-${order.trackingCode.slice(-6).toUpperCase()}`;
    }

    function element(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function isCashDue(order) {
        // cashCollectedAt is undefined when the cash migration isn't applied; then nothing is "due".
        return (
            (order.paymentMethod || "cash") === "cash" && order.cashCollectedAt === null && order.status !== "Cancelled"
        );
    }

    // Plain-language drink description listing only what differs from a standard hot latte.
    const SWEETENER_LABELS = { whiteSugar: "white sugar", rawSugar: "raw sugar", honey: "honey", stevia: "stevia" };
    const TOPPING_LABELS = { cinnamon: "cinnamon", whippedCream: "whipped cream", cocoa: "cocoa" };
    const MILK_LABELS = { skim: "skim milk", oat: "oat milk", almond: "almond milk" };
    function describeDrink(configuration = {}) {
        const parts = [];
        if (configuration.volumeMl) parts.push(`${configuration.volumeMl} ml`);
        if (configuration.temperature === "iced") {
            parts.push(
                configuration.iceStyle && configuration.iceStyle !== "cube"
                    ? `iced (${configuration.iceStyle} ice)`
                    : "iced"
            );
        } else if (configuration.temperature === "blended") parts.push("blended");
        if (configuration.caffeineMode === "decaf") parts.push("decaf");
        if (configuration.caffeineMode === "half") parts.push("half-caf");
        if (configuration.base === "espresso") {
            if (configuration.shots && configuration.shots !== 2) parts.push(`${configuration.shots} shots`);
            if (configuration.extraction && configuration.extraction !== "standard")
                parts.push(configuration.extraction);
        }
        if (configuration.base === "espresso" || configuration.base === "matcha") {
            if (MILK_LABELS[configuration.milk]) parts.push(MILK_LABELS[configuration.milk]);
            if (Number.isFinite(configuration.foam) && configuration.foam !== 25)
                parts.push(`${configuration.foam}% foam`);
        }
        for (const [syrup, pumps] of Object.entries(configuration.syrups || {})) {
            if (pumps > 0) parts.push(`${pumps}× ${syrup}`);
        }
        for (const sweetener of configuration.sweeteners || []) parts.push(SWEETENER_LABELS[sweetener] || sweetener);
        for (const [topping, enabled] of Object.entries(configuration.toppings || {})) {
            if (enabled) parts.push(TOPPING_LABELS[topping] || topping);
        }
        return parts.join(" · ");
    }

    function drinkName(item) {
        return item.classification && item.classification !== item.name
            ? `${item.name} (${item.classification})`
            : item.name;
    }

    function drinksSummary(items = []) {
        if (!items.length) return "No drinks";
        const names = items.slice(0, 2).map((item) => item.name);
        const more = items.length > 2 ? ` +${items.length - 2} more` : "";
        return `${items.length} × ${names.join(", ")}${more}`;
    }

    function ageInfo(order) {
        const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(order.createdAt)) / 60000));
        if (!Number.isFinite(minutes)) return { text: "—", level: "" };
        const text =
            minutes < 1
                ? "just now"
                : minutes < 60
                  ? `${minutes} min`
                  : minutes < 24 * 60
                    ? `${Math.floor(minutes / 60)} h ${minutes % 60} min`
                    : formatTime(order.createdAt);
        // Only orders still being made get the amber/red "waiting too long" colours.
        const isWaiting = !FINAL_STATUSES.includes(order.status);
        const level = !isWaiting
            ? ""
            : minutes >= AGE_LATE_MINUTES
              ? "late"
              : minutes >= AGE_WARN_MINUTES
                ? "warn"
                : "";
        return { text, level };
    }

    // The one obvious next action for an order, following services/orderStatusMachine.js.
    function nextStep(order) {
        const code = orderCode(order);
        if (FINAL_STATUSES.includes(order.status)) {
            return isCashDue(order)
                ? {
                      label: "Cash collected",
                      action: "cash-collected",
                      confirm: `Record ${formatMoney(order.pricing?.total_cents)} cash as collected for ${code}?`
                  }
                : null;
        }
        if (order.status === "Received") return { label: "Start crafting", action: "advance", status: "Crafting" };
        if (order.fulfillmentMethod === "pickup") {
            return {
                label: "Ready for pickup",
                action: "approve-pickup",
                confirm: `Mark ${code} ready for pickup? The customer is told to come; this can't be undone.`
            };
        }
        if (order.status === "Crafting")
            return { label: "Out for delivery", action: "advance", status: "Out for Delivery" };
        if (order.status === "Out for Delivery") return { label: "Arrived", action: "advance", status: "Arrived" };
        return {
            label: "Approve delivered",
            action: "approve",
            confirm: `Approve ${code} as delivered? This is final and can't be undone.`
        };
    }

    function actionButton(label, step, className = "button button-small") {
        const button = element("button", className, label);
        button.type = "button";
        button.dataset.adminAction = step.action;
        if (step.status) button.dataset.status = step.status;
        if (step.confirm) button.dataset.confirm = step.confirm;
        return button;
    }

    function detailRow(list, label, value) {
        list.append(element("dt", "", label), element("dd", "", value || "—"));
    }

    function createOrderDetail(order) {
        const detail = element("div", "order-detail");
        const code = orderCode(order);
        const customer = order.customer || {};

        const info = element("dl", "order-info");
        detailRow(info, "Phone", customer.phone);
        detailRow(
            info,
            order.fulfillmentMethod === "delivery" ? "Address" : "Pickup",
            order.deliveryAddress || "At the counter"
        );
        detailRow(info, "Placed", formatTime(order.createdAt));
        if (order.notes) detailRow(info, "Notes", order.notes);
        if (order.deliveryReportedAt) detailRow(info, "Customer says delivered", formatTime(order.deliveryReportedAt));
        if (order.deliveryApprovedAt) detailRow(info, "Delivery approved", formatTime(order.deliveryApprovedAt));
        if (order.pickupApprovedAt) detailRow(info, "Ready for pickup", formatTime(order.pickupApprovedAt));
        if ((order.paymentMethod || "cash") === "cash") {
            detailRow(info, "Cash", order.cashCollectedAt ? `Collected ${formatTime(order.cashCollectedAt)}` : "Due");
        }
        detail.append(info);

        const drinks = element("ul", "order-drinks");
        for (const item of order.items || []) {
            const line = element("li");
            const head = element("span", "order-drink-name", drinkName(item));
            const price = element("span", "order-drink-price", formatMoney(item.price_cents));
            const options = element("span", "order-drink-options", describeDrink(item.configuration));
            line.append(head, price, options);
            drinks.append(line);
        }
        detail.append(drinks);

        const pricing = order.pricing || {};
        const fees = [
            ["Drinks", pricing.subtotal_cents],
            ["Delivery", pricing.delivery_fee_cents],
            ["Service", pricing.service_fee_cents],
            // Older orders added tax on top; newer ones include VAT in the prices (noted after the total).
            ["Tax", pricing.vat_inclusive ? 0 : pricing.tax_cents],
            ["Tip", pricing.tip_cents]
        ]
            .filter(([, cents]) => Number(cents) > 0)
            .map(([label, cents]) => `${label} ${formatMoney(cents)}`);
        const vatNote = pricing.vat_inclusive ? ` (incl. VAT ${formatMoney(pricing.tax_cents)})` : "";
        detail.append(
            element("p", "order-fees", `${fees.join(" · ")} · Total ${formatMoney(pricing.total_cents)}${vatNote}`)
        );

        const actions = element("div", "order-detail-actions");
        const primary = nextStep(order);
        // Final approvals stay available as overrides (e.g. an order handed over early).
        if (
            !FINAL_STATUSES.includes(order.status) &&
            primary?.action !== "approve" &&
            primary?.action !== "approve-pickup"
        ) {
            actions.append(
                order.fulfillmentMethod === "delivery"
                    ? actionButton("Approve delivered now", {
                          action: "approve",
                          confirm: `Approve ${code} as delivered now? This is final and can't be undone.`
                      })
                    : actionButton("Ready for pickup now", {
                          action: "approve-pickup",
                          confirm: `Mark ${code} ready for pickup now? This can't be undone.`
                      })
            );
        }
        if (isCashDue(order) && primary?.action !== "cash-collected") {
            actions.append(
                actionButton("Cash collected", {
                    action: "cash-collected",
                    confirm: `Record ${formatMoney(pricing.total_cents)} cash as collected for ${code}?`
                })
            );
        }
        if (order.receiptStatus === "available") {
            actions.append(
                actionButton("View receipt", { action: "preview-receipt" }),
                actionButton("Receipt PDF", { action: "receipt" })
            );
        } else {
            actions.append(
                actionButton(order.receiptStatus === "pending" ? "Make receipt" : "Retry receipt", {
                    action: "generate-receipt"
                })
            );
        }
        // Cancel keeps the record; permanent delete is the superadmin's (the server enforces both).
        if (!FINAL_STATUSES.includes(order.status)) {
            actions.append(
                actionButton(
                    "Cancel order",
                    {
                        action: "cancel",
                        confirm: `Cancel ${code}? The customer will see it as cancelled and it won't count as a sale.`
                    },
                    "button button-small button-danger order-delete"
                )
            );
        }
        if (isSuperadmin) {
            actions.append(
                actionButton(
                    "Delete permanently",
                    {
                        action: "delete",
                        confirm: `Permanently delete ${code} and its receipt? This erases it from all records and cannot be undone. Cancelling keeps the record.`
                    },
                    "button button-small button-danger order-delete"
                )
            );
        }
        detail.append(actions);

        const preview = element("img", "admin-receipt-preview");
        preview.alt = `Receipt image for order ${code}`;
        preview.hidden = true;
        preview.addEventListener("error", () => {
            preview.hidden = true;
            const button = actions.querySelector('[data-admin-action="preview-receipt"]');
            if (button) button.textContent = "Receipt image unavailable";
        });
        detail.append(preview);
        return detail;
    }

    function createOrderRow(order) {
        const row = element("article", "order-row");
        row.dataset.orderId = order.id;
        row.dataset.status = order.status;
        if (newestSeenAt && order.createdAt > newestSeenAt) row.classList.add("is-new");

        const details = element("details", "order-row-details");
        details.open = openOrderIds.has(order.id);
        details.addEventListener("toggle", () => {
            if (details.open) openOrderIds.add(order.id);
            else openOrderIds.delete(order.id);
        });

        const summary = element("summary", "order-summary");
        const age = ageInfo(order);
        const ageNode = element("span", "order-age", age.text);
        ageNode.dataset.level = age.level;
        const who = element("span", "order-who");
        who.append(
            element("strong", "order-code", orderCode(order)),
            element("span", "order-name", order.customer?.name || "Guest")
        );
        const method = element("span", "order-method", order.fulfillmentMethod === "delivery" ? "Delivery" : "Pickup");
        const drinks = element("span", "order-drinks-summary", drinksSummary(order.items));
        const total = element("span", "order-total", formatMoney(order.pricing?.total_cents));
        const status = element("span", "order-status", order.status);
        status.dataset.status = order.status.toLowerCase().replace(/\s+/g, "-");
        const flags = element("span", "order-flags");
        if (isCashDue(order)) flags.append(element("span", "order-flag", "Cash due"));
        if (order.deliveryReportedAt && !order.deliveryApprovedAt) {
            flags.append(element("span", "order-flag is-attention", "Customer says delivered"));
        }
        if (order.notes) flags.append(element("span", "order-flag", "Note"));
        if (order.receiptStatus === "failed")
            flags.append(element("span", "order-flag is-attention", "Receipt failed"));
        summary.append(ageNode, who, method, drinks, total, status, flags);
        details.append(summary, createOrderDetail(order));

        const primary = element("div", "order-next");
        const step = nextStep(order);
        if (step) primary.append(actionButton(step.label, step, "button button-small button-primary"));
        else primary.append(element("span", "order-done", "Done"));
        row.append(details, primary);
        return row;
    }

    function focusKey(node) {
        const row = node?.closest?.(".order-row");
        if (!row) return null;
        const action = node.dataset?.adminAction;
        return { orderId: row.dataset.orderId, selector: action ? `[data-admin-action="${action}"]` : "summary" };
    }

    function renderOrders(orders) {
        const list = $("#admin-order-list");
        // Rebuilding drops focus; remember it and put it back on the same control.
        const focused = focusKey(document.activeElement);
        list.replaceChildren();
        if (!orders.length) {
            const empty = element(
                "p",
                "admin-empty",
                searchText
                    ? `No orders match "${searchText}".`
                    : currentView === "active"
                      ? "No orders waiting. 🎉"
                      : "No orders found."
            );
            list.append(empty);
            return;
        }
        orders.forEach((order) => list.append(createOrderRow(order)));
        if (focused) {
            const row = list.querySelector(`.order-row[data-order-id="${CSS.escape(focused.orderId)}"]`);
            row?.querySelector(focused.selector)?.focus();
        }
    }

    // Ages tick on every poll even when nothing else changed.
    function refreshAges() {
        for (const order of lastOrders) {
            const row = $(`#admin-order-list .order-row[data-order-id="${CSS.escape(order.id)}"] .order-age`);
            if (!row) continue;
            const age = ageInfo(order);
            row.textContent = age.text;
            row.dataset.level = age.level;
        }
    }

    function updateCounts(counts) {
        if (!counts) return;
        document.querySelectorAll("[data-order-view]").forEach((button) => {
            const count = counts[button.dataset.orderView];
            button.querySelector(".order-view-count").textContent = Number.isInteger(count) ? String(count) : "";
        });
        const badge = $("#admin-tab-orders-badge");
        if (badge && Number.isInteger(counts.active)) {
            badge.hidden = counts.active === 0;
            badge.replaceChildren(String(counts.active), element("span", "sr-only", " active orders"));
        }
    }

    function isWatchingOrders() {
        return !document.hidden && !$("#admin-panel-orders")?.hidden;
    }

    function noteNewOrders(orders) {
        const newest = orders.reduce((latest, order) => (order.createdAt > latest ? order.createdAt : latest), "");
        if (newestSeenAt && newest > newestSeenAt) {
            unseenNewOrders += orders.filter((order) => order.createdAt > newestSeenAt).length;
        }
        if (newest && (!newestSeenAt || newest > newestSeenAt)) newestSeenAt = newest;
        document.title =
            unseenNewOrders && !isWatchingOrders() ? `(${unseenNewOrders}) New order · ${baseTitle}` : baseTitle;
        if (isWatchingOrders()) unseenNewOrders = 0;
    }

    async function loadOrders() {
        if (!isAdminAuthenticated || document.hidden) return;
        if (isLoadingOrders) {
            pendingRefresh = true;
            return;
        }
        isLoadingOrders = true;
        const message = $("#admin-message");
        if (!lastSignature) message.textContent = "Loading orders…";
        try {
            const params = new URLSearchParams({ page: String(currentPage), view: currentView });
            if (searchText) params.set("q", searchText);
            const response = await fetch(`/api/orders/admin/all?${params}`, { credentials: "same-origin" });
            let result;
            try {
                result = await response.json();
            } catch {
                throw new Error(`The server returned an unreadable response (${response.status}).`);
            }
            if (!response.ok) {
                if (response.status === 401 || response.status === 403) {
                    throw new Error("Your administrator session has ended. Sign out and sign back in.");
                }
                if (response.status === 400 && searchText) {
                    throw new Error("Search accepts letters, numbers, spaces and hyphens only.");
                }
                throw new Error(result.error || `The orders could not be loaded (${response.status}).`);
            }
            if (!Array.isArray(result.orders) || !Number.isInteger(result.totalCount)) {
                throw new Error("The server returned an invalid orders response.");
            }
            totalCount = result.totalCount;
            if (!result.orders.length && currentPage > 1) {
                currentPage -= 1;
                window.setTimeout(loadOrders, 0);
                return;
            }
            updateCounts(result.counts);
            // Only rebuild when something changed, so open rows, focus and receipt previews survive polling.
            const signature = JSON.stringify([currentView, searchText, currentPage, result.orders]);
            const isNewData = signature !== lastSignature;
            if (isNewData) {
                renderOrders(result.orders);
                lastSignature = signature;
            }
            lastOrders = result.orders;
            if (currentView !== "done") noteNewOrders(result.orders);
            if (!isNewData) refreshAges();
            const pageCount = Math.max(1, Math.ceil(totalCount / pageSize));
            $("#admin-page-label").textContent =
                `Page ${currentPage} of ${pageCount} · ${totalCount} order${totalCount === 1 ? "" : "s"}`;
            $("#admin-pagination").hidden = pageCount <= 1;
            $("#admin-previous-page").disabled = currentPage <= 1;
            $("#admin-next-page").disabled = currentPage >= pageCount;
            message.textContent = result.schemaWarning || "";
            message.dataset.state = result.schemaWarning ? "warning" : "";
        } catch (error) {
            message.textContent = `Could not load orders: ${error.message}`;
            message.dataset.state = "error";
        } finally {
            isLoadingOrders = false;
            if (pendingRefresh) {
                pendingRefresh = false;
                window.setTimeout(loadOrders, 0);
            }
        }
    }

    function reloadFromStart() {
        currentPage = 1;
        lastSignature = "";
        loadOrders();
    }

    function startAutomaticRefresh() {
        if (refreshTimer) window.clearInterval(refreshTimer);
        loadOrders();
        refreshTimer = window.setInterval(loadOrders, POLL_INTERVAL_MS);
    }

    function startForUser(user) {
        if (user?.role !== "admin" && user?.role !== "superadmin") return;
        isSuperadmin = user.role === "superadmin";
        if (isAdminAuthenticated) {
            loadOrders();
            return;
        }
        isAdminAuthenticated = true;
        currentPage = 1;
        startAutomaticRefresh();
    }

    // One entry per order button. Adding an admin action means adding an entry
    // here and a button in createOrderRow/createOrderDetail.
    const ADMIN_ORDER_ACTIONS = {
        advance: {
            path: "/status",
            method: "PATCH",
            body: (button) => ({ status: button.dataset.status }),
            description: "update the status",
            successMessage: (result, code, button) => `${code} is now ${button.dataset.status}.`
        },
        approve: {
            path: "/admin/approve-delivery",
            method: "PATCH",
            description: "approve delivery",
            successMessage: (result, code) => `${code} approved as delivered.`
        },
        "approve-pickup": {
            path: "/admin/approve-pickup",
            method: "PATCH",
            description: "mark ready for pickup",
            successMessage: (result, code) => `${code} is ready for pickup.`
        },
        "cash-collected": {
            path: "/admin/cash-collected",
            method: "PATCH",
            description: "record the cash",
            successMessage: (result, code) => `Cash recorded for ${code}.`
        },
        "generate-receipt": {
            path: "/admin/receipt/retry",
            method: "POST",
            description: "make the receipt",
            successMessage: (result, code) =>
                result.receiptStatus === "available"
                    ? `Receipt ready for ${code}.`
                    : result.receiptStatus === "failed"
                      ? `The receipt for ${code} could not be made. Try again in a minute; if it keeps failing, check the server logs.`
                      : "Receipt storage isn't set up on this server yet."
        },
        cancel: {
            path: "/admin/cancel",
            method: "PATCH",
            description: "cancel the order",
            successMessage: (result, code) => `${code} cancelled.`
        },
        delete: {
            path: "/admin",
            method: "DELETE",
            description: "delete the order",
            successMessage: (result, code) => `${code} deleted.`
        }
    };

    async function performOrderAction(button) {
        const row = button.closest(".order-row");
        const orderId = row?.dataset.orderId;
        const action = button.dataset.adminAction;
        if (!orderId || !action) return;
        const code = row.querySelector(".order-code")?.textContent || "The order";
        const orderPath = `/api/orders/${encodeURIComponent(orderId)}`;
        if (action === "preview-receipt") {
            const preview = row.querySelector(".admin-receipt-preview");
            if (preview.hidden) preview.src = `${orderPath}/admin/receipt/preview`;
            preview.hidden = !preview.hidden;
            button.textContent = preview.hidden ? "View receipt" : "Hide receipt";
            return;
        }
        if (action === "receipt") {
            window.location.assign(`${orderPath}/admin/receipt`);
            return;
        }
        if (button.dataset.confirm && !window.confirm(button.dataset.confirm)) return;
        const actionConfig = ADMIN_ORDER_ACTIONS[action];
        if (!actionConfig) return;

        button.disabled = true;
        const message = $("#admin-message");
        try {
            const response = await fetch(`${orderPath}${actionConfig.path}`, {
                method: actionConfig.method,
                credentials: "same-origin",
                headers: { "Content-Type": "application/json" },
                body: actionConfig.method === "DELETE" ? undefined : JSON.stringify(actionConfig.body?.(button) || {})
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(result.error || `The server answered ${response.status}.`);
            message.textContent = actionConfig.successMessage(result, code, button);
            message.dataset.state = "success";
            lastSignature = "";
            await loadOrders();
        } catch (error) {
            message.textContent = `Could not ${actionConfig.description} for ${code}: ${error.message}`;
            message.dataset.state = "error";
            button.disabled = false;
        }
    }

    window.CoffeeLabAdmin = { startForUser };
    $("#admin-refresh-button").addEventListener("click", () => {
        lastSignature = "";
        loadOrders();
    });
    document.addEventListener("visibilitychange", () => {
        if (!document.hidden && isAdminAuthenticated) loadOrders();
    });
    // Coming back to the Orders tab clears the "new order" title.
    $("#admin-tab-orders").addEventListener("click", () => {
        unseenNewOrders = 0;
        document.title = baseTitle;
    });
    document.querySelectorAll("[data-order-view]").forEach((button) => {
        button.addEventListener("click", () => {
            currentView = button.dataset.orderView;
            document.querySelectorAll("[data-order-view]").forEach((candidate) => {
                candidate.setAttribute("aria-pressed", String(candidate === button));
            });
            reloadFromStart();
        });
    });
    $("#order-search").addEventListener("input", (event) => {
        window.clearTimeout(searchTimer);
        searchTimer = window.setTimeout(() => {
            searchText = event.target.value.trim();
            reloadFromStart();
        }, 300);
    });
    $("#admin-previous-page").addEventListener("click", () => {
        if (currentPage <= 1) return;
        currentPage -= 1;
        loadOrders();
    });
    $("#admin-next-page").addEventListener("click", () => {
        if (currentPage * pageSize >= totalCount) return;
        currentPage += 1;
        loadOrders();
    });
    $("#admin-order-list").addEventListener("click", (event) => {
        const button = event.target.closest("[data-admin-action]");
        if (button) performOrderAction(button);
    });
})();
