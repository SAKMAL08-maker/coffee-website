const { getAdminClient } = require("../config/supabase");
const {
    publishRecipe,
    getPublishedRecipe,
    unpublishRecipe,
    listCreatorRecipes
} = require("../services/communityRecipeService");
const { buildRecipeShareUrl, createRecipeQrSvg } = require("../services/recipeQrCode");

function getRequestOrigin(request) {
    return `${request.protocol}://${request.get("host")}`;
}

function withShareLinks(request, recipe) {
    const shareUrl = buildRecipeShareUrl(recipe.slug, getRequestOrigin(request));
    return { ...recipe, shareUrl, qrCodeUrl: `/api/recipes/${recipe.slug}/qr.svg` };
}

function notFound() {
    return Object.assign(new Error("Recipe not found."), { statusCode: 404 });
}

// Saves the current drink to the creator's coffees and makes it public in one step.
async function createPublishedRecipe(request, response, next) {
    try {
        const recipe = await publishRecipe(getAdminClient(), request.user.id, request.body);
        response.status(201).json({ recipe: withShareLinks(request, recipe) });
    } catch (error) {
        next(error);
    }
}

async function showPublishedRecipe(request, response, next) {
    try {
        const recipe = await getPublishedRecipe(getAdminClient(), request.params.slug);
        if (!recipe) throw notFound();
        // private: the share URL may come from the Host header, so shared caches must not store it.
        response.set("Cache-Control", "private, max-age=60");
        response.json({ recipe: withShareLinks(request, recipe) });
    } catch (error) {
        next(error);
    }
}

// SVG QR code pointing at /?recipe=<slug>. Only issued for recipes that exist,
// so the endpoint can't be used as a free QR generator for arbitrary links.
async function showRecipeQrCode(request, response, next) {
    try {
        const recipe = await getPublishedRecipe(getAdminClient(), request.params.slug);
        if (!recipe) throw notFound();
        response.set("Cache-Control", "private, max-age=3600");
        response.type("image/svg+xml").send(createRecipeQrSvg(withShareLinks(request, recipe).shareUrl));
    } catch (error) {
        next(error);
    }
}

async function deletePublishedRecipe(request, response, next) {
    try {
        const unpublished = await unpublishRecipe(getAdminClient(), request.user.id, request.params.slug);
        if (!unpublished) throw notFound();
        response.json({ unpublished: true });
    } catch (error) {
        next(error);
    }
}

async function listMyRecipes(request, response, next) {
    try {
        const { recipes, royalties } = await listCreatorRecipes(getAdminClient(), request.user.id);
        response.set("Cache-Control", "no-store");
        response.json({ recipes: recipes.map((recipe) => withShareLinks(request, recipe)), royalties });
    } catch (error) {
        next(error);
    }
}

module.exports = {
    createPublishedRecipe,
    showPublishedRecipe,
    showRecipeQrCode,
    deletePublishedRecipe,
    listMyRecipes
};
