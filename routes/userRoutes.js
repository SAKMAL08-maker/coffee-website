const express = require("express");
const userController = require("../controllers/userController");
const { authenticate } = require("../middleware/authenticate");
const { validateRequest } = require("../middleware/validateRequest");
const schemas = require("../schemas/requestSchemas");
const {
    authLimiter,
    adminMfaLimiter,
    adminMfaEnrollLimiter,
    savedWriteLimiter
} = require("../middleware/rateLimiters");

const router = express.Router();

router.post("/signup", authLimiter, validateRequest(schemas.signup), userController.signUp);
router.post("/login", authLimiter, validateRequest(schemas.login), userController.logIn);
router.get("/me", validateRequest(schemas.empty), authenticate, userController.getCurrentUser);
router.post("/logout", validateRequest(schemas.logout), userController.logOut);
router.post(
    "/admin/mfa/enroll",
    adminMfaEnrollLimiter,
    validateRequest(schemas.adminMfaEnroll),
    userController.enrollAdminMfa
);
router.post(
    "/admin/mfa/verify",
    adminMfaLimiter,
    validateRequest(schemas.adminMfaVerify),
    userController.verifyAdminMfa
);
router.post("/password/reset", authLimiter, validateRequest(schemas.resetPassword), userController.resetPassword);
router.get("/saved-bar", validateRequest(schemas.empty), authenticate, userController.listSavedBar);
router.post(
    "/saved-bar",
    savedWriteLimiter,
    validateRequest(schemas.savedRecipe),
    authenticate,
    userController.addSavedRecipe
);
router.delete(
    "/saved-bar/:recipeId",
    savedWriteLimiter,
    validateRequest(schemas.recipeId),
    authenticate,
    userController.removeSavedRecipe
);

module.exports = router;
