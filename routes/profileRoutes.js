const express = require("express");
const profileController = require("../controllers/profileController");
const { authenticate } = require("../middleware/authenticate");
const { validateRequest } = require("../middleware/validateRequest");
const schemas = require("../schemas/requestSchemas");
const { profileReadLimiter, profileWriteLimiter, avatarReadLimiter } = require("../middleware/rateLimiters");
const { MAX_AVATAR_BYTES } = require("../services/avatarStorage");

const router = express.Router();

// The picture arrives as raw bytes (the browser resizes it first); its real type is checked from content.
const readImageBody = express.raw({ type: ["image/jpeg", "image/png", "image/webp"], limit: MAX_AVATAR_BYTES });

router.get("/", profileReadLimiter, validateRequest(schemas.empty), authenticate, profileController.getProfile);
router.patch(
    "/",
    profileWriteLimiter,
    validateRequest(schemas.profileUpdate),
    authenticate,
    profileController.updateProfile
);
router.put(
    "/avatar",
    profileWriteLimiter,
    validateRequest(schemas.empty),
    authenticate,
    readImageBody,
    profileController.uploadAvatar
);
router.delete(
    "/avatar",
    profileWriteLimiter,
    validateRequest(schemas.empty),
    authenticate,
    profileController.deleteAvatar
);
router.get(
    "/avatar/:userId",
    avatarReadLimiter,
    validateRequest(schemas.avatar),
    authenticate,
    profileController.showAvatar
);

module.exports = router;
