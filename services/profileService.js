/**
 * Profiles for every signed-in account: bio, picture, and the account's own statistics
 * (customer: orders, favourite drink, points; admin/staff: orders accepted, closed, cash).
 * Statistics are computed in Postgres (customer_profile_stats / staff_profile_stats).
 */
const { getLoyaltyBalance } = require("./loyaltyService");
const { MAX_AVATAR_BYTES, detectImageType, uploadAvatar, deleteAvatar } = require("./avatarStorage");

const BIO_MAX_LENGTH = 280;
const STAFF_RECENT_DAYS = 30;
const STAFF_ROLES = Object.freeze(["staff", "admin", "superadmin"]);
const PROFILE_COLUMNS = "id, username, role, created_at, bio, avatar_object_key, avatar_updated_at";

function httpError(statusCode, message) {
    return Object.assign(new Error(message), { statusCode });
}

/** Trims, drops control characters (newlines stay) and caps blank lines at one. */
function cleanBio(value) {
    const text = String(value ?? "")
        .replace(/\r\n?/g, "\n")
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    if (text.length > BIO_MAX_LENGTH) throw httpError(400, `Keep your bio to ${BIO_MAX_LENGTH} characters.`);
    return text || null;
}

/** Versioned, so the browser can cache a picture forever and still see a new one at once. */
function avatarUrl(account) {
    if (!account.avatar_object_key) return null;
    const version = Date.parse(account.avatar_updated_at) || 0;
    return `/api/profile/avatar/${account.id}?v=${version}`;
}

function toPublicProfile(account) {
    return {
        id: account.id,
        username: account.username,
        role: account.role,
        memberSince: account.created_at,
        bio: account.bio || "",
        avatarUrl: avatarUrl(account)
    };
}

// PGRST202: the stats function isn't there yet (migration not applied); the profile still loads.
function isMissingFunction(error) {
    return error?.code === "PGRST202";
}

async function loadCustomerStats(supabase, accountId) {
    const [stats, points] = await Promise.all([
        supabase.rpc("customer_profile_stats", { p_account_id: accountId }),
        getLoyaltyBalance(supabase, accountId)
    ]);
    if (stats.error && !isMissingFunction(stats.error)) throw stats.error;
    if (stats.error) return null;
    return { kind: "customer", ...stats.data, points };
}

async function loadStaffStats(supabase, accountId, now = new Date()) {
    const since = new Date(now.getTime() - STAFF_RECENT_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase.rpc("staff_profile_stats", { p_account_id: accountId, p_since: since });
    if (error && !isMissingFunction(error)) throw error;
    if (error) return null;
    return { kind: "staff", recentDays: STAFF_RECENT_DAYS, ...data };
}

async function findAccount(supabase, accountId) {
    const { data, error } = await supabase
        .from("coffee_users")
        .select(PROFILE_COLUMNS)
        .eq("id", accountId)
        .maybeSingle();
    if (error) throw error;
    if (!data) throw httpError(404, "Your account was not found.");
    return data;
}

async function getProfile(supabase, accountId) {
    const account = await findAccount(supabase, accountId);
    const stats = STAFF_ROLES.includes(account.role)
        ? await loadStaffStats(supabase, account.id)
        : await loadCustomerStats(supabase, account.id);
    return { profile: toPublicProfile(account), stats };
}

async function updateBio(supabase, accountId, bio) {
    const { data, error } = await supabase
        .from("coffee_users")
        .update({ bio: cleanBio(bio), updated_at: new Date().toISOString() })
        .eq("id", accountId)
        .select(PROFILE_COLUMNS)
        .maybeSingle();
    if (error) throw error;
    if (!data) throw httpError(404, "Your account was not found.");
    return toPublicProfile(data);
}

async function replaceAvatar(supabase, accountId, buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
        throw httpError(400, "Choose a JPEG, PNG or WebP picture.");
    }
    if (buffer.length > MAX_AVATAR_BYTES) throw httpError(400, "That picture is too large; choose one under 300 KB.");
    const type = detectImageType(buffer);
    if (!type) throw httpError(400, "Choose a JPEG, PNG or WebP picture.");

    const previous = await findAccount(supabase, accountId);
    const objectKey = await uploadAvatar(accountId, buffer, type);
    const { data, error } = await supabase
        .from("coffee_users")
        .update({ avatar_object_key: objectKey, avatar_updated_at: new Date().toISOString() })
        .eq("id", accountId)
        .select(PROFILE_COLUMNS)
        .maybeSingle();
    if (error) {
        await deleteAvatar(objectKey).catch(() => {});
        throw error;
    }
    await deleteAvatar(previous.avatar_object_key).catch((deleteError) =>
        console.warn("Old profile picture was not deleted:", deleteError.message)
    );
    return toPublicProfile(data);
}

async function removeAvatar(supabase, accountId) {
    const previous = await findAccount(supabase, accountId);
    const { data, error } = await supabase
        .from("coffee_users")
        .update({ avatar_object_key: null, avatar_updated_at: new Date().toISOString() })
        .eq("id", accountId)
        .select(PROFILE_COLUMNS)
        .maybeSingle();
    if (error) throw error;
    await deleteAvatar(previous.avatar_object_key).catch((deleteError) =>
        console.warn("Removed profile picture was not deleted from storage:", deleteError.message)
    );
    return toPublicProfile(data);
}

async function findAvatarKey(supabase, accountId) {
    const { data, error } = await supabase
        .from("coffee_users")
        .select("avatar_object_key")
        .eq("id", accountId)
        .maybeSingle();
    if (error) throw error;
    return data?.avatar_object_key || null;
}

module.exports = {
    BIO_MAX_LENGTH,
    cleanBio,
    avatarUrl,
    getProfile,
    loadCustomerStats,
    loadStaffStats,
    updateBio,
    replaceAvatar,
    removeAvatar,
    findAvatarKey
};
