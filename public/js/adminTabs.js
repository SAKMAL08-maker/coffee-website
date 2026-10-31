(() => {
    const STORAGE_KEY = "coffee-lab-admin-tab";
    const tabs = [...document.querySelectorAll("[data-admin-tab]")];

    function select(name, { focus = false, remember = true } = {}) {
        const tab = tabs.find((candidate) => candidate.dataset.adminTab === name) || tabs[0];
        for (const candidate of tabs) {
            const isSelected = candidate === tab;
            candidate.setAttribute("aria-selected", String(isSelected));
            candidate.tabIndex = isSelected ? 0 : -1;
            document.getElementById(candidate.getAttribute("aria-controls")).hidden = !isSelected;
        }
        if (focus) tab.focus();
        if (!remember) return;
        try {
            sessionStorage.setItem(STORAGE_KEY, tab.dataset.adminTab);
        } catch {
            // Storage can be unavailable (private mode); the tab still switches.
        }
    }

    tabs.forEach((tab) => tab.addEventListener("click", () => select(tab.dataset.adminTab)));
    document.querySelector("#admin-tabs").addEventListener("keydown", (event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const index = tabs.indexOf(document.activeElement);
        const next =
            event.key === "Home"
                ? 0
                : event.key === "End"
                  ? tabs.length - 1
                  : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
        select(tabs[next].dataset.adminTab, { focus: true });
    });

    function start(role) {
        if (role !== "admin" && role !== "superadmin") return;
        // Admins see only the Admin access panel there; the superadmin also manages all accounts.
        document.querySelector("#admin-tab-accounts-label").textContent =
            role === "superadmin" ? "Accounts" : "Admin access";
        let saved = null;
        try {
            saved = sessionStorage.getItem(STORAGE_KEY);
        } catch {
            // Storage unavailable: start on Orders.
        }
        select(saved || "orders");
    }

    // Initial state only; don't overwrite the tab remembered from earlier in this browser session.
    select("orders", { remember: false });
    document.addEventListener("coffeelab:signed-in", (event) => start(event.detail?.role));
    // The signed-in event may have fired before this script loaded.
    if (window.CoffeeLabSession) start(window.CoffeeLabSession.role);
})();
