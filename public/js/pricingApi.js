// Fetches price quotes from the server (POST /api/orders/quote).
//
// The customizer re-renders on every slider movement, so calling the server on
// each render would flood it. Instead each "scheduler" below:
//   - waits until input has been quiet for QUOTE_DEBOUNCE_MS before asking,
//   - aborts the previous in-flight request when a newer one starts,
//   - only ever delivers the newest answer (older responses are ignored),
//   - answers instantly from a small cache when the same quote was seen before.
window.CoffeeLabQuotes = (() => {
    const QUOTE_ENDPOINT = "/api/orders/quote";
    const QUOTE_DEBOUNCE_MS = 200;
    const MAX_CACHED_QUOTES = 50;

    // Map keeps insertion order, so deleting the first key evicts the oldest entry.
    const quoteCache = new Map();

    function rememberQuote(cacheKey, quote) {
        quoteCache.delete(cacheKey);
        quoteCache.set(cacheKey, quote);
        if (quoteCache.size > MAX_CACHED_QUOTES) quoteCache.delete(quoteCache.keys().next().value);
    }

    async function fetchOrderQuote(quoteRequest, abortSignal) {
        const requestBody = JSON.stringify(quoteRequest);
        if (quoteCache.has(requestBody)) return quoteCache.get(requestBody);

        const response = await fetch(QUOTE_ENDPOINT, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: requestBody,
            signal: abortSignal
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || `Price quote failed (${response.status}).`);
        rememberQuote(requestBody, result);
        return result;
    }

    /**
     * Returns `scheduleQuote(quoteRequest)`. Pass `null` when there is nothing to
     * price (e.g. an empty cart); `onQuote(null)` is then called immediately.
     */
    function createQuoteScheduler(onQuote, onError) {
        let debounceTimer = null;
        let inFlightController = null;
        let latestRequestId = 0;

        function cancelPending() {
            window.clearTimeout(debounceTimer);
            if (inFlightController) inFlightController.abort();
            inFlightController = null;
        }

        return function scheduleQuote(quoteRequest) {
            const requestId = ++latestRequestId;
            cancelPending();
            if (!quoteRequest) {
                onQuote(null);
                return;
            }
            const cachedQuote = quoteCache.get(JSON.stringify(quoteRequest));
            if (cachedQuote) {
                onQuote(cachedQuote);
                return;
            }
            debounceTimer = window.setTimeout(async () => {
                inFlightController = new AbortController();
                try {
                    const quote = await fetchOrderQuote(quoteRequest, inFlightController.signal);
                    if (requestId === latestRequestId) onQuote(quote);
                } catch (error) {
                    if (error.name !== "AbortError" && requestId === latestRequestId) onError(error);
                }
            }, QUOTE_DEBOUNCE_MS);
        };
    }

    return { createQuoteScheduler };
})();
