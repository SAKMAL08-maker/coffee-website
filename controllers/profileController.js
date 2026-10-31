const { getAdminClient } = require("../config/supabase");
const profileService = require("../services/profileService");
const { readAvatar } = require("../services/avatarStorage");

async function getProfile(request, response, next) {
    try {
        response.json(await profileService.getProfile(getAdminClient(), request.user.id));
    } catch (error) {
        next(error);
    }
}

async function updateProfile(request, response, next) {
    try {
        const profile = await profileService.updateBio(getAdminClient(), request.user.id, request.body.bio);
        response.json({ profile });
    } catch (error) {
        next(error);
    }
}

async function uploadAvatar(request, response, next) {
    try {
        const profile = await profileService.replaceAvatar(getAdminClient(), request.user.id, request.body);
        response.json({ profile });
    } catch (error) {
        next(error);
    }
}

async function deleteAvatar(request, response, next) {
    try {
        response.json({ profile: await profileService.removeAvatar(getAdminClient(), request.user.id) });
    } catch (error) {
        next(error);
    }
}

// Any signed-in account may see a picture: customers see the admins they chat with and vice versa.
async function showAvatar(request, response, next) {
    try {
        const objectKey = await profileService.findAvatarKey(getAdminClient(), request.params.userId);
        if (!objectKey) return response.status(404).json({ error: "No profile picture." });
        const avatar = await readAvatar(objectKey);
        response.set({
            "Content-Type": avatar.contentType,
            // The URL carries ?v=<updated time>, so a changed picture gets a new URL.
            "Cache-Control": "private, max-age=31536000, immutable"
        });
        avatar.body.on("error", next);
        avatar.body.pipe(response);
    } catch (error) {
        next(error);
    }
}

module.exports = { getProfile, updateProfile, uploadAvatar, deleteAvatar, showAvatar };
