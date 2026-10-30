const SHOP_TIME_ZONE = "Asia/Manila";
const PAGE_SIZE = 1000;
const COLUMNS = [
    "Date (Manila)",
    "Tracking code",
    "Status",
    "Pickup or delivery",
    "Payment",
    "Cash collected",
    "Drinks",
    "Drink names",
    "Total (PHP)"
];

// Spreadsheet apps run cells that start with = + - @ (or tab/CR) as formulas;
// a leading apostrophe keeps them as plain text.
function csvCell(value) {
    let text = value === null || value === undefined ? "" : String(value);
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function formatManilaTime(isoTimestamp) {
    // sv-SE gives "YYYY-MM-DD HH:MM", which spreadsheets sort and parse well.
    return new Intl.DateTimeFormat("sv-SE", {
        timeZone: SHOP_TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
    }).format(new Date(isoTimestamp));
}

/** Business data only: no customer names, phone numbers or addresses. */
function ordersToCsv(orders) {
    const rows = orders.map((order) => {
        const items = order.order_items || [];
        return [
            formatManilaTime(order.created_at),
            order.tracking_code,
            order.status,
            order.fulfillment_method,
            order.payment_method || "cash",
            order.cash_collected_at ? "yes" : "no",
            items.length,
            items.map((item) => item.name || item.classification).join("; "),
            ((Number(order.pricing?.total_cents) || 0) / 100).toFixed(2)
        ]
            .map(csvCell)
            .join(",");
    });
    // The BOM makes Excel read the file as UTF-8 (for names like "Café").
    return `\uFEFF${[COLUMNS.map(csvCell).join(","), ...rows].join("\r\n")}\r\n`;
}

async function fetchOrdersForExport(supabase, { days, now = new Date() }) {
    const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
    const orders = [];
    for (let from = 0; ; from += PAGE_SIZE) {
        const { data, error } = await supabase
            .from("orders")
            .select(
                "created_at, tracking_code, status, fulfillment_method, payment_method, cash_collected_at, pricing, order_items(name, classification)"
            )
            .gte("created_at", since)
            .order("created_at", { ascending: false })
            .range(from, from + PAGE_SIZE - 1);
        if (error) throw error;
        orders.push(...data);
        if (data.length < PAGE_SIZE) return orders;
    }
}

module.exports = { csvCell, ordersToCsv, fetchOrdersForExport };
