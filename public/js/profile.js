/**
 * Profile page for customers (nav "Profile") and admins (tab "Profile"): picture, bio, and the
 * account's own statistics from GET /api/profile. One template (#profile-template) serves both.
 */
(() => {
    const AVATAR_SIZE = 256;
    const BIO_MAX = 280;
    const ROLE_LABELS = { customer: "Customer", staff: "Staff", admin: "Admin", superadmin: "Superadmin" };
    const money = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" });
    const number = new Intl.NumberFormat("en-PH");
    const monthYear = new Intl.DateTimeFormat("en-PH", { month: "long", year: "numeric" });
    const shortDate = new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", year: "numeric" });

    function part(root, name) {
        return root.querySelector(`[data-profile="${name}"]`);
    }

    function formatDate(formatter, value) {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? "" : formatter.format(date);
    }

    async function request(url, options = {}) {
        const response = await fetch(url, { credentials: "same-origin", ...options });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || `The server answered ${response.status}.`);
        return result;
    }

    function stat(label, value, hint, wide = false) {
        const card = document.createElement("div");
        card.className = `profile-stat${wide ? " is-wide" : ""}`;
        const labelElement = document.createElement("span");
        labelElement.className = "profile-stat-label";
        labelElement.textContent = label;
        const valueElement = document.createElement("strong");
        valueElement.className = "profile-stat-value";
        valueElement.textContent = value;
        card.append(labelElement, valueElement);
        if (hint) {
            const hintElement = document.createElement("span");
            hintElement.className = "profile-stat-hint";
            hintElement.textContent = hint;
            card.append(hintElement);
        }
        return card;
    }

    function customerStats(stats) {
        const cards = [];
        if (stats.favorite) {
            const times = Number(stats.favorite.times) || 0;
            cards.push(
                stat(
                    "Your most-ordered drink",
                    stats.favorite.name,
                    `Ordered ${times} time${times === 1 ? "" : "s"}${stats.favorite.classification ? ` · ${stats.favorite.classification}` : ""}`,
                    true
                )
            );
        }
        cards.push(
            stat(
                "Loyalty points",
                number.format(stats.points.earned),
                stats.points.pending
                    ? `+${number.format(stats.points.pending)} pending until those orders are paid`
                    : "Earned when others order your published recipes"
            ),
            stat("Recipes published", number.format(stats.publishedRecipes || 0)),
            stat(
                "Orders placed",
                number.format(stats.orders || 0),
                stats.firstOrderAt ? `Since ${formatDate(shortDate, stats.firstOrderAt)}` : ""
            ),
            stat("Drinks ordered", number.format(stats.drinks || 0)),
            stat("Total spent", money.format((Number(stats.spentCents) || 0) / 100))
        );
        if (stats.orders) {
            const pickup = Number(stats.pickupOrders) || 0;
            const delivery = Number(stats.deliveryOrders) || 0;
            cards.push(
                stat(
                    "You usually choose",
                    pickup >= delivery ? "Pickup" : "Delivery",
                    `${pickup} pickup · ${delivery} delivery`
                )
            );
        }
        return {
            title: "Your statistics",
            cards,
            note: stats.orders
                ? "Cancelled orders aren't counted."
                : "Place your first order and your favourites will show up here."
        };
    }

    function staffStats(stats) {
        const days = stats.recentDays;
        const pair = (label, entry, format = (value) => number.format(Number(value) || 0)) =>
            stat(`${label} (last ${days} days)`, format(entry.recent), `All time: ${format(entry.allTime)}`);
        const cash = (cents) => money.format((Number(cents) || 0) / 100);
        return {
            title: "Your work",
            cards: [
                pair("Orders accepted", stats.accepted),
                pair("Orders closed", stats.closed),
                stat(
                    `Cash collected (last ${days} days)`,
                    cash(stats.cash.recentCents),
                    `${number.format(stats.cash.recent)} orders · all time ${cash(stats.cash.allTimeCents)} from ${number.format(stats.cash.allTime)}`
                ),
                pair("Orders cancelled", stats.cancelled),
                ...(stats.supportReplies ? [pair("Support replies", stats.supportReplies)] : [])
            ],
            note: stats.trackingSince
                ? `"Accepted" and "cancelled" are counted from ${formatDate(shortDate, stats.trackingSince)}, when this tracking began.`
                : `"Accepted" and "cancelled" are counted from now on; closed orders and cash include your earlier work.`
        };
    }

    function renderIdentity(root, profile) {
        part(root, "username").textContent = profile.username;
        part(root, "role").textContent = ROLE_LABELS[profile.role] || profile.role;
        const since = formatDate(monthYear, profile.memberSince);
        part(root, "member-since").textContent = since ? `Member since ${since}` : "";
        const bio = part(root, "bio");
        bio.textContent = profile.bio || "No bio yet. Tell people a little about yourself.";
        bio.classList.toggle("is-empty", !profile.bio);
        const image = part(root, "avatar-image");
        part(root, "initials").textContent = (profile.username || "?").slice(0, 1).toUpperCase();
        if (profile.avatarUrl) {
            image.src = profile.avatarUrl;
            image.alt = `${profile.username}'s profile picture`;
            image.hidden = false;
        } else {
            image.hidden = true;
            image.removeAttribute("src");
        }
        root.querySelector('[data-profile-action="remove-avatar"]').hidden = !profile.avatarUrl;
    }

    function renderStats(root, stats) {
        const grid = part(root, "stats");
        if (!stats) {
            grid.replaceChildren();
            part(root, "stats-note").textContent = "Statistics aren't available yet.";
            return;
        }
        const view = stats.kind === "staff" ? staffStats(stats) : customerStats(stats);
        part(root, "stats-title").textContent = view.title;
        grid.replaceChildren(...view.cards);
        part(root, "stats-note").textContent = view.note;
    }

    function showMessage(root, text, state = "") {
        const message = part(root, "message");
        message.textContent = text;
        message.dataset.state = state;
    }

    function updateBioCount(root) {
        const length = part(root, "bio-input").value.length;
        part(root, "bio-count").textContent = `${BIO_MAX - length} characters left`;
    }

    // Center-crops to a square and resizes to 256 px JPEG, so uploads stay small (~20 KB).
    async function prepareAvatar(file) {
        if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error("Choose a JPEG, PNG or WebP picture.");
        let bitmap;
        try {
            bitmap = await createImageBitmap(file);
        } catch {
            throw new Error("That picture couldn't be read. Try another one.");
        }
        const side = Math.min(bitmap.width, bitmap.height);
        const canvas = document.createElement("canvas");
        canvas.width = AVATAR_SIZE;
        canvas.height = AVATAR_SIZE;
        canvas
            .getContext("2d")
            .drawImage(
                bitmap,
                (bitmap.width - side) / 2,
                (bitmap.height - side) / 2,
                side,
                side,
                0,
                0,
                AVATAR_SIZE,
                AVATAR_SIZE
            );
        bitmap.close?.();
        return new Promise((resolve, reject) =>
            canvas.toBlob(
                (blob) => (blob ? resolve(blob) : reject(new Error("That picture couldn't be prepared."))),
                "image/jpeg",
                0.85
            )
        );
    }

    function wire(root) {
        const form = part(root, "form");
        const editButton = root.querySelector('[data-profile-action="edit"]');
        const setEditing = (editing) => {
            form.hidden = !editing;
            editButton.hidden = editing;
            if (editing) {
                part(root, "bio-input").value = root.profile?.bio || "";
                updateBioCount(root);
                part(root, "bio-input").focus();
            } else editButton.focus();
        };
        editButton.addEventListener("click", () => setEditing(true));
        root.querySelector('[data-profile-action="cancel"]').addEventListener("click", () => setEditing(false));
        part(root, "bio-input").addEventListener("input", () => updateBioCount(root));

        form.addEventListener("submit", async (event) => {
            event.preventDefault();
            const submit = form.querySelector("button[type='submit']");
            submit.disabled = true;
            try {
                const { profile } = await request("/api/profile", {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ bio: part(root, "bio-input").value })
                });
                root.profile = profile;
                renderIdentity(root, profile);
                showMessage(root, "Bio saved.", "success");
                setEditing(false);
            } catch (error) {
                showMessage(root, error.message, "error");
            } finally {
                submit.disabled = false;
            }
        });

        part(root, "file").addEventListener("change", async (event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            showMessage(root, "Uploading your picture…");
            try {
                const blob = await prepareAvatar(file);
                const { profile } = await request("/api/profile/avatar", {
                    method: "PUT",
                    headers: { "Content-Type": "image/jpeg" },
                    body: blob
                });
                root.profile = profile;
                renderIdentity(root, profile);
                showMessage(root, "Profile picture updated.", "success");
            } catch (error) {
                showMessage(root, error.message, "error");
            }
        });

        root.querySelector('[data-profile-action="remove-avatar"]').addEventListener("click", async () => {
            if (!window.confirm("Remove your profile picture?")) return;
            try {
                const { profile } = await request("/api/profile/avatar", { method: "DELETE" });
                root.profile = profile;
                renderIdentity(root, profile);
                showMessage(root, "Profile picture removed.", "success");
            } catch (error) {
                showMessage(root, error.message, "error");
            }
        });
    }

    async function load(root) {
        if (!root) return;
        if (!root.dataset.ready) {
            root.replaceChildren(document.querySelector("#profile-template").content.cloneNode(true));
            wire(root);
            root.dataset.ready = "true";
        }
        part(root, "stats-note").textContent = "Loading…";
        try {
            const { profile, stats } = await request("/api/profile");
            root.profile = profile;
            renderIdentity(root, profile);
            renderStats(root, stats);
        } catch (error) {
            part(root, "stats-note").textContent = "";
            showMessage(root, `Your profile couldn't be loaded: ${error.message}`, "error");
        }
    }

    document.addEventListener("coffeelab:admin-tab", (event) => {
        if (event.detail?.name === "profile") load(document.querySelector("#admin-profile-root"));
    });

    window.CoffeeLabProfile = { load };
})();
