(() => {
    const $ = (selector) => document.querySelector(selector);
    const pesoFormatter = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" });
    const dayFormatter = new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", timeZone: "UTC" });
    const DAILY_TABS = new Set(["orders", "revenue"]);
    let metrics = null;
    let selectedTabId = "orders";
    let started = false;
    let requestController = null;

    function formatValue(value, unit) {
        return unit === "cents" ? pesoFormatter.format(value / 100) : value.toLocaleString("en-PH");
    }

    function formatBarLabel(label, tabId) {
        // Daily tabs use YYYY-MM-DD keys; show them as "Oct 31".
        if (DAILY_TABS.has(tabId) && /^\d{4}-\d{2}-\d{2}$/.test(label)) {
            return dayFormatter.format(new Date(`${label}T00:00:00Z`));
        }
        return label;
    }

    function renderKpis() {
        const { totals } = metrics;
        const tiles = [
            ["Orders", totals.orders.toLocaleString("en-PH")],
            ["Drinks", totals.drinks.toLocaleString("en-PH")],
            ["Sales", pesoFormatter.format(totals.revenueCents / 100)],
            ["Average order", pesoFormatter.format(totals.averageOrderCents / 100)]
        ];
        $("#admin-kpis").replaceChildren(
            ...tiles.map(([label, value]) => {
                const tile = document.createElement("div");
                tile.className = "admin-kpi";
                const valueElement = document.createElement("strong");
                valueElement.textContent = value;
                const labelElement = document.createElement("span");
                labelElement.textContent = label;
                tile.append(valueElement, labelElement);
                return tile;
            })
        );
    }

    function renderTabs() {
        $("#admin-chart-tabs").replaceChildren(
            ...metrics.tabs.map((tab) => {
                const button = document.createElement("button");
                button.type = "button";
                button.className = "admin-chart-tab";
                button.id = `admin-chart-tab-${tab.id}`;
                button.setAttribute("role", "tab");
                button.setAttribute("aria-controls", "admin-chart");
                const isSelected = tab.id === selectedTabId;
                button.setAttribute("aria-selected", String(isSelected));
                button.tabIndex = isSelected ? 0 : -1;
                button.textContent = tab.title;
                button.addEventListener("click", () => selectTab(tab.id));
                return button;
            })
        );
    }

    function selectTab(tabId, focus = false) {
        selectedTabId = tabId;
        renderTabs();
        renderChart();
        if (focus) $(`#admin-chart-tab-${tabId}`)?.focus();
    }

    // Days read left to right, so daily tabs use vertical columns; each column's
    // label and value are in its tooltip and accessible name.
    function buildColumnChart(tab, max) {
        const figure = document.createElement("figure");
        figure.className = "admin-column-chart";
        const caption = document.createElement("figcaption");
        caption.textContent = `${tab.title}, last ${metrics.days} days · busiest day: ${formatValue(max, tab.unit)}`;
        const plot = document.createElement("div");
        plot.className = "admin-columns";
        plot.setAttribute("role", "list");
        for (const bar of tab.bars) {
            const column = document.createElement("div");
            column.className = "admin-column";
            column.setAttribute("role", "listitem");
            column.tabIndex = 0;
            const text = `${formatBarLabel(bar.label, tab.id)}: ${formatValue(bar.value, tab.unit)}`;
            column.title = text;
            column.setAttribute("aria-label", text);
            const fill = document.createElement("span");
            fill.className = "admin-column-fill";
            fill.style.height = bar.value ? `${Math.max((bar.value / max) * 100, 2)}%` : "0";
            column.append(fill);
            plot.append(column);
        }
        const axis = document.createElement("div");
        axis.className = "admin-column-axis";
        axis.setAttribute("aria-hidden", "true");
        for (const bar of [tab.bars[0], tab.bars.at(-1)]) {
            const tick = document.createElement("span");
            tick.textContent = formatBarLabel(bar.label, tab.id);
            axis.append(tick);
        }
        figure.append(caption, plot, axis);
        return figure;
    }

    // Horizontal bar chart built as a table, so it doubles as the accessible data view.
    function renderChart() {
        const tab = metrics.tabs.find((candidate) => candidate.id === selectedTabId) || metrics.tabs[0];
        const chart = $("#admin-chart");
        chart.setAttribute("aria-labelledby", `admin-chart-tab-${tab.id}`);
        const total = tab.bars.reduce((sum, bar) => sum + bar.value, 0);
        if (!tab.bars.length || total === 0) {
            const empty = document.createElement("p");
            empty.className = "admin-chart-empty";
            empty.textContent = `No ${tab.title.toLowerCase()} data in the last ${metrics.days} days yet.`;
            chart.replaceChildren(empty);
            return;
        }
        const max = Math.max(...tab.bars.map((bar) => bar.value));
        if (DAILY_TABS.has(tab.id)) {
            chart.replaceChildren(buildColumnChart(tab, max));
            return;
        }
        const table = document.createElement("table");
        table.className = "admin-bar-chart";
        const caption = document.createElement("caption");
        caption.textContent = `${tab.title}, last ${metrics.days} days`;
        table.append(caption);
        const body = document.createElement("tbody");
        for (const bar of tab.bars) {
            const row = document.createElement("tr");
            const label = document.createElement("th");
            label.scope = "row";
            label.textContent = formatBarLabel(bar.label, tab.id);
            const barCell = document.createElement("td");
            barCell.className = "admin-bar-cell";
            const fill = document.createElement("span");
            fill.className = "admin-bar";
            // Width via CSSOM is allowed by the style-src 'self' CSP.
            fill.style.width = bar.value ? `${Math.max((bar.value / max) * 100, 1.5)}%` : "0";
            const share = total ? Math.round((bar.value / total) * 100) : 0;
            row.title = `${label.textContent}: ${formatValue(bar.value, tab.unit)} (${share}%)`;
            barCell.append(fill);
            const value = document.createElement("td");
            value.className = "admin-bar-value";
            value.textContent = formatValue(bar.value, tab.unit);
            row.append(label, barCell, value);
            body.append(row);
        }
        table.append(body);
        chart.replaceChildren(table);
    }

    async function loadMetrics() {
        requestController?.abort();
        requestController = new AbortController();
        const days = $("#admin-dashboard-days").value;
        $("#admin-dashboard-status").textContent = "Loading…";
        try {
            const response = await fetch(`/api/admin/metrics?days=${encodeURIComponent(days)}`, {
                credentials: "same-origin",
                signal: requestController.signal
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(result.error || "The dashboard could not be loaded.");
            metrics = result;
            renderKpis();
            renderTabs();
            renderChart();
            const updated = new Date(result.generatedAt).toLocaleTimeString("en-PH", {
                hour: "numeric",
                minute: "2-digit"
            });
            $("#admin-dashboard-status").textContent = `Updated ${updated}.`;
        } catch (error) {
            if (error.name === "AbortError") return;
            $("#admin-dashboard-status").textContent = `Could not load the dashboard: ${error.message}`;
        }
    }

    function start(role) {
        if (role !== "admin" || started) return;
        started = true;
        loadMetrics();
    }

    $("#admin-dashboard-days").addEventListener("change", loadMetrics);
    // Arrow keys move between tabs (WAI-ARIA tabs pattern).
    $("#admin-chart-tabs").addEventListener("keydown", (event) => {
        if (!metrics || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const ids = metrics.tabs.map((tab) => tab.id);
        const index = ids.indexOf(selectedTabId);
        const next =
            event.key === "Home"
                ? 0
                : event.key === "End"
                  ? ids.length - 1
                  : (index + (event.key === "ArrowRight" ? 1 : -1) + ids.length) % ids.length;
        selectTab(ids[next], true);
    });
    $("#admin-refresh-button").addEventListener("click", () => {
        if (started) loadMetrics();
    });
    document.addEventListener("coffeelab:signed-in", (event) => start(event.detail?.role));
    // The signed-in event may have fired before this script loaded.
    if (window.CoffeeLabSession) start(window.CoffeeLabSession.role);
})();
