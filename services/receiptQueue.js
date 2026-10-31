/**
 * Receipts are made after the response, not during checkout. Building the PDF and image and
 * uploading both to B2 takes a second or more; the customer shouldn't wait for it. The order is
 * saved with receipt_status "pending", the tracking page shows "Preparing your receipt…", and its
 * status poll picks up "available" a moment later.
 *
 * In-process queue: at most 2 receipts at a time, 3 attempts each (createOrderReceipt marks the
 * order "failed" between attempts, so the existing "Try receipt again" button still works). If the
 * server restarts mid-queue, the sweeper finds orders still "pending" and queues them again.
 * One server instance is assumed; with several, the sweeper may build a receipt twice (harmless:
 * the last upload wins). A real job queue (pg-boss, or a Supabase queue) replaces this at that size.
 */
const { getAdminClient } = require("../config/supabase");
const { createOrderReceipt } = require("./receiptService");

const CONCURRENCY = 2;
const RETRY_DELAYS_MS = [2000, 10000];
const SWEEP_EVERY_MS = 5 * 60 * 1000;
// Orders younger than this are still in the queue; older "pending" ones were lost to a restart.
const SWEEP_MIN_AGE_MS = 2 * 60 * 1000;
const SWEEP_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const waiting = [];
// orderId → true when a newer request arrived while it was being built (e.g. cash collected).
const inFlight = new Map();
let running = 0;
let make = createOrderReceipt;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms).unref?.());

async function build(orderId) {
    for (let attempt = 0; ; attempt += 1) {
        try {
            return await make(orderId);
        } catch (error) {
            if (attempt >= RETRY_DELAYS_MS.length) {
                console.error("Receipt could not be made:", { orderId, attempts: attempt + 1, error: error.message });
                return "failed";
            }
            await wait(RETRY_DELAYS_MS[attempt]);
        }
    }
}

function pump() {
    while (running < CONCURRENCY && waiting.length) {
        const orderId = waiting.shift();
        running += 1;
        inFlight.set(orderId, false);
        build(orderId).finally(() => {
            const again = inFlight.get(orderId);
            inFlight.delete(orderId);
            running -= 1;
            if (again) enqueueReceipt(orderId);
            pump();
        });
    }
}

/** Queue a receipt build. Repeated calls for one order collapse; one made mid-build reruns it after. */
function enqueueReceipt(orderId) {
    if (inFlight.has(orderId)) inFlight.set(orderId, true);
    else if (!waiting.includes(orderId)) waiting.push(orderId);
    pump();
}

/** Re-queue signed-in customers' receipts left "pending" (by a restart) in the last day. */
async function sweepPendingReceipts(supabase = getAdminClient()) {
    const now = Date.now();
    const { data, error } = await supabase
        .from("orders")
        .select("id")
        .eq("receipt_status", "pending")
        .not("account_id", "is", null)
        .neq("status", "Cancelled")
        .lt("created_at", new Date(now - SWEEP_MIN_AGE_MS).toISOString())
        .gt("created_at", new Date(now - SWEEP_MAX_AGE_MS).toISOString())
        .limit(25);
    if (error) throw error;
    (data || []).forEach((order) => enqueueReceipt(order.id));
    return (data || []).length;
}

function startReceiptSweeper() {
    const sweep = () =>
        sweepPendingReceipts().catch((error) => console.error("Receipt sweep failed:", { error: error.message }));
    sweep();
    return setInterval(sweep, SWEEP_EVERY_MS).unref();
}

/** Tests only: replace the builder and wait for the queue to drain. */
const forTests = {
    setBuilder(fn) {
        make = fn || createOrderReceipt;
    },
    async drain() {
        while (running || waiting.length) await new Promise((resolve) => setImmediate(resolve));
    }
};

module.exports = { enqueueReceipt, sweepPendingReceipts, startReceiptSweeper, forTests };
