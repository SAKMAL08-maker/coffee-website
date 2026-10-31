/**
 * Branches and sold-out switches.
 *
 * Every builder option a branch can run out of has a key, "group:value" (e.g. "milk:oat"). A row in
 * menu_sold_out means that option is sold out at that branch; no row means available. Admins flip
 * switches on the admin page's Menu tab; the builder greys sold-out options out, and checkout
 * refuses a drink that uses one (the browser is never trusted for this).
 *
 * Branch and sold-out lists are read on every builder load and checkout, so they're cached for a
 * few seconds per server; a switch flipped by an admin clears the cache on that server at once.
 */
const { BASES, MILKS, SYRUPS, SWEETENERS } = require("./coffeeService").MENU;
const { createTtlCache } = require("./ttlCache");

const CACHE_MS = 15 * 1000;
const branchCache = createTtlCache(CACHE_MS);
const soldOutCache = createTtlCache(CACHE_MS);
const BASES_WITH_MILK = ["espresso", "matcha"];
const TOPPINGS = { cinnamon: "Cinnamon", whippedCream: "Whipped cream", cocoa: "Cocoa dust" };
const SWEETENER_LABELS = { whiteSugar: "White sugar", rawSugar: "Raw sugar", honey: "Honey", stevia: "Stevia" };

/** Everything that can be switched off, in the order the Menu tab shows it. */
const MENU_OPTIONS = Object.freeze([
    ...Object.entries(BASES).map(([value, base]) => ({ key: `base:${value}`, group: "Bases", label: base.label })),
    { key: "beans:decaf", group: "Bases", label: "Decaf beans (decaf and half-caf)" },
    ...Object.entries(MILKS).map(([value, milk]) => ({ key: `milk:${value}`, group: "Milks", label: milk.label })),
    ...Object.entries(SYRUPS).map(([value, syrup]) => ({ key: `syrup:${value}`, group: "Syrups", label: syrup.label })),
    ...Object.keys(SWEETENERS).map((value) => ({
        key: `sweetener:${value}`,
        group: "Sweeteners",
        label: SWEETENER_LABELS[value] || value
    })),
    ...Object.entries(TOPPINGS).map(([value, label]) => ({ key: `topping:${value}`, group: "Toppings", label }))
]);
const OPTION_LABELS = new Map(MENU_OPTIONS.map((option) => [option.key, option.label]));

function httpError(statusCode, message) {
    return Object.assign(new Error(message), { statusCode });
}

function isMissingTable(error) {
    return ["42P01", "PGRST205"].includes(error?.code);
}

/** The option keys a (normalized) drink uses. Mirrors what the drink is actually made with. */
function optionsUsedBy(configuration) {
    const keys = [`base:${configuration.base}`];
    if (configuration.caffeineMode !== "regular") keys.push("beans:decaf");
    if (BASES_WITH_MILK.includes(configuration.base)) keys.push(`milk:${configuration.milk}`);
    for (const [name, pumps] of Object.entries(configuration.syrups || {})) if (pumps > 0) keys.push(`syrup:${name}`);
    for (const sweetener of configuration.sweeteners || []) keys.push(`sweetener:${sweetener}`);
    for (const [name, on] of Object.entries(configuration.toppings || {})) if (on) keys.push(`topping:${name}`);
    return keys;
}

function toBranch(row) {
    return {
        id: row.id,
        slug: row.slug,
        name: row.name,
        address: row.address,
        phone: row.phone,
        isActive: row.is_active
    };
}

/** All branches (cached). Empty before the migration is applied. */
async function listBranches(supabase) {
    return branchCache.get("all", async () => {
        const { data, error } = await supabase
            .from("branches")
            .select("id, slug, name, address, phone, is_active")
            .order("created_at", { ascending: true });
        if (error && isMissingTable(error)) return [];
        if (error) throw error;
        return data.map(toBranch);
    });
}

/**
 * The branch an order goes to. A customer picks one when there are several; with a single active
 * branch it's chosen for them. null before the migration (orders then carry no branch, as before).
 */
async function resolveOrderBranch(supabase, branchId) {
    const active = (await listBranches(supabase)).filter((branch) => branch.isActive);
    if (!active.length) return null;
    if (branchId) {
        const branch = active.find((candidate) => candidate.id === branchId);
        if (!branch) throw httpError(400, "That branch isn't taking orders. Choose another branch.");
        return branch;
    }
    if (active.length === 1) return active[0];
    throw httpError(400, "Choose which branch should make your order.");
}

/** Sold-out option keys at a branch (cached), as a Set. */
async function getSoldOut(supabase, branchId) {
    if (!branchId) return new Set();
    const keys = await soldOutCache.get(branchId, async () => {
        const { data, error } = await supabase.from("menu_sold_out").select("option_key").eq("branch_id", branchId);
        if (error && isMissingTable(error)) return [];
        if (error) throw error;
        return data.map((row) => row.option_key);
    });
    return new Set(keys);
}

/** 409 naming the first drink that uses something sold out at this branch. */
function assertAvailable(lineItems, soldOut, branch) {
    if (!soldOut.size) return;
    for (const item of lineItems) {
        const missing = optionsUsedBy(item.configuration).find((key) => soldOut.has(key));
        if (missing) {
            throw httpError(
                409,
                `${OPTION_LABELS.get(missing) || missing} is sold out at ${branch.name} right now, so "${item.name}" can't be made. Edit it in your basket or remove it.`
            );
        }
    }
}

async function setSoldOut(supabase, { branchId, option, soldOut, actorId }) {
    if (!OPTION_LABELS.has(option)) throw httpError(400, "Unknown menu option.");
    const branch = (await listBranches(supabase)).find((candidate) => candidate.id === branchId);
    if (!branch) throw httpError(404, "Branch not found.");
    const query = soldOut
        ? supabase.from("menu_sold_out").upsert({
              branch_id: branchId,
              option_key: option,
              marked_by: actorId,
              marked_at: new Date().toISOString()
          })
        : supabase.from("menu_sold_out").delete().eq("branch_id", branchId).eq("option_key", option);
    const { error } = await query;
    if (error) throw error;
    soldOutCache.clear();
}

function slugify(name) {
    return (
        name
            .toLowerCase()
            .normalize("NFKD")
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "")
            .slice(0, 40)
            .replace(/-+$/, "") || "branch"
    );
}

function cleanBranchFields({ name, address, phone }) {
    const fields = {};
    if (name !== undefined) fields.name = name.trim();
    if (address !== undefined) fields.address = address.trim() || null;
    if (phone !== undefined) fields.phone = phone.trim() || null;
    if (fields.name !== undefined && fields.name.length < 2) throw httpError(400, "A branch name needs 2+ characters.");
    return fields;
}

async function createBranch(supabase, input) {
    const fields = cleanBranchFields(input);
    const taken = new Set((await listBranches(supabase)).map((branch) => branch.slug));
    let slug = slugify(fields.name);
    for (let suffix = 2; taken.has(slug); suffix += 1) slug = `${slugify(fields.name).slice(0, 36)}-${suffix}`;
    const { data, error } = await supabase
        .from("branches")
        .insert({ ...fields, slug })
        .select("id, slug, name, address, phone, is_active")
        .single();
    if (error) throw error;
    branchCache.clear();
    return toBranch(data);
}

async function updateBranch(supabase, branchId, input) {
    const branches = await listBranches(supabase);
    const branch = branches.find((candidate) => candidate.id === branchId);
    if (!branch) throw httpError(404, "Branch not found.");
    const fields = cleanBranchFields(input);
    if (input.isActive === false && branch.isActive && branches.filter((b) => b.isActive).length === 1) {
        throw httpError(409, "This is the only open branch. Open another branch before closing this one.");
    }
    if (input.isActive !== undefined) fields.is_active = input.isActive;
    const { data, error } = await supabase
        .from("branches")
        .update({ ...fields, updated_at: new Date().toISOString() })
        .eq("id", branchId)
        .select("id, slug, name, address, phone, is_active")
        .single();
    if (error) throw error;
    branchCache.clear();
    return toBranch(data);
}

module.exports = {
    MENU_OPTIONS,
    optionsUsedBy,
    listBranches,
    resolveOrderBranch,
    getSoldOut,
    assertAvailable,
    setSoldOut,
    createBranch,
    updateBranch,
    slugify,
    clearCaches: () => {
        branchCache.clear();
        soldOutCache.clear();
    }
};
