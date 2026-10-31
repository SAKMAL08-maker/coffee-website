/**
 * Admin "Menu" tab: sold-out switches per branch (any admin) and branch management (superadmin).
 * Each switch saves immediately; customers see the change within a minute (public/js/menu.js), and
 * checkout refuses sold-out drinks at once.
 */
(() => {
    const root = document.getElementById("admin-menu-root");
    if (!root) return;
    let data = { branches: [], options: [] };
    let branchId = null;

    async function request(url, options = {}) {
        const response = await fetch(url, {
            credentials: "same-origin",
            ...options,
            headers: options.body ? { "Content-Type": "application/json" } : undefined
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || `The server answered ${response.status}.`);
        return result;
    }

    function element(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function say(text, kind = "") {
        const message = root.querySelector(".admin-menu-message");
        if (!message) return;
        message.textContent = text;
        message.dataset.state = kind;
    }

    function currentBranch() {
        return data.branches.find((branch) => branch.id === branchId) || null;
    }

    function switchesSection() {
        const section = element("section", "admin-menu-section");
        const header = element("div", "admin-menu-header");
        header.append(element("h3", "", "Sold-out switches"));
        if (data.branches.length > 1) {
            const label = element("label", "admin-menu-branch");
            label.append("Branch ");
            const select = element("select");
            select.append(
                ...data.branches.map(
                    (branch) => new Option(`${branch.name}${branch.isActive ? "" : " (closed)"}`, branch.id)
                )
            );
            select.value = branchId;
            select.addEventListener("change", () => {
                branchId = select.value;
                render();
            });
            label.append(select);
            header.append(label);
        }
        section.append(
            header,
            element(
                "p",
                "field-help",
                "Switch an option off when it runs out. Customers see it greyed out, and orders that use it are refused until you switch it back on."
            )
        );
        const branch = currentBranch();
        const soldOut = new Set(branch?.soldOut || []);
        const groups = new Map();
        for (const option of data.options) {
            if (!groups.has(option.group)) groups.set(option.group, []);
            groups.get(option.group).push(option);
        }
        const grid = element("div", "admin-menu-groups");
        for (const [group, options] of groups) {
            const fieldset = element("fieldset", "admin-menu-group");
            fieldset.append(element("legend", "", group));
            for (const option of options) {
                const available = !soldOut.has(option.key);
                const button = element("button", "admin-menu-switch");
                button.type = "button";
                button.setAttribute("role", "switch");
                button.setAttribute("aria-checked", String(available));
                button.dataset.option = option.key;
                button.append(
                    element("span", "admin-menu-switch-label", option.label),
                    element("span", "admin-menu-switch-state", available ? "Available" : "Sold out")
                );
                fieldset.append(button);
            }
            grid.append(fieldset);
        }
        section.append(grid);
        return section;
    }

    function branchesSection() {
        const section = element("section", "admin-menu-section");
        section.append(
            element("h3", "", "Branches"),
            element(
                "p",
                "field-help",
                "Customers choose a branch when more than one is open. Closing a branch stops new orders there; its history stays."
            )
        );
        const list = element("ul", "admin-branch-list");
        for (const branch of data.branches) {
            const item = element("li", "admin-branch");
            const form = element("form", "admin-branch-form");
            form.dataset.branchId = branch.id;
            const name = element("input");
            name.name = "name";
            name.value = branch.name;
            name.required = true;
            name.minLength = 2;
            name.maxLength = 80;
            name.setAttribute("aria-label", "Branch name");
            const address = element("input");
            address.name = "address";
            address.value = branch.address || "";
            address.maxLength = 200;
            address.placeholder = "Address";
            address.setAttribute("aria-label", "Branch address");
            const save = element("button", "button button-small", "Save");
            save.type = "submit";
            const toggle = element("button", "button button-small", branch.isActive ? "Close branch" : "Open branch");
            toggle.type = "button";
            toggle.dataset.toggleBranch = branch.isActive ? "close" : "open";
            const status = element("span", `admin-branch-status${branch.isActive ? "" : " is-closed"}`);
            status.textContent = branch.isActive ? "Open" : "Closed";
            form.append(name, address, status, save, toggle);
            item.append(form);
            list.append(item);
        }
        const add = element("form", "admin-branch-form admin-branch-add");
        add.innerHTML =
            '<input name="name" required minlength="2" maxlength="80" placeholder="New branch name" aria-label="New branch name" />' +
            '<input name="address" maxlength="200" placeholder="Address" aria-label="New branch address" />' +
            '<button class="button button-primary button-small" type="submit">Add branch</button>';
        section.append(list, add);
        return section;
    }

    function render() {
        const isSuperadmin = window.CoffeeLabSession?.role === "superadmin";
        const message = element("p", "notice admin-menu-message");
        message.setAttribute("role", "status");
        if (!data.branches.length) {
            root.replaceChildren(
                element("p", "field-help", "Menu switches need the latest database migration (branches).")
            );
            return;
        }
        root.replaceChildren(switchesSection(), ...(isSuperadmin ? [branchesSection()] : []), message);
    }

    async function load() {
        try {
            data = await request("/api/menu/admin");
            if (!data.branches.some((branch) => branch.id === branchId)) {
                branchId = (data.branches.find((branch) => branch.isActive) || data.branches[0])?.id || null;
            }
            render();
        } catch (error) {
            root.replaceChildren(element("p", "notice", `The menu couldn't be loaded: ${error.message}`));
        }
    }

    root.addEventListener("click", async (event) => {
        const switchButton = event.target.closest("[data-option]");
        if (switchButton) {
            const available = switchButton.getAttribute("aria-checked") === "true";
            const option = switchButton.dataset.option;
            switchButton.disabled = true;
            try {
                await request("/api/menu/admin/sold-out", {
                    method: "PUT",
                    body: JSON.stringify({ branchId, option, soldOut: available })
                });
                const branch = currentBranch();
                branch.soldOut = available
                    ? [...branch.soldOut, option]
                    : branch.soldOut.filter((key) => key !== option);
                render();
                say(
                    `${switchButton.querySelector(".admin-menu-switch-label").textContent} is now ${available ? "sold out" : "available"}.`,
                    "success"
                );
            } catch (error) {
                switchButton.disabled = false;
                say(error.message, "error");
            }
            return;
        }
        const toggle = event.target.closest("[data-toggle-branch]");
        if (toggle) {
            const id = toggle.closest("[data-branch-id]").dataset.branchId;
            const closing = toggle.dataset.toggleBranch === "close";
            if (closing && !window.confirm("Close this branch? Customers won't be able to order from it.")) return;
            try {
                await request(`/api/menu/admin/branches/${id}`, {
                    method: "PATCH",
                    body: JSON.stringify({ isActive: !closing })
                });
                await load();
                say(closing ? "Branch closed." : "Branch opened.", "success");
            } catch (error) {
                say(error.message, "error");
            }
        }
    });

    root.addEventListener("submit", async (event) => {
        const form = event.target.closest(".admin-branch-form");
        if (!form) return;
        event.preventDefault();
        const body = { name: form.elements.name.value.trim(), address: form.elements.address.value.trim() };
        try {
            if (form.dataset.branchId) {
                await request(`/api/menu/admin/branches/${form.dataset.branchId}`, {
                    method: "PATCH",
                    body: JSON.stringify(body)
                });
            } else {
                await request("/api/menu/admin/branches", { method: "POST", body: JSON.stringify(body) });
            }
            await load();
            say(form.dataset.branchId ? "Branch saved." : `${body.name} added.`, "success");
        } catch (error) {
            say(error.message, "error");
        }
    });

    document.addEventListener("coffeelab:admin-tab", (event) => {
        if (event.detail?.name === "menu") load();
    });
})();
