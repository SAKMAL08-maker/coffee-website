/**
 * Branch picker and sold-out options in the drink builder.
 *
 * With more than one open branch, the delivery bar shows a "Branch" picker (remembered on this
 * device). Options sold out at the chosen branch are greyed out with a "Sold out" mark; the server
 * re-checks at checkout (services/menuService.js), so this is only a convenience. Refreshes every
 * minute while the page is visible, so a switch an admin flips shows up without a reload.
 */
(() => {
    const STORAGE_KEY = "coffeelab:branch";
    const REFRESH_MS = 60000;
    const BASES_WITH_MILK = ["espresso", "matcha"];
    let branches = [];
    let branchId = null;
    let soldOut = new Set();
    const labels = new Map();
    const picker = document.getElementById("branch-picker");
    const select = document.getElementById("branch-select");

    // Where each option key lives in the builder.
    const SELECTORS = {
        base: (value) => `[data-choice-group="base"] [data-value="${value}"]`,
        milk: (value) => `[data-choice-group="milk"] [data-value="${value}"]`,
        beans: () =>
            `[data-choice-group="caffeineMode"] [data-value="decaf"], [data-choice-group="caffeineMode"] [data-value="half"]`,
        syrup: (value) => `[data-counter="${value}"][data-delta="1"]`,
        sweetener: (value) => `[data-multi-group="sweeteners"] [data-value="${value}"]`,
        topping: (value) => `.topping-switch[data-topping="${value}"]`
    };

    function branchName() {
        return branches.find((branch) => branch.id === branchId)?.name || "this branch";
    }

    function mark() {
        document.querySelectorAll(".is-sold-out").forEach((node) => {
            node.classList.remove("is-sold-out");
            node.disabled = false;
            node.removeAttribute("title");
        });
        for (const key of soldOut) {
            const [group, value] = key.split(":");
            if (!SELECTORS[group]) continue;
            document.querySelectorAll(SELECTORS[group](value)).forEach((node) => {
                node.classList.add("is-sold-out");
                node.disabled = true;
                node.title = `Sold out at ${branchName()} right now`;
            });
        }
    }

    // Same rules as menuService.optionsUsedBy on the server.
    function optionsUsedBy(configuration) {
        const keys = [`base:${configuration.base}`];
        if (configuration.caffeineMode !== "regular") keys.push("beans:decaf");
        if (BASES_WITH_MILK.includes(configuration.base)) keys.push(`milk:${configuration.milk}`);
        for (const [name, pumps] of Object.entries(configuration.syrups || {}))
            if (pumps > 0) keys.push(`syrup:${name}`);
        for (const sweetener of configuration.sweeteners || []) keys.push(`sweetener:${sweetener}`);
        for (const [name, on] of Object.entries(configuration.toppings || {})) if (on) keys.push(`topping:${name}`);
        return keys;
    }

    /** Labels of the sold-out options a drink uses (empty when it can be made). */
    function soldOutIn(configuration) {
        return optionsUsedBy(configuration)
            .filter((key) => soldOut.has(key))
            .map((key) => labels.get(key) || key);
    }

    async function loadAvailability() {
        try {
            const query = branchId ? `?branch=${encodeURIComponent(branchId)}` : "";
            const response = await fetch(`/api/menu/availability${query}`);
            const result = await response.json();
            if (!response.ok) throw new Error(result.error);
            result.options.forEach((option) => labels.set(option.key, option.label));
            soldOut = new Set(result.soldOut);
            branchId = result.branchId || branchId;
            mark();
        } catch {
            // Keep the last known state; checkout re-checks on the server anyway.
        }
    }

    async function loadBranches() {
        try {
            const response = await fetch("/api/menu/branches");
            const result = await response.json();
            if (!response.ok) throw new Error(result.error);
            branches = result.branches;
        } catch {
            branches = [];
        }
        let saved = null;
        try {
            saved = localStorage.getItem(STORAGE_KEY);
        } catch {
            // Private mode: nothing remembered.
        }
        branchId = branches.find((branch) => branch.id === saved)?.id || branches[0]?.id || null;
        if (picker && select) {
            select.replaceChildren(...branches.map((branch) => new Option(branch.name, branch.id)));
            select.value = branchId || "";
            picker.hidden = branches.length < 2;
        }
        await loadAvailability();
    }

    select?.addEventListener("change", () => {
        branchId = select.value;
        try {
            localStorage.setItem(STORAGE_KEY, branchId);
        } catch {
            // Not remembered; still used for this visit.
        }
        loadAvailability();
        document.dispatchEvent(new CustomEvent("coffeelab:branch-changed", { detail: { branchId } }));
    });

    loadBranches();
    window.setInterval(() => document.visibilityState === "visible" && loadAvailability(), REFRESH_MS);

    window.CoffeeLabMenu = {
        branchId: () => branchId,
        branchName,
        hasChoice: () => branches.length > 1,
        soldOutIn
    };
})();
