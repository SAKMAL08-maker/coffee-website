const { getAdminClient } = require("../config/supabase");
const menu = require("../services/menuService");

function publicBranch(branch) {
    return { id: branch.id, name: branch.name, address: branch.address, phone: branch.phone };
}

// Customers: open branches and what's sold out at one of them.
async function listOpenBranches(request, response, next) {
    try {
        const branches = await menu.listBranches(getAdminClient());
        response.set("Cache-Control", "no-store");
        response.json({ branches: branches.filter((branch) => branch.isActive).map(publicBranch) });
    } catch (error) {
        next(error);
    }
}

async function availability(request, response, next) {
    try {
        const supabase = getAdminClient();
        const branch = await menu.resolveOrderBranch(supabase, request.query.branch).catch((error) => {
            if (error.statusCode === 400 && !request.query.branch) return null;
            throw error;
        });
        const soldOut = branch ? [...(await menu.getSoldOut(supabase, branch.id))] : [];
        response.set("Cache-Control", "no-store");
        response.json({ branchId: branch?.id || null, soldOut, options: menu.MENU_OPTIONS });
    } catch (error) {
        next(error);
    }
}

// Admins: every branch (open or closed) with its sold-out list; flip a switch.
async function adminMenu(request, response, next) {
    try {
        const supabase = getAdminClient();
        const branches = await menu.listBranches(supabase);
        const withSoldOut = await Promise.all(
            branches.map(async (branch) => ({ ...branch, soldOut: [...(await menu.getSoldOut(supabase, branch.id))] }))
        );
        response.set("Cache-Control", "no-store");
        response.json({ branches: withSoldOut, options: menu.MENU_OPTIONS });
    } catch (error) {
        next(error);
    }
}

async function setSoldOut(request, response, next) {
    try {
        await menu.setSoldOut(getAdminClient(), { ...request.body, actorId: request.user.id });
        response.json({ ok: true });
    } catch (error) {
        next(error);
    }
}

// Superadmin: open a branch, rename it, close it.
async function createBranch(request, response, next) {
    try {
        response.status(201).json({ branch: await menu.createBranch(getAdminClient(), request.body) });
    } catch (error) {
        next(error);
    }
}

async function updateBranch(request, response, next) {
    try {
        response.json({ branch: await menu.updateBranch(getAdminClient(), request.params.branchId, request.body) });
    } catch (error) {
        next(error);
    }
}

module.exports = { listOpenBranches, availability, adminMenu, setSoldOut, createBranch, updateBranch };
