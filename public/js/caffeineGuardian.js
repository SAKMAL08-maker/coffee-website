// Network helpers for the caffeine guardian (/api/caffeine). UI wiring lives in app.js.
// The server decides totals and suggestions; the browser only displays them.
(() => {
    const CHECK_DEBOUNCE_MS = 400;

    /**
     * Debounced checker: call schedule({ configuration, basket }) on every drink or basket change.
     * onResult(result) gets the latest answer; onUnavailable() fires when the
     * customer isn't signed in (401) or the check fails, so the panel can hide.
     * No cache on purpose: today's total changes after every order.
     */
    function createCaffeineChecker(onResult, onUnavailable) {
        let timer = null;
        let controller = null;
        let latestRequestId = 0;

        function schedule(checkRequest) {
            clearTimeout(timer);
            timer = setTimeout(() => run(checkRequest), CHECK_DEBOUNCE_MS);
        }

        async function run(checkRequest) {
            controller?.abort();
            controller = new AbortController();
            const requestId = ++latestRequestId;
            try {
                const response = await fetch("/api/caffeine/check", {
                    method: "POST",
                    credentials: "same-origin",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(checkRequest),
                    signal: controller.signal
                });
                if (requestId !== latestRequestId) return;
                if (!response.ok) {
                    onUnavailable(response.status);
                    return;
                }
                onResult(await response.json());
            } catch (error) {
                if (error.name !== "AbortError" && requestId === latestRequestId) onUnavailable(0);
            }
        }

        return { schedule, checkNow: run };
    }

    /** cutoffTime is "HH:MM" or null (clears it). Resolves to the saved value. */
    async function saveCutoffTime(cutoffTime) {
        const response = await fetch("/api/caffeine/settings", {
            method: "PUT",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ cutoffTime })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || `Could not save cutoff (${response.status}).`);
        return result.cutoffTime;
    }

    window.CoffeeLabCaffeine = { createCaffeineChecker, saveCutoffTime };
})();
