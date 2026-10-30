const express = require("express");
const recipeController = require("../controllers/recipeController");
const { authenticate } = require("../middleware/authenticate");
const { validateRequest } = require("../middleware/validateRequest");
const schemas = require("../schemas/requestSchemas");
const { savedWriteLimiter, recipeReadLimiter } = require("../middleware/rateLimiters");

const router = express.Router();

router.post(
    "/",
    savedWriteLimiter,
    validateRequest(schemas.publishRecipe),
    authenticate,
    recipeController.createPublishedRecipe
);
// Declared before "/:slug" for clarity ("mine" also fails the slug pattern).
router.get(
    "/mine",
    recipeReadLimiter,
    validateRequest(schemas.myRecipes),
    authenticate,
    recipeController.listMyRecipes
);
router.get("/:slug", recipeReadLimiter, validateRequest(schemas.publicRecipe), recipeController.showPublishedRecipe);
router.get(
    "/:slug/qr.svg",
    recipeReadLimiter,
    validateRequest(schemas.publicRecipe),
    recipeController.showRecipeQrCode
);

// Owner-only; anyone else gets 404 so recipes owned by others are not revealed.
router.delete(
    "/:slug",
    savedWriteLimiter,
    validateRequest(schemas.publicRecipe),
    authenticate,
    recipeController.deletePublishedRecipe
);

module.exports = router;
