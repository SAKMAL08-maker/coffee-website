(() => {
    const $ = (selector) => document.querySelector(selector);
    const timeFormatter = new Intl.DateTimeFormat("en-PH", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit"
    });
    const ADMIN_ROLES = new Set(["admin", "staff", "superadmin"]);
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

    async function runAction(account, action) {
        const isDelete = action === "delete";
        const question = isDelete
            ? `Delete ${account.username}? Their saved drinks and sign-in are removed for good. Their past orders stay, without a name attached.`
            : `Remove ${account.username}'s admin rights? They become a customer and their admin sign-in stops working immediately.`;
        if (!window.confirm(question)) return;
        showMessage("");
        try {
            const path = `/api/superadmin/accounts/${encodeURIComponent(account.username)}`;
            const result = isDelete
                ? await request(path, { method: "DELETE" })
                : await request(`${path}/demote`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: "{}"
                  });
            showMessage(isDelete ? `${result.username} was deleted.` : `${result.username} is now a customer.`);
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
        const accounts = data.accounts.filter((account) =>
            filter === "admins" ? ADMIN_ROLES.has(account.role) : !ADMIN_ROLES.has(account.role)
        );
        const signedIn = accounts.filter((account) => account.active).length;
        $("#account-summary").textContent = `${accounts.length} ${filter} · ${signedIn} signed in now`;
        document.querySelectorAll("[data-account-filter]").forEach((button) => {
            button.setAttribute("aria-selected", String(button.dataset.accountFilter === filter));
        });
        $("#account-list").replaceChildren(
            ...accounts.map((account) => {
                const item = document.createElement("li");
                item.className = "admin-access-item";
                item.dataset.active = String(account.active);
                const name = document.createElement("strong");
                name.textContent = account.username;
                const role = document.createElement("span");
                role.className = "admin-access-status";
                role.textContent = account.role;
                const status = document.createElement("span");
                status.className = "admin-access-status account-status";
                status.textContent = statusText(account);
                item.append(name, role, status);
                const isYou = account.username.toLowerCase() === String(data.you).toLowerCase();
                if (!isYou && account.role !== "superadmin") {
                    const actions = document.createElement("span");
                    actions.className = "account-actions";
                    if (account.role === "admin" || account.role === "staff") {
                        actions.append(actionButton("Remove admin rights", account, "demote", false));
                    }
                    actions.append(actionButton("Delete", account, "delete", true));
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
