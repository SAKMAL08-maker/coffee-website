(() => {
    const $ = (selector) => document.querySelector(selector);
    const timeFormatter = new Intl.DateTimeFormat("en-PH", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit"
    });
    const STATES = {
        active: { label: "Authenticator active", action: "Reset", reset: true },
        "setup-approved": { label: "Approved, waiting for them to scan", action: "Renew approval", reset: false },
        "setup-in-progress": { label: "Started setup, not finished", action: "Restart setup", reset: false },
        "needs-approval": { label: "Needs your approval", action: "Approve setup", reset: false },
        "not-linked": { label: "No sign-in linked yet", action: null }
    };
    let started = false;
    let isSuperadmin = false;

    function showMessage(message, isError = false) {
        $("#admin-access-message").textContent = message;
        $("#admin-access-message").dataset.state = isError ? "error" : "success";
    }

    async function request(url, options = {}) {
        const response = await fetch(url, { credentials: "same-origin", ...options });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || "The request could not be completed.");
        return result;
    }

    async function approve(account, state) {
        if (
            state.reset &&
            !window.confirm(
                `Reset ${account.username}'s authenticator? Their current app stops working, and they'll scan a new QR code at their next sign-in.`
            )
        ) {
            return;
        }
        showMessage("");
        try {
            const result = await request(`/api/admin/accounts/${encodeURIComponent(account.username)}/approve-setup`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ resetExisting: state.reset })
            });
            showMessage(
                `${result.username} can now sign in and scan a QR code until ${timeFormatter.format(new Date(result.expiresAt))}.`
            );
            await loadAccounts();
        } catch (error) {
            showMessage(`Could not approve ${account.username}: ${error.message}`, true);
        }
    }

    async function removeAdminRights(account) {
        if (!window.confirm(`Remove ${account.username}'s admin rights? They go back to being a customer.`)) return;
        showMessage("");
        try {
            await request(`/api/superadmin/accounts/${encodeURIComponent(account.username)}/demote`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: "{}"
            });
            showMessage(`${account.username} is a customer again.`);
            document.dispatchEvent(new CustomEvent("coffeelab:accounts-changed"));
            await loadAccounts();
        } catch (error) {
            showMessage(`Could not update ${account.username}: ${error.message}`, true);
        }
    }

    function renderAccounts({ accounts, you }) {
        const waiting = accounts.filter((account) => account.state === "needs-approval").length;
        $("#admin-access-badge").hidden = waiting === 0;
        $("#admin-access-badge").textContent = `${waiting} waiting`;
        $("#admin-access-list").replaceChildren(
            ...accounts.map((account) => {
                const state = STATES[account.state] || STATES["not-linked"];
                const item = document.createElement("li");
                item.className = "admin-access-item";
                item.dataset.state = account.state;
                const name = document.createElement("strong");
                name.textContent = account.username;
                const status = document.createElement("span");
                status.className = "admin-access-status";
                status.textContent =
                    account.state === "setup-approved" && account.setupExpiresAt
                        ? `${state.label} (until ${timeFormatter.format(new Date(account.setupExpiresAt))})`
                        : state.label;
                item.append(name, status);
                const isYou = account.username.toLowerCase() === String(you).toLowerCase();
                if (isYou) {
                    const tag = document.createElement("span");
                    tag.className = "admin-access-status";
                    tag.textContent = "You";
                    item.append(tag);
                } else if (state.action) {
                    const button = document.createElement("button");
                    button.type = "button";
                    button.className = state.reset ? "button button-small" : "button button-small button-primary";
                    button.textContent = state.action;
                    button.addEventListener("click", async () => {
                        button.disabled = true;
                        await approve(account, state);
                        button.disabled = false;
                    });
                    item.append(button);
                }
                // Not set up yet: the superadmin can still take the admin rights back.
                if (isSuperadmin && !isYou && account.state !== "active") {
                    const undo = document.createElement("button");
                    undo.type = "button";
                    undo.className = "button button-small account-danger";
                    undo.textContent = "Remove admin rights";
                    undo.addEventListener("click", async () => {
                        undo.disabled = true;
                        await removeAdminRights(account);
                        undo.disabled = false;
                    });
                    item.append(undo);
                }
                return item;
            })
        );
        // Open the panel and badge its tab when someone is waiting, so approvals aren't missed.
        if (waiting > 0) $("#admin-access").open = true;
        const badge = $("#admin-tab-accounts-badge");
        badge.hidden = waiting === 0;
        badge.replaceChildren(String(waiting));
        const hint = document.createElement("span");
        hint.className = "sr-only";
        hint.textContent = ` waiting for approval`;
        badge.append(hint);
    }

    async function loadAccounts() {
        try {
            renderAccounts(await request("/api/admin/accounts"));
        } catch (error) {
            showMessage(`Could not load admin accounts: ${error.message}`, true);
        }
    }

    function start(role) {
        if ((role !== "admin" && role !== "superadmin") || started) return;
        started = true;
        isSuperadmin = role === "superadmin";
        loadAccounts();
    }

    $("#admin-refresh-button").addEventListener("click", () => {
        if (started) loadAccounts();
    });
    // The superadmin made a customer an admin (Accounts list): show them here.
    document.addEventListener("coffeelab:accounts-changed", () => {
        if (started) loadAccounts();
    });
    document.addEventListener("coffeelab:signed-in", (event) => start(event.detail?.role));
    // The signed-in event may have fired before this script loaded.
    if (window.CoffeeLabSession) start(window.CoffeeLabSession.role);
})();
