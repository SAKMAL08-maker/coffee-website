const express = require("express");
const userController = require("../controllers/userController");
const { authenticate } = require("../middleware/authenticate");
const { validateRequest } = require("../middleware/validateRequest");
const schemas = require("../schemas/requestSchemas");
const { authLimiter, savedWriteLimiter } = require("../middleware/rateLimiters");

const router = express.Router();

router.post("/signup", authLimiter, validateRequest(schemas.signup), userController.signUp);
router.post("/login", authLimiter, validateRequest(schemas.login), userController.logIn);
router.get("/me", validateRequest(schemas.empty), authenticate, userController.getCurrentUser);
router.post("/logout", validateRequest(schemas.logout), authenticate, userController.logOut);
router.get("/saved-bar", validateRequest(schemas.empty), authenticate, userController.listSavedBar);
router.post("/saved-bar", savedWriteLimiter, validateRequest(schemas.savedRecipe), authenticate, userController.addSavedRecipe);
router.delete("/saved-bar/:recipeId", savedWriteLimiter, validateRequest(schemas.recipeId), authenticate, userController.removeSavedRecipe);

module.exports = router;
