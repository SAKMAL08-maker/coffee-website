function getManilaDayWindow(now = new Date()) {
    const shifted = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    shifted.setUTCHours(0, 0, 0, 0);
    const start = new Date(shifted.getTime() - 8 * 60 * 60 * 1000);
    return { start: start.toISOString(), end: new Date(start.getTime() + 24 * 60 * 60 * 1000).toISOString() };
}

function sumCaffeineMg(orders) {
    return (orders || []).reduce((total, order) => {
        return total + (order.order_items || []).reduce((orderTotal, item) => {
            const amount = Number(item.nutrition?.caffeineMg);
            return orderTotal + (Number.isFinite(amount) && amount > 0 ? amount : 0);
        }, 0);
    }, 0);
}

function isAfterCutoff(cutoffTime, now = new Date()) {
    if (typeof cutoffTime !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(cutoffTime)) return false;
    const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Manila",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23"
    }).formatToParts(now);
    const hour = parts.find((part) => part.type === "hour")?.value || "00";
    const minute = parts.find((part) => part.type === "minute")?.value || "00";
    return `${hour}:${minute}` >= cutoffTime;
}

module.exports = { getManilaDayWindow, sumCaffeineMg, isAfterCutoff };
