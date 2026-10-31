const test = require("node:test");
const assert = require("node:assert/strict");
const {
    cleanBio,
    avatarUrl,
    getProfile,
    updateBio,
    replaceAvatar,
    loadStaffStats
} = require("../services/profileService");
const { detectImageType } = require("../services/avatarStorage");
const { recordOrderEvent, EVENT_FOR_STATUS } = require("../services/orderEvents");

const account = {
    id: "8a6f7f2e-1c1e-4c2a-9d63-6f0f3d4c1a11",
    username: "juan_dc",
    role: "customer",
    created_at: "2026-10-01T00:00:00Z",
    bio: "Oat milk forever.",
    avatar_object_key: null,
    avatar_updated_at: null
};

// Minimal stand-in for the Supabase client: records calls, answers from `answers`.
function fakeSupabase(answers = {}) {
    const calls = [];
    const query = (table) => {
        const state = { table, filters: [], update: null };
        const builder = {
            select: () => builder,
            eq: (column, value) => {
                state.filters.push([column, value]);
                return builder;
            },
            update: (values) => {
                state.update = values;
                return builder;
            },
            insert: async (values) => {
                calls.push({ insert: table, values });
                return answers.insert || { error: null };
            },
            maybeSingle: async () => {
                calls.push(state);
                if (state.update) return { data: { ...account, ...state.update }, error: null };
                return { data: answers.account === undefined ? account : answers.account, error: null };
            }
        };
        return builder;
    };
    const rpc = (name, args) => {
        calls.push({ rpc: name, args });
        const result = answers.rpc?.[name] || { data: null, error: null };
        const promise = Promise.resolve(result);
        promise.maybeSingle = () => Promise.resolve(result);
        return promise;
    };
    return { from: query, rpc, calls };
}

test("bios are trimmed, cleaned of control characters, and capped at 280 characters", () => {
    assert.equal(cleanBio("  Hello\u0007 there \n\n\n\nfriend  "), "Hello there \n\nfriend");
    assert.equal(cleanBio("   "), null);
    assert.equal(cleanBio("x".repeat(280)).length, 280);
    assert.throws(() => cleanBio("x".repeat(281)), { statusCode: 400 });
});

test("profile pictures are identified by content, never by the claimed type", () => {
    assert.equal(detectImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])).mime, "image/jpeg");
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(8)]);
    assert.equal(detectImageType(png).mime, "image/png");
    assert.equal(detectImageType(Buffer.from("RIFF0000WEBPVP8 ")).mime, "image/webp");
    assert.equal(detectImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>')), null);
    assert.equal(detectImageType(Buffer.from("GIF89a000000")), null);
});

test("picture URLs change when the picture does, so they can be cached forever", () => {
    assert.equal(avatarUrl(account), null);
    const url = avatarUrl({
        ...account,
        avatar_object_key: "avatars/x/1.jpg",
        avatar_updated_at: "2026-10-31T00:00:00Z"
    });
    assert.equal(url, `/api/profile/avatar/${account.id}?v=${Date.parse("2026-10-31T00:00:00Z")}`);
});

test("uploads are rejected before storage unless they are a small JPEG, PNG or WebP", async () => {
    const supabase = fakeSupabase();
    await assert.rejects(replaceAvatar(supabase, account.id, Buffer.alloc(0)), { statusCode: 400 });
    await assert.rejects(replaceAvatar(supabase, account.id, Buffer.from("<svg></svg>")), { statusCode: 400 });
    const tooLarge = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(301 * 1024)]);
    await assert.rejects(replaceAvatar(supabase, account.id, tooLarge), /under 300 KB/);
    assert.equal(supabase.calls.length, 0, "nothing was read or written");
});

test("a customer's profile carries their stats and loyalty points", async () => {
    const supabase = fakeSupabase({
        rpc: {
            customer_profile_stats: {
                data: { orders: 3, drinks: 4, favorite: { name: "Vanilla Latte", times: 2 } },
                error: null
            },
            recipe_royalty_summary: { data: { earned_points: 30, pending_points: 10 }, error: null }
        }
    });
    const { profile, stats } = await getProfile(supabase, account.id);
    assert.equal(profile.username, "juan_dc");
    assert.equal(profile.bio, "Oat milk forever.");
    assert.equal(stats.kind, "customer");
    assert.equal(stats.favorite.name, "Vanilla Latte");
    assert.deepEqual(stats.points, { earned: 30, pending: 10 });
    assert.ok(!supabase.calls.some((call) => call.rpc === "staff_profile_stats"));
});

test("admins get their own work stats for the last 30 days and all time", async () => {
    const supabase = fakeSupabase({
        account: { ...account, role: "admin" },
        rpc: { staff_profile_stats: { data: { closed: { recent: 5, allTime: 40 } }, error: null } }
    });
    const { stats } = await getProfile(supabase, account.id);
    assert.equal(stats.kind, "staff");
    assert.equal(stats.recentDays, 30);
    assert.deepEqual(stats.closed, { recent: 5, allTime: 40 });
    const call = supabase.calls.find((entry) => entry.rpc === "staff_profile_stats");
    assert.equal(call.args.p_account_id, account.id);
    assert.ok(Date.parse(call.args.p_since) < Date.now() - 29 * 24 * 60 * 60 * 1000);
});

test("the profile still loads before the stats migration is applied", async () => {
    const missing = { data: null, error: { code: "PGRST202", message: "function not found" } };
    const supabase = fakeSupabase({ rpc: { staff_profile_stats: missing } });
    assert.equal(await loadStaffStats(supabase, account.id), null);
});

test("saving a bio only touches the signed-in account", async () => {
    const supabase = fakeSupabase();
    const profile = await updateBio(supabase, account.id, "  New bio  ");
    assert.equal(profile.bio, "New bio");
    const write = supabase.calls.find((call) => call.update);
    assert.deepEqual(write.filters, [["id", account.id]]);
    assert.deepEqual(Object.keys(write.update).sort(), ["bio", "updated_at"]);
});

test("order events never fail the order change they describe", async () => {
    const supabase = fakeSupabase({ insert: { error: { message: "relation does not exist" } } });
    const originalWarn = console.warn;
    console.warn = () => {};
    try {
        await recordOrderEvent(supabase, { orderId: "o1", actorId: "a1", action: "closed" });
    } finally {
        console.warn = originalWarn;
    }
    assert.equal(supabase.calls[0].values.action, "closed");
    assert.equal(EVENT_FOR_STATUS.Crafting, "accepted");
    assert.equal(EVENT_FOR_STATUS.Received, undefined);
});
