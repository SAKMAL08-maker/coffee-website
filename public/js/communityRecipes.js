// Network helpers for community recipes (/api/recipes). UI wiring lives in app.js.
// Royalties are decided on the server; the browser only says which recipe a drink came from.
(() => {
    const RECIPE_SLUG_PATTERN = /^[A-Za-z0-9]{10}$/;

    async function requestJson(url, options = {}) {
        const response = await fetch(url, { credentials: "same-origin", ...options });
        let result = {};
        try {
            result = await response.json();
        } catch {
            // Fall through to the status-based message below.
        }
        if (!response.ok) throw new Error(result.error || `Recipe request failed (${response.status}).`);
        return result;
    }

    /** Slug from a shared link (/?recipe=<slug>), or null when absent or malformed. */
    function readSharedRecipeSlug() {
        const slug = new URLSearchParams(window.location.search).get("recipe");
        return slug && RECIPE_SLUG_PATTERN.test(slug) ? slug : null;
    }

    /** Removes ?recipe= so a refresh doesn't re-apply the shared drink over the customer's edits. */
    function clearSharedRecipeSlug() {
        const url = new URL(window.location.href);
        if (!url.searchParams.has("recipe")) return;
        url.searchParams.delete("recipe");
        window.history.replaceState(window.history.state, "", url);
    }

    async function fetchSharedRecipe(slug) {
        const { recipe } = await requestJson(`/api/recipes/${encodeURIComponent(slug)}`);
        return recipe;
    }

    async function publishRecipe(name, configuration) {
        const { recipe } = await requestJson("/api/recipes", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, configuration })
        });
        return recipe;
    }

    function fetchMyRecipes() {
        return requestJson("/api/recipes/mine");
    }

    function unpublishRecipe(slug) {
        return requestJson(`/api/recipes/${encodeURIComponent(slug)}`, { method: "DELETE" });
    }

    window.CoffeeLabRecipes = {
        readSharedRecipeSlug,
        clearSharedRecipeSlug,
        fetchSharedRecipe,
        publishRecipe,
        fetchMyRecipes,
        unpublishRecipe
    };
})();
