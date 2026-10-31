(() => {
    const $ = (selector) => document.querySelector(selector);
    const timeFormatter = new Intl.DateTimeFormat("en-PH", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit"
    });
    const ADMIN_ROLES = new Set(["admin", "staff", "superadmin", "pending_admin"]);
    const isPending = (account) => account.role === "pending_admin";
    let filter = "admins";
    let data = null;
    let started = false;

    function showMessage(message, isError = false) {
        $("#account-message").textContent = message;
        $("#account-message").dataset.state = isError ? "error" : "success";
    }

    async function request(url, options = {}) {
        const response = await fetch(url, { credentials: "same-origin", ...options });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || "The request could not be completed.");
        return result;
    }

    function statusText(account) {
        if (account.active) return "● Signed in";
        if (account.lastSignInAt) return `Last signed in ${timeFormatter.format(new Date(account.lastSignInAt))}`;
        return "Not signed in";
    }

    const QUESTIONS = {
        delete: (name) =>
            `Delete ${name}? Their saved drinks and sign-in are removed for good. Their past orders stay, without a name attached.`,
        decline: (name) => `Decline ${name}'s admin request? The request and its sign-in are deleted.`,
        demote: (name) =>
            `Remove ${name}'s admin rights? They become a customer and their admin sign-in stops working immediately.`,
        approve: (name) =>
            `Approve ${name} as an admin? They can log in and set up their authenticator app within 24 hours.`
    };
    const DONE = {
        delete: (name) => `${name} was deleted.`,
        decline: (name) => `${name}'s admin request was declined.`,
        demote: (name) => `${name} is now a customer.`,
        approve: (name) => `${name} is now an admin. Ask them to log in within 24 hours to set up their authenticator.`
    };

    async function runAction(account, action) {
        if (!window.confirm(QUESTIONS[action](account.username))) return;
        showMessage("");
        try {
            const path = `/api/superadmin/accounts/${encodeURIComponent(account.username)}`;
            const post = (suffix) =>
                request(`${path}/${suffix}`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: "{}"
                });
            const result =
                action === "delete" || action === "decline"
                    ? await request(path, { method: "DELETE" })
                    : await post(action === "approve" ? "approve-admin" : "demote");
            showMessage(DONE[action](result.username));
            await loadAccounts();
        } catch (error) {
            showMessage(`Could not update ${account.username}: ${error.message}`, true);
        }
    }

    function actionButton(label, account, action, isDanger) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = isDanger ? "button button-small account-danger" : "button button-small";
        button.textContent = label;
        button.addEventListener("click", async () => {
            button.disabled = true;
            await runAction(account, action);
            button.disabled = false;
        });
        return button;
    }

    function render() {
        // Requests waiting for approval go first, so they're hard to miss.
        const accounts = data.accounts
            .filter((account) => (filter === "admins" ? ADMIN_ROLES.has(account.role) : !ADMIN_ROLES.has(account.role)))
            .sort((a, b) => Number(isPending(b)) - Number(isPending(a)));
        const pending = accounts.filter(isPending).length;
        const signedIn = accounts.filter((account) => account.active).length;
        $("#account-summary").textContent =
            `${accounts.length - pending} ${filter} · ${signedIn} signed in now` +
            (pending ? ` · ${pending} admin request${pending === 1 ? "" : "s"} waiting for approval` : "");
        document.querySelectorAll("[data-account-filter]").forEach((button) => {
            button.setAttribute("aria-pressed", String(button.dataset.accountFilter === filter));
        });
        $("#account-list").replaceChildren(
            ...accounts.map((account) => {
                const item = document.createElement("li");
                item.className = "admin-access-item";
                item.dataset.active = String(account.active);
                item.dataset.pending = String(isPending(account));
                const name = document.createElement("strong");
                name.textContent = account.username;
                const role = document.createElement("span");
                role.className = "admin-access-status account-role";
                role.textContent = isPending(account) ? "admin request" : account.role;
                const status = document.createElement("span");
                status.className = "admin-access-status account-status";
                status.textContent = isPending(account)
                    ? `${account.email || "no email"} · asked ${timeFormatter.format(new Date(account.createdAt))}`
                    : statusText(account);
                item.append(name, role, status);
                const isYou = account.username.toLowerCase() === String(data.you).toLowerCase();
                if (!isYou && account.role !== "superadmin") {
                    const actions = document.createElement("span");
                    actions.className = "account-actions";
                    if (isPending(account)) {
                        actions.append(
                            actionButton("Approve", account, "approve", false),
                            actionButton("Decline", account, "decline", true)
                        );
                    } else {
                        if (account.role === "admin" || account.role === "staff") {
                            actions.append(actionButton("Remove admin rights", account, "demote", false));
                        }
                        actions.append(actionButton("Delete", account, "delete", true));
                    }
                    item.append(actions);
                }
                return item;
            })
        );
        if (!accounts.length) {
            const empty = document.createElement("li");
            empty.className = "admin-access-status";
            empty.textContent = `No ${filter} yet.`;
            $("#account-list").append(empty);
        }
    }

    async function loadAccounts() {
        try {
            data = await request("/api/superadmin/accounts");
            render();
        } catch (error) {
            showMessage(`Could not load accounts: ${error.message}`, true);
        }
    }

    function start(role) {
        if (role !== "superadmin" || started) return;
        started = true;
        $("#account-dashboard").hidden = false;
        loadAccounts();
    }

    document.querySelectorAll("[data-account-filter]").forEach((button) => {
        button.addEventListener("click", () => {
            filter = button.dataset.accountFilter;
            if (data) render();
        });
    });
    $("#admin-refresh-button").addEventListener("click", () => {
        if (started) loadAccounts();
    });
    document.addEventListener("coffeelab:signed-in", (event) => start(event.detail?.role));
    // The signed-in event may have fired before this script loaded.
    if (window.CoffeeLabSession) start(window.CoffeeLabSession.role);
})();
