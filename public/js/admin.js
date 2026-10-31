(() => {
    const pageSize = 50;
    let currentPage = 1;
    let totalCount = 0;
    let isLoadingOrders = false;
    let isAdminAuthenticated = false;
    let refreshTimer = null;
    let pendingRefresh = false;
    const $ = (selector) => document.querySelector(selector);

    function formatMoney(cents) {
        return new Intl.NumberFormat("en-PH", {
            style: "currency",
            currency: "PHP"
        }).format((Number(cents) || 0) / 100);
    }

    function appendDetail(container, label, value) {
        const row = document.createElement("p");
        const heading = document.createElement("strong");
        heading.textContent = `${label}: `;
        row.append(heading, document.createTextNode(value || "—"));
        container.append(row);
    }

    function createOrderCard(order) {
        const card = document.createElement("article");
        card.className = "admin-order-card";
        card.dataset.orderId = order.id;

        const heading = document.createElement("div");
        heading.className = "admin-order-heading";
        const title = document.createElement("h2");
        title.textContent = `Order CL-${order.trackingCode.slice(-6).toUpperCase()}`;
        const status = document.createElement("span");
        status.className = `admin-order-status${["Delivered", "Ready for Pickup"].includes(order.status) ? " is-delivered" : ""}`;
        status.textContent = order.status;
        heading.append(title, status);
        card.append(heading);

        const details = document.createElement("div");
        details.className = "admin-order-details";
        const customer = order.customer || {};
        const createdAt = new Date(order.createdAt);
        appendDetail(details, "Customer", customer.name);
        appendDetail(details, "Phone", customer.phone);
        appendDetail(details, "Fulfillment", order.fulfillmentMethod);
        appendDetail(
            details,
            order.fulfillmentMethod === "delivery" ? "Delivery address" : "Pickup",
            order.deliveryAddress || "Pickup counter"
        );
        appendDetail(details, "Placed", Number.isNaN(createdAt.getTime()) ? "Unknown" : createdAt.toLocaleString());
        appendDetail(details, "Total", formatMoney(order.pricing?.total_cents));
        if (order.notes) appendDetail(details, "Order notes", order.notes);
        card.append(details);

        const itemHeading = document.createElement("h3");
        itemHeading.className = "admin-order-subtitle";
        itemHeading.textContent = "Drinks and configuration";
        card.append(itemHeading);
        const items = document.createElement("ul");
        items.className = "admin-order-items";
        (order.items || []).forEach((item) => {
            const line = document.createElement("li");
            const configuration = JSON.stringify(item.configuration || {});
            line.textContent = `${item.name} · ${item.classification} — ${formatMoney(item.price_cents)}${configuration === "{}" ? "" : ` · ${configuration}`}`;
            items.append(line);
        });
        card.append(items);

        const pricing = order.pricing || {};
        const priceDetails = document.createElement("div");
        priceDetails.className = "admin-price-details";
        [
            ["Drinks subtotal", pricing.subtotal_cents],
            ["Delivery", pricing.delivery_fee_cents],
            ["Service fee", pricing.service_fee_cents],
            ["Tax", pricing.tax_cents],
            ["Tip", pricing.tip_cents],
            ["Total", pricing.total_cents]
        ].forEach(([label, amount]) => appendDetail(priceDetails, label, formatMoney(amount)));
        card.append(priceDetails);

        const fulfillmentState = document.createElement("p");
        fulfillmentState.className = "admin-delivery-state";
        if (order.fulfillmentMethod === "pickup" && order.pickupApprovedAt) {
            fulfillmentState.textContent = `Pickup readiness verified ${new Date(order.pickupApprovedAt).toLocaleString()}.`;
        } else if (order.fulfillmentMethod === "delivery" && order.deliveryApprovedAt) {
            fulfillmentState.textContent = `Delivery verified ${new Date(order.deliveryApprovedAt).toLocaleString()}.`;
        } else if (order.fulfillmentMethod === "delivery" && order.deliveryReportedAt) {
            fulfillmentState.textContent = "Customer reports delivery; administrator approval is pending.";
            fulfillmentState.dataset.pending = "true";
        } else {
            fulfillmentState.textContent =
                order.fulfillmentMethod === "delivery"
                    ? "Waiting for the customer to report delivery."
                    : "Waiting for an administrator to verify that the order is ready for pickup.";
        }
        card.append(fulfillmentState);

        const paymentState = document.createElement("p");
        paymentState.className = "admin-delivery-state";
        const isCashOrder = (order.paymentMethod || "cash") === "cash";
        if (isCashOrder && order.cashCollectedAt) {
            paymentState.textContent = `Cash collected ${new Date(order.cashCollectedAt).toLocaleString()}.`;
        } else if (isCashOrder) {
            paymentState.textContent = `Cash payment due on ${order.fulfillmentMethod === "pickup" ? "pickup" : "delivery"}.`;
            paymentState.dataset.pending = "true";
        }
        if (paymentState.textContent) card.append(paymentState);

        const receiptArea = document.createElement("div");
        receiptArea.className = "admin-receipt-row";
        const receiptStatus = document.createElement("span");
        receiptStatus.textContent = `Digital receipt: ${order.receiptStatus || "unavailable"}`;
        receiptArea.append(receiptStatus);
        if (order.receiptStatus === "available") {
            const previewButton = document.createElement("button");
            previewButton.type = "button";
            previewButton.className = "button button-small";
            previewButton.dataset.adminAction = "preview-receipt";
            previewButton.textContent = "View receipt image";
            receiptArea.append(previewButton);
            const receiptButton = document.createElement("button");
            receiptButton.type = "button";
            receiptButton.className = "button button-small";
            receiptButton.dataset.adminAction = "receipt";
            receiptButton.textContent = "Download receipt PDF";
            receiptArea.append(receiptButton);
        } else {
            const generateButton = document.createElement("button");
            generateButton.type = "button";
            generateButton.className = "button button-small";
            generateButton.dataset.adminAction = "generate-receipt";
            generateButton.textContent = order.receiptStatus === "pending" ? "Generate receipt" : "Retry receipt";
            receiptArea.append(generateButton);
        }
        card.append(receiptArea);
        const receiptPreview = document.createElement("img");
        receiptPreview.className = "admin-receipt-preview";
        receiptPreview.alt = `Receipt image for order CL-${order.trackingCode.slice(-6).toUpperCase()}`;
        receiptPreview.hidden = true;
        receiptPreview.addEventListener("error", () => {
            receiptPreview.hidden = true;
            const previewButton = receiptArea.querySelector('[data-admin-action="preview-receipt"]');
            if (previewButton) previewButton.textContent = "Receipt image unavailable";
        });
        card.append(receiptPreview);

        const actions = document.createElement("div");
        actions.className = "admin-order-actions";
        if (order.fulfillmentMethod === "delivery" && !order.deliveryApprovedAt) {
            const approveButton = document.createElement("button");
            approveButton.type = "button";
            approveButton.className = "button button-primary";
            approveButton.dataset.adminAction = "approve";
            approveButton.textContent = "Approve delivered";
            actions.append(approveButton);
        }
        if (order.fulfillmentMethod === "pickup" && !order.pickupApprovedAt) {
            const approveButton = document.createElement("button");
            approveButton.type = "button";
            approveButton.className = "button button-primary";
            approveButton.dataset.adminAction = "approve-pickup";
            approveButton.textContent = "Verify ready for pickup";
            actions.append(approveButton);
        }
        // Hidden when the server can't report collection yet (cash migration not applied).
        if (isCashOrder && "cashCollectedAt" in order && !order.cashCollectedAt) {
            const cashButton = document.createElement("button");
            cashButton.type = "button";
            cashButton.className = "button button-primary";
            cashButton.dataset.adminAction = "cash-collected";
            cashButton.textContent = "Mark cash collected";
            actions.append(cashButton);
        }
        const deleteButton = document.createElement("button");
        deleteButton.type = "button";
        deleteButton.className = "button button-danger";
        deleteButton.dataset.adminAction = "delete";
        deleteButton.textContent = "Delete order";
        actions.append(deleteButton);
        card.append(actions);
        return card;
    }

    function renderOrders(orders) {
        const list = $("#admin-order-list");
        list.replaceChildren();
        if (!orders.length) {
            const empty = document.createElement("p");
            empty.className = "admin-empty";
            empty.textContent = "No orders found.";
            list.append(empty);
            return;
        }
        orders.forEach((order) => list.append(createOrderCard(order)));
    }

    async function loadOrders() {
        if (!isAdminAuthenticated || document.hidden) return;
        if (isLoadingOrders) {
            pendingRefresh = true;
            return;
        }
        isLoadingOrders = true;
        const refreshButton = $("#admin-refresh-button");
        const message = $("#admin-message");
        refreshButton.disabled = true;
        if (!totalCount) message.textContent = "Loading orders…";
        try {
            const response = await fetch(`/api/orders/admin/all?page=${currentPage}`, {
                credentials: "same-origin"
            });
            let result;
            try {
                result = await response.json();
            } catch {
                throw new Error(`The server returned an unreadable response (${response.status}).`);
            }
            if (!response.ok) {
                if (response.status === 401 || response.status === 403) {
                    throw new Error(
                        "Your administrator session is not authorized. Sign out and sign back in with an admin account."
                    );
                }
                if (response.status === 503 && result.error) throw new Error(result.error);
                if (response.status >= 500) {
                    throw new Error(
                        "The server could not query orders. Confirm the latest Supabase migrations are applied, then check the Render logs."
                    );
                }
                throw new Error(result.error || `Order request failed (${response.status}).`);
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
            renderOrders(result.orders);
            const pageCount = Math.max(1, Math.ceil(totalCount / pageSize));
            $("#admin-page-label").textContent =
                `Page ${currentPage} of ${pageCount} · ${totalCount} order${totalCount === 1 ? "" : "s"}`;
            $("#admin-previous-page").disabled = currentPage <= 1;
            $("#admin-next-page").disabled = currentPage >= pageCount;
            message.textContent = result.schemaWarning || "";
            message.dataset.state = result.schemaWarning ? "warning" : "";
        } catch (error) {
            message.textContent = `Could not load orders: ${error.message}`;
        } finally {
            refreshButton.disabled = false;
            isLoadingOrders = false;
            if (pendingRefresh) {
                pendingRefresh = false;
                window.setTimeout(loadOrders, 0);
            }
        }
    }

    function startAutomaticRefresh() {
        if (refreshTimer) window.clearInterval(refreshTimer);
        loadOrders();
        refreshTimer = window.setInterval(loadOrders, 15000);
    }

    function startForUser(user) {
        if (user?.role !== "admin" && user?.role !== "superadmin") return;
        if (isAdminAuthenticated) {
            loadOrders();
            return;
        }
        isAdminAuthenticated = true;
        currentPage = 1;
        startAutomaticRefresh();
    }

    // One entry per order button. Adding an admin action means adding an entry
    // here and a button in createOrderCard; performOrderAction stays unchanged.
    const ADMIN_ORDER_ACTIONS = {
        approve: {
            path: "/admin/approve-delivery",
            method: "PATCH",
            description: "approve delivery",
            successMessage: () => "Order approved as delivered."
        },
        "approve-pickup": {
            path: "/admin/approve-pickup",
            method: "PATCH",
            description: "verify pickup readiness",
            successMessage: () => "Order verified as ready for pickup."
        },
        "cash-collected": {
            path: "/admin/cash-collected",
            method: "PATCH",
            description: "record cash collection",
            successMessage: () => "Cash payment recorded as collected."
        },
        "generate-receipt": {
            path: "/admin/receipt/retry",
            method: "POST",
            description: "generate receipt",
            successMessage: (result) =>
                result.receiptStatus === "available"
                    ? "Receipt generated and saved to Backblaze."
                    : result.receiptStatus === "failed"
                      ? "Receipt generation or upload failed. Check the server logs and B2 application-key permissions."
                      : "B2 storage is not configured on this server. Add the B2_* variables to its environment, then retry."
        },
        delete: {
            path: "/admin",
            method: "DELETE",
            description: "delete order",
            successMessage: () => "Order and its receipt deleted."
        }
    };

    async function performOrderAction(button) {
        const card = button.closest(".admin-order-card");
        const orderId = card?.dataset.orderId;
        const action = button.dataset.adminAction;
        if (!orderId || !action) return;
        if (action === "preview-receipt") {
            const preview = card.querySelector(".admin-receipt-preview");
            const previewUrl = `/api/orders/${encodeURIComponent(orderId)}/admin/receipt/preview`;
            if (preview.hidden) preview.src = previewUrl;
            preview.hidden = !preview.hidden;
            button.textContent = preview.hidden ? "View receipt image" : "Hide receipt image";
            return;
        }
        if (
            action === "delete" &&
            !window.confirm("Permanently delete this order and its stored receipt? This cannot be undone.")
        )
            return;

        const orderPath = `/api/orders/${encodeURIComponent(orderId)}`;
        if (action === "receipt") {
            window.location.assign(`${orderPath}/admin/receipt`);
            return;
        }
        const actionConfig = ADMIN_ORDER_ACTIONS[action];
        if (!actionConfig) return;

        button.disabled = true;
        try {
            const response = await fetch(`${orderPath}${actionConfig.path}`, {
                method: actionConfig.method,
                credentials: "same-origin",
                headers: { "Content-Type": "application/json" },
                body: actionConfig.method === "DELETE" ? undefined : "{}"
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || `Order action failed (${response.status}).`);
            $("#admin-message").textContent = actionConfig.successMessage(result);
            await loadOrders();
        } catch (error) {
            $("#admin-message").textContent = `Could not ${actionConfig.description}: ${error.message}`;
            button.disabled = false;
        }
    }

    window.CoffeeLabAdmin = { startForUser };
    $("#admin-refresh-button").addEventListener("click", loadOrders);
    document.addEventListener("visibilitychange", () => {
        if (!document.hidden && isAdminAuthenticated) loadOrders();
    });
    window.addEventListener("focus", () => {
        if (isAdminAuthenticated) loadOrders();
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
