/**
 * Support tickets and chat. Customers (nav "Support") see and open their own tickets; admins and
 * the superadmin (tab "Support") see every ticket and answer. One template (#support-template)
 * serves both; the server decides who may see what (services/supportService.js).
 *
 * The open conversation polls for new messages every 5 s while it is on screen; the badge
 * (unread replies for a customer, tickets waiting for staff) refreshes every 30 s.
 */
(() => {
    const THREAD_POLL_MS = 5000;
    const BADGE_POLL_MS = 30000;
    const time = new Intl.DateTimeFormat("en-PH", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit"
    });
    const instances = new Map();
    let badgeTimer = null;

    async function request(url, options = {}) {
        const response = await fetch(url, {
            credentials: "same-origin",
            ...options,
            headers: options.body ? { "Content-Type": "application/json" } : undefined
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || `The server answered ${response.status}.`);
        return result;
    }

    function element(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function formatTime(value) {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? "" : time.format(date);
    }

    function avatar(person) {
        const wrapper = element("span", "support-avatar");
        wrapper.setAttribute("aria-hidden", "true");
        wrapper.textContent = (person?.username || "?").slice(0, 1).toUpperCase();
        if (person?.avatarUrl) {
            const image = element("img");
            image.src = person.avatarUrl;
            image.alt = "";
            image.width = 36;
            image.height = 36;
            wrapper.append(image);
        }
        return wrapper;
    }

    function setBadge(id, count, label) {
        const badge = document.getElementById(id);
        if (!badge) return;
        badge.hidden = !count;
        badge.textContent = count > 99 ? "99+" : String(count);
        badge.setAttribute("aria-label", `${count} ${label}`);
    }

    function createSupport(root, mode) {
        root.replaceChildren(document.querySelector("#support-template").content.cloneNode(true));
        const part = (name) => root.querySelector(`[data-support="${name}"]`);
        const isStaff = mode === "staff";
        const state = { filter: "open", tickets: [], current: null, lastId: 0, seen: new Set(), timer: null };

        part("filter").hidden = !isStaff;
        root.querySelector('[data-support-action="new"]').hidden = isStaff;

        function showMessage(text, kind = "") {
            const message = part("message");
            message.textContent = text;
            message.dataset.state = kind;
        }

        function show(panel) {
            part("thread-empty").hidden = panel !== "empty";
            part("new-form").hidden = panel !== "new";
            part("conversation").hidden = panel !== "conversation";
        }

        function renderList() {
            const list = part("list");
            list.replaceChildren(
                ...state.tickets.map((ticket) => {
                    const item = element("li");
                    const button = element("button", "support-ticket");
                    button.type = "button";
                    button.dataset.ticketId = ticket.id;
                    if (state.current === ticket.id) button.setAttribute("aria-current", "true");
                    if (isStaff) button.append(avatar(ticket.customer));
                    const text = element("span", "support-ticket-text");
                    text.append(element("strong", "support-ticket-subject", ticket.subject));
                    const meta = [
                        isStaff ? ticket.customer?.username : null,
                        ticket.orderCode,
                        formatTime(ticket.lastMessageAt)
                    ];
                    text.append(element("span", "support-ticket-meta", meta.filter(Boolean).join(" · ")));
                    button.append(text);
                    const chip =
                        ticket.status === "closed"
                            ? ["Closed", "is-closed"]
                            : ticket.unread
                              ? [isStaff ? "Needs reply" : "New reply", "is-new"]
                              : isStaff && ticket.needsReply
                                ? ["Needs reply", "is-new"]
                                : null;
                    if (chip) button.append(element("span", `support-chip ${chip[1]}`, chip[0]));
                    item.append(button);
                    return item;
                })
            );
            part("list-empty").textContent = state.tickets.length
                ? ""
                : isStaff
                  ? "No tickets here."
                  : "No tickets yet. Open one whenever you need help with an order or your account.";
        }

        async function loadList() {
            try {
                const url = isStaff ? `/api/support/admin/tickets?status=${state.filter}` : "/api/support/tickets";
                const result = await request(url);
                state.tickets = result.tickets;
                renderList();
                if (isStaff) setBadge("admin-tab-support-badge", result.needsReply, "tickets need a reply");
                else setBadge("support-nav-badge", result.unread, "tickets with a new reply");
            } catch (error) {
                showMessage(`Tickets couldn't be loaded: ${error.message}`, "error");
            }
        }

        function renderMessage(message) {
            if (state.seen.has(message.id)) return;
            state.seen.add(message.id);
            state.lastId = Math.max(state.lastId, message.id);
            const item = element(
                "li",
                `support-message${message.mine ? " is-mine" : ""}${message.fromStaff ? " is-staff" : ""}`
            );
            item.append(avatar(message.author));
            const bubble = element("div", "support-bubble");
            const name = message.mine
                ? "You"
                : message.fromStaff
                  ? `${message.author?.username || "Coffee Lab"} · Coffee Lab`
                  : message.author?.username || "Customer";
            const header = element("p", "support-message-meta");
            header.append(element("strong", "", name), document.createTextNode(` · ${formatTime(message.createdAt)}`));
            bubble.append(header, element("p", "support-message-body", message.body));
            item.append(bubble);
            part("messages").append(item);
        }

        function renderTicket(ticket) {
            part("subject-title").textContent = ticket.subject;
            const who = isStaff && ticket.customer ? `From ${ticket.customer.username} · ` : "";
            const order = ticket.orderCode ? `Order ${ticket.orderCode} · ` : "";
            part("thread-meta").textContent = `${who}${order}Opened ${formatTime(ticket.createdAt)}`;
            const toggle = root.querySelector('[data-support-action="toggle-status"]');
            const isClosed = ticket.status === "closed";
            toggle.textContent = isClosed ? "Reopen ticket" : "Close ticket";
            toggle.hidden = isClosed && !isStaff;
            part("composer").hidden = isClosed;
            part("closed-note").hidden = !isClosed;
            part("closed-note").textContent = isStaff
                ? "This ticket is closed. Reopen it to reply."
                : "This ticket is closed. Open a new one if you still need help.";
        }

        function stopPolling() {
            window.clearInterval(state.timer);
            state.timer = null;
        }

        async function pollThread() {
            // Stop quietly once the page or tab is no longer on screen.
            if (!root.offsetParent || !state.current) return stopPolling();
            try {
                const result = await request(`/api/support/tickets/${state.current}/messages?after=${state.lastId}`);
                result.messages.forEach(renderMessage);
                renderTicket(result.ticket);
                if (result.messages.length) part("messages").lastElementChild?.scrollIntoView({ block: "nearest" });
            } catch {
                // A missed poll is retried on the next tick.
            }
        }

        async function openTicket(ticketId) {
            stopPolling();
            state.current = ticketId;
            state.lastId = 0;
            state.seen.clear();
            part("messages").replaceChildren();
            showMessage("");
            show("conversation");
            renderList();
            try {
                const result = await request(`/api/support/tickets/${ticketId}/messages`);
                renderTicket(result.ticket);
                result.messages.forEach(renderMessage);
                part("messages").lastElementChild?.scrollIntoView({ block: "nearest" });
                state.timer = window.setInterval(pollThread, THREAD_POLL_MS);
                loadList();
            } catch (error) {
                showMessage(`That conversation couldn't be loaded: ${error.message}`, "error");
            }
        }

        async function openNewTicketForm() {
            stopPolling();
            state.current = null;
            renderList();
            show("new");
            part("new-form").reset();
            part("subject").focus();
            const select = part("order");
            select.replaceChildren(new Option("No specific order", ""));
            try {
                const { orders } = await request("/api/orders/mine");
                for (const order of (orders || []).slice(0, 20)) {
                    const code = `CL-${String(order.trackingCode || "")
                        .slice(-6)
                        .toUpperCase()}`;
                    const placed = formatTime(order.created_at || order.createdAt);
                    select.append(new Option(`${code} · ${placed}`, order.id));
                }
            } catch {
                // The order list is optional; the ticket can still be sent.
            }
        }

        root.addEventListener("click", async (event) => {
            const ticketButton = event.target.closest("[data-ticket-id]");
            if (ticketButton) return openTicket(ticketButton.dataset.ticketId);
            const filterButton = event.target.closest("[data-support-filter]");
            if (filterButton) {
                state.filter = filterButton.dataset.supportFilter;
                root.querySelectorAll("[data-support-filter]").forEach((button) =>
                    button.setAttribute("aria-pressed", String(button === filterButton))
                );
                return loadList();
            }
            const action = event.target.closest("[data-support-action]")?.dataset.supportAction;
            if (action === "new") return openNewTicketForm();
            if (action === "cancel-new") return show("empty");
            if (action === "toggle-status" && state.current) {
                const ticket = state.tickets.find((candidate) => candidate.id === state.current);
                const closing = event.target.textContent.startsWith("Close");
                if (closing && !window.confirm("Close this ticket?")) return;
                try {
                    const result = await request(`/api/support/tickets/${state.current}`, {
                        method: "PATCH",
                        body: JSON.stringify({ status: closing ? "closed" : "open" })
                    });
                    renderTicket({ ...ticket, ...result.ticket });
                    showMessage(closing ? "Ticket closed." : "Ticket reopened.", "success");
                    loadList();
                } catch (error) {
                    showMessage(error.message, "error");
                }
            }
        });

        part("new-form").addEventListener("submit", async (event) => {
            event.preventDefault();
            const submit = event.target.querySelector("button[type='submit']");
            submit.disabled = true;
            try {
                const body = { subject: part("subject").value, message: part("first-message").value };
                if (part("order").value) body.orderId = part("order").value;
                const { ticket } = await request("/api/support/tickets", {
                    method: "POST",
                    body: JSON.stringify(body)
                });
                showMessage("Ticket sent. We'll reply here.", "success");
                await loadList();
                await openTicket(ticket.id);
            } catch (error) {
                showMessage(error.message, "error");
            } finally {
                submit.disabled = false;
            }
        });

        async function sendReply() {
            const input = part("reply");
            if (!input.value.trim() || !state.current) return;
            const submit = part("composer").querySelector("button[type='submit']");
            submit.disabled = true;
            try {
                const { message } = await request(`/api/support/tickets/${state.current}/messages`, {
                    method: "POST",
                    body: JSON.stringify({ body: input.value })
                });
                input.value = "";
                renderMessage(message);
                part("messages").lastElementChild?.scrollIntoView({ block: "nearest" });
                showMessage("");
                loadList();
            } catch (error) {
                showMessage(error.message, "error");
            } finally {
                submit.disabled = false;
                input.focus();
            }
        }
        part("composer").addEventListener("submit", (event) => {
            event.preventDefault();
            sendReply();
        });
        // Enter adds a line; Ctrl+Enter (or Cmd+Enter) sends.
        part("reply").addEventListener("keydown", (event) => {
            if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                sendReply();
            }
        });

        show("empty");
        return {
            load: () => {
                loadList();
                if (state.current && !state.timer) openTicket(state.current);
            }
        };
    }

    function show(mode) {
        const root = document.querySelector(mode === "staff" ? "#admin-support-root" : "#customer-support-root");
        if (!root) return;
        if (!instances.has(mode)) instances.set(mode, createSupport(root, mode));
        instances.get(mode).load();
    }

    // Badge only (the list loads when the page opens).
    async function refreshBadge(mode) {
        try {
            if (mode === "staff") {
                const result = await request("/api/support/admin/tickets?status=open");
                setBadge("admin-tab-support-badge", result.needsReply, "tickets need a reply");
            } else {
                const result = await request("/api/support/tickets");
                setBadge("support-nav-badge", result.unread, "tickets with a new reply");
            }
        } catch {
            // The badge is a hint; the next refresh tries again.
        }
    }

    function startBadge(role) {
        const mode = role === "admin" || role === "superadmin" ? "staff" : role === "customer" ? "customer" : null;
        if (!mode || badgeTimer) return;
        refreshBadge(mode);
        badgeTimer = window.setInterval(
            () => document.visibilityState === "visible" && refreshBadge(mode),
            BADGE_POLL_MS
        );
    }

    document.addEventListener("coffeelab:admin-tab", (event) => {
        if (event.detail?.name === "support") show("staff");
    });
    document.addEventListener("coffeelab:signed-in", (event) => startBadge(event.detail?.role));
    if (window.CoffeeLabSession) startBadge(window.CoffeeLabSession.role);

    window.CoffeeLabSupport = { show };
})();
