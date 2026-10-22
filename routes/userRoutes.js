const express = require("express");
const userController = require("../controllers/userController");
const { authenticate } = require("../middleware/authenticate");

const router = express.Router();

router.post("/signup", userController.signUp);
router.post("/login", userController.logIn);
router.get("/me", authenticate, userController.getCurrentUser);
router.post("/logout", authenticate, userController.logOut);
router.get("/saved-bar", authenticate, userController.listSavedBar);
router.post("/saved-bar", authenticate, userController.addSavedRecipe);
router.delete("/saved-bar/:recipeId", authenticate, userController.removeSavedRecipe);

module.exports = router;
