(() => {
    const $ = (selector) => document.querySelector(selector);
    let isStarted = false;

    async function requestSummary() {
        const summary = $("#caffeine-guardian-summary");
        try {
            const response = await fetch("/api/users/caffeine-guardian", { credentials: "same-origin" });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || "Could not load caffeine information.");
            $("#caffeine-cutoff-time").value = result.caffeineCutoffTime || "";
            summary.textContent = `Today's estimated total: ${result.dailyCaffeineMg} mg caffeine.`;
            const halfCafButton = $("#half-caf-suggestion");
            const isAlreadyHalfCaf = document.querySelector('[data-choice-group="caffeineMode"] [data-value="half"]')?.getAttribute("aria-pressed") === "true";
            halfCafButton.hidden = !result.shouldSuggestHalfCaf || isAlreadyHalfCaf;
            if (result.shouldSuggestHalfCaf) summary.textContent += " Your cutoff time has passed; consider half-caf for your next drink.";
        } catch (error) {
            summary.textContent = `Caffeine guardian unavailable: ${error.message}`;
        }
    }

    async function saveCutoff() {
        const button = $("#save-caffeine-cutoff");
        const value = $("#caffeine-cutoff-time").value || null;
        button.disabled = true;
        try {
            const response = await fetch("/api/users/caffeine-guardian", {
                method: "PATCH",
                credentials: "same-origin",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ caffeineCutoffTime: value })
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || "Could not save cutoff time.");
            $("#caffeine-guardian-summary").textContent = value
                ? `Caffeine cutoff saved for ${value} (Manila time).`
                : "Caffeine cutoff disabled.";
            await requestSummary();
        } catch (error) {
            $("#caffeine-guardian-summary").textContent = `Could not save cutoff: ${error.message}`;
        } finally {
            button.disabled = false;
        }
    }

    function start() {
        if (isStarted) {
            requestSummary();
            return;
        }
        isStarted = true;
        $("#save-caffeine-cutoff").addEventListener("click", saveCutoff);
        $("#half-caf-suggestion").addEventListener("click", () => {
            const halfCaf = document.querySelector('[data-choice-group="caffeineMode"] [data-value="half"]');
            if (halfCaf) halfCaf.click();
            $("#half-caf-suggestion").hidden = true;
            $("#caffeine-guardian-summary").textContent = "Half-caf selected for your current drink.";
        });
        requestSummary();
    }

    window.CoffeeLabCaffeineGuardian = { start };
})();
