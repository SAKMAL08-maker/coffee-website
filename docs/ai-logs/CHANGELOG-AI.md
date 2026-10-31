# AI changelog

Append-only. Format and rules: [README.md](README.md).

## 2026-10-30 · Phase 0 · Repo hygiene

- **Tool:** Claude Code (Claude Opus 5.5)
- **Branch:** `phase-0-repo-hygiene` · **PR:** https://github.com/SAKMAL08-maker/coffee-website/pull/9

**What changed**

- Fast-forwarded `main` to `version_1.0` (no commits lost) and made `main` the default branch on GitHub, so pull requests target the current code.
- Added `README.md` (overview, Mermaid architecture diagram, setup, scripts, environment variable table without values, free-tier notes), an MIT `LICENSE`, and `.gitattributes` (LF line endings).
- Corrected stale statements in `AGENTS.md` and `.github/copilot-instructions.md` (they said `index.html`/`server.js` were empty and tests were placeholders) and in `DOCUMENTATION.md` (branch, clone steps, AI evidence).
- Removed the unused `pg` dependency; set `license` to MIT in `package.json`.
- `.env.example`: added `NODE_ENV`, clarified the Supabase key type, replaced the real bucket name with a placeholder.
- Fixed broken Markdown escaping in `CLAUDE.md`.
- Added this folder.

**Why:** a reviewer or new teammate should be able to understand, install, and run the project from the README alone, and the instruction files that AI tools read must not contain false facts.

**Human checks required**

- [ ] The LICENSE names `SAKMAL08-maker` as copyright holder. Change it to your legal name if you prefer.
- [ ] In Render → Settings → Build & Deploy, the deploy branch is `main`. If it still points at a `version_*` branch, merged PRs will not deploy.
- [ ] Render's start command is still `npm start` and its build command still works without `pg` (expected: `npm install` or `npm ci`).
- [ ] The Mermaid diagram renders on the GitHub PR page.
- [ ] Free-tier figures in the README still match the Render, Supabase, and Backblaze pricing pages.
- [ ] Incident during setup (before any file changes): an unscoped `grep` printed two `.env` values into the AI session. The owner rotated the Supabase key by hand and removed the unused `JWT_SECRET` and mislabelled `SUPABASE_ANON_KEY`. Confirm the legacy keys are disabled in Supabase.

## 2026-10-30 · Phase 1 · CI and deploy config

- **Tool:** Claude Code (Claude Opus 5.5)
- **Branch:** `phase-1-ci-deploy-config` · **PR:** https://github.com/SAKMAL08-maker/coffee-website/pull/10

**What changed**

- GitHub Actions CI (`.github/workflows/ci.yml`): `npm ci`, `npm run lint`, `npm test`, `npm audit --omit=dev` on every PR and push to `main`. Read-only permissions, no secrets.
- ESLint 10 flat config (`eslint.config.js`) with `eslint:recommended`; Prettier 3 config matching the existing style. Prettier is **not** enforced in CI yet: it would reformat 39 existing files, which belongs in a separate format-only PR.
- `GET /healthz` (route → controller → service) runs one `select id limit 1` on `coffee_users` with a 5 s timeout and returns `200 {"status":"ok"}` or `503 {"status":"unavailable"}`. Mounted outside `/api` so cross-site pingers are not blocked by the same-origin guard; rate-limited to 30/min; rejects query params via the existing Zod `empty` schema.
- 3 new tests in `test/health.test.js` using a fake Supabase client (24 total).
- PR template and issue forms (bug report, feature request).
- **No `render.yaml`**: the existing Render service was created in the dashboard, and a Blueprint is only applied if someone creates one in Render, so the file brings risk (a mis-synced Blueprint can create a second service) without benefit right now.

**Why:** every PR now gets an automatic pass/fail before the owner reviews it, and the free-tier services can be kept awake with an honest health check instead of a fake one.

**Human checks required**

- [ ] The CI check on the PR is green (first real run of the workflow).
- [ ] After merge and deploy, `https://<your-app>.onrender.com/healthz` returns `{"status":"ok"}`.
- [ ] Set up one external pinger on `/healthz` every 10–14 min (steps in the PR / runbook in Phase 2).
- [ ] Do **not** set Render's own "Health Check Path" to `/healthz`: Render probes often, so every probe would query Supabase, and a brief database outage would make Render restart a healthy app.
- [ ] Render free-tier numbers (750 instance hours/month, ~15 min spin-down) still match Render's pricing page.

## 2026-10-30 · Format-only PR · Prettier across the codebase

- **Tool:** Claude Code (Claude Opus 5.5)
- **Branch:** `chore-format-codebase` · **PR:** https://github.com/SAKMAL08-maker/coffee-website/pull/11

**What changed**

- Ran `npm run format` over the whole repo in one isolated commit (`1ae29ff`), listed in `.git-blame-ignore-revs` so `git blame` skips it.
- YAML files use 2-space indentation via a Prettier override.
- CI now runs `npm run format:check`.

**Why:** Phase 3 refactors pricing; doing the reformat first keeps that diff about logic only.

**How "no behavior change" was verified**

- JavaScript: token streams of all 28 changed JS files compared before/after with ESLint's tokenizer. Identical except optional parentheses and numeric spelling (`.6` → `0.6`).
- HTML/CSS: identical after removing whitespace, except self-closing void tags (`<input />`), lowercase `<!doctype html>`, and 94 leading zeros in CSS (`.5` → `0.5`).
- `npm run lint` clean, `npm test` 24/24.

**Human checks required**

- [ ] Merge this PR with **"Create a merge commit"**, not squash or rebase. Squash/rebase changes the commit hash and `.git-blame-ignore-revs` would point at nothing.
- [ ] After deploy, click through the customizer, cart, checkout, and admin dashboard once. HTML whitespace changes are designed to be safe, but a visual glance confirms it.

## 2026-10-30 · Phase 2 · Collaboration docs

- **Tool:** Claude Code (Claude Opus 5.5)
- **Branch:** `phase-2-collaboration-docs` · **PR:** https://github.com/SAKMAL08-maker/coffee-website/pull/12

**What changed**

- `CONTRIBUTING.md`: workflow, branch names, Conventional Commits, code conventions table, tests, migration rules, AI rules.
- `docs/adr/`: index plus 4 ADRs: server-side pricing (0001), Backblaze B2 receipts (0002), admin MFA (0003), custom customer auth (0004).
- `docs/runbook.md`: deploy, rollback (Render + GitHub revert), key rotation (Supabase, B2, sessions, admin TOTP), keep-alive setup, alert triage, incident checklist.
- `PLAN.md`: roadmap, a short business plan **marked as a draft**, and a learning log that quotes commit messages verbatim.
- `AI-USAGE.md`: tools, working rules, recorded AI mistakes, and **placeholders** for the owner's own corrections.
- README doc index; `instructions/guide.md` release checks now include lint and format.

**Why:** reviewers and new teammates need the reasons behind the design, a repeatable way to operate it, and an honest account of AI involvement.

**What Claude deliberately did not write**

- Why B2 was chosen over Supabase Storage, why Supabase Auth MFA over alternatives, and why customers moved off Supabase Auth: not recorded anywhere, so each ADR has an "Owner to confirm" block with Claude's clearly labelled inferences.
- Any example of the owner correcting AI output beyond what commit messages say.

**Human checks required**

- [ ] Fill the ✍️ placeholders in ADR-0002, ADR-0003, ADR-0004, `PLAN.md` (business plan + learning log), and `AI-USAGE.md`, or delete ones you don't want.
- [ ] Business plan figures and customer segments are assumptions. Replace them with your own.
- [ ] Runbook steps match what you actually see in the Render, Supabase, and Backblaze dashboards (menu names change).
- [ ] Before you ever run `delete from public.coffee_sessions;` from the runbook: it logs out every customer.

## 2026-10-30 · Phase 3 · Pricing and order-status refactor

- **Tool:** Claude Code (Claude Opus 5.5)
- **Branch:** `phase-3-pricing-refactor` (stacked on `phase-2-collaboration-docs`) · **PR:** https://github.com/SAKMAL08-maker/coffee-website/pull/13

**What changed**

- `services/pricingService.js`: all pricing moved out of `controllers/orderController.js` with named constants (`PRICING_RULES`), integer centavos, and a base/modifier split. Same math, same rounding.
- `POST /api/orders/quote` (Zod schema, 120/min limiter, `no-store`): prices a cart without saving it.
- Browser: `public/js/pricing.js` no longer calculates prices; new `public/js/pricingApi.js` fetches quotes (200 ms debounce, aborts stale requests, 50-entry cache). `app.js` displays server centavos.
- `services/orderStatusMachine.js`: explicit allowed transitions per fulfillment method; used by the staff status endpoint and both admin approvals.
- `PATCH /api/orders/:orderId/status` now has a rate limiter (30/min).
- 13 new tests (24 → 37).

**Why:** one source of truth for prices (the displayed total is now exactly the charged total), and status rules that are explicit and can't reach invalid states.

**How "identical totals" was verified**

- `test/pricingRegression.test.js` embeds the **verbatim** old pricing code from `main@e2285d7` (checked with `diff` against git) and compares 448 single drinks × pickup/delivery × 10 tips, plus 200 random 1–20-item carts, plus validation errors. All identical.
- Mutation check: deliberately breaking tip rounding, the delivery fee, or the size step each made the regression tests fail; restored afterwards.
- Headless Edge render of the real page showed server-quoted prices (₱386.50 default delivery total; static HTML holds ₱0.00).

**Behavior changes (intended)**

- Pickup orders can no longer be moved to "Out for Delivery"/"Arrived" through the staff endpoint (no UI used this).
- Final orders (Delivered / Ready for Pickup) now get a clean 409 instead of a 500 when someone tries to move them.
- Displayed prices can differ from the old browser estimate by ₱0.01 in rare custom-tip cases; they now match what checkout charges.
- Checkout summary says "total" instead of "estimated total".

**Human checks required**

- [ ] Render env: is `TRUST_PROXY_HOPS` set (e.g. `1`)? If not, all visitors may share one rate-limit bucket, and the new 120/min quote limit could be hit with several customers at once.
- [ ] Manual UI pass (checklist in the PR): prices update while customizing, cart prices, tip/custom tip, pickup ↔ delivery, checkout total equals the order's saved total.

## 2026-10-30 · Phase 4 · Cash handling

- **Tool:** Claude Code (Claude Opus 5.5)
- **Branch:** `phase-4-cash-handling` (stacked on `phase-3-pricing-refactor`) · **PR:** https://github.com/SAKMAL08-maker/coffee-website/pull/14

**What changed**

- Migration `20261101000000_cash_payment_tracking.sql` (additive): `orders.payment_method` (not null, default `'cash'`, check `in ('cash')`), `cash_collected_at`, `cash_collected_by` (FK to `coffee_users`), an all-or-nothing consistency check, and a partial index for uncollected cash.
- `services/paymentService.js`: payment wording and the "can collect" rule in one module.
- Checkout dialog shows "Pay in cash on pickup/delivery" (text supplied by the quote endpoint); PDF and image receipts show the same line, and "TOTAL PAID" became "TOTAL DUE".
- Admin: `PATCH /api/orders/:orderId/admin/cash-collected` (`requireAdmin`, strict Zod with empty body, 20/min limiter). Race-safe: the update only matches while `cash_collected_at` is null. Dashboard shows cash status and a "Mark cash collected" button.
- Admin order list now falls back schema-by-schema (cash → approvals → base), so deploying this code before the migration degrades gracefully instead of failing.
- Admin action handler refactored from nested ternaries into a lookup table.
- 11 new tests (37 → 48).

**Why:** cash is the only payment method; customers must know before ordering, and the shop must know which orders still owe money.

**Verification of the migration (without touching Supabase)**

- Parsed with `libpg-query` (Postgres's real parser): 6 statements OK. Syntax only.
- `create_coffee_order` inserts with an explicit column list (`20261025000000_username_accounts.sql`), so the new default applies and checkout needs no change.

**Human checks required**

- [ ] Apply the migration in Supabase **before merging** (order and checks in the PR).
- [ ] Old app after migration: place an order on the currently deployed site; in Supabase it should have `payment_method = 'cash'`.
- [ ] After deploy: checkout note, receipt line, admin button, second click returns "already recorded".

## 2026-10-30 · Phase 5 · Community recipes with royalties

- **Tool:** Claude Code (Claude Opus 5.5)
- **Branch:** `phase-5-community-recipes` (stacked on `phase-4-cash-handling`) · **PR:** https://github.com/SAKMAL08-maker/coffee-website/pull/15

**What changed**

- Migration `20261102000000_community_recipes.sql` (additive): `coffees.public_slug` / `published_at` (format + both-or-neither checks, partial unique index); `order_items.source_coffee_id`, `royalty_account_id`, `royalty_points` (default 0, `>= 0`); `create_coffee_order` replaced with the same signature and grants, plus three optional item keys; new `recipe_royalty_summary(uuid)` (service_role only).
- `services/communityRecipeService.js`: slug generation (crypto, unbiased), exact-drink matching, the royalty rules, publish/unpublish/read/list.
- `services/recipeQrCode.js`: server-side SVG QR (new dependency `qrcode-generator`, MIT, no transitive deps), so the CSP stays `'self'`.
- Routes `/api/recipes`: `POST /` (publish, auth), `GET /mine` (auth), `GET /:slug`, `GET /:slug/qr.svg`, `DELETE /:slug` (owner-only). All Zod-validated and rate-limited.
- Checkout: items may carry `recipeSlug`; the server resolves royalties and saves them in the same RPC as the order. If the lookup fails, the order still goes through without royalties.
- UI: "Publish to community" dialog (name, link, QR, points, unpublish); `/?recipe=<slug>` loads the drink with an "Order this recipe" banner.
- 14 new tests (48 → 62), including a mutation check (3 deliberate breaks of the royalty rules were each caught).

**Why these rules:** royalties must not be gameable from the browser. The server decides; the drink must match exactly; there is no self-royalty; points live on the order item, so they are stored once per drink; and they are "earned" only after cash is collected, so unpaid or fake orders earn nothing.

**Decisions made by the AI that the owner should confirm**

- 10 points per drink (`ROYALTY_POINTS_PER_DRINK`). There is no points redemption yet.
- Guests' orders also pay royalties.
- The creator's username is shown publicly on a shared recipe (the dialog says so).
- Wording "Publish to community" was chosen because `test/api.test.js` deliberately forbids the old removed "Share recipe" wording.

**Human checks required**

- [ ] Apply migration 2 of 2 (after Phase 4's) **before merging**. Order and checks are in the PR.
- [ ] Set `PUBLIC_APP_URL` on Render.
- [ ] Two-account test: B orders A's link and admin collects cash → A's points move from pending to earned; A ordering own link earns 0.

## 2026-10-30 · Phase 5b · Caffeine guardian

- **Tool:** Claude Code (Claude Opus 5.5)
- **Branch:** `phase-5b-caffeine-guardian` (stacked on `phase-5-community-recipes` / PR #16) · **PR:** https://github.com/SAKMAL08-maker/coffee-website/pull/17
- **Owner's choice:** caffeine guardian over origin-traceable beans.

**What changed**

- Migration `20261103000000_caffeine_guardian.sql` (additive): `coffee_users.caffeine_cutoff_time time` (nullable). The daily total needs no storage; it is summed from `order_items.nutrition->caffeineMg`.
- `services/caffeineGuardianService.js`: Manila-time "today" and cutoff, daily total, and a pure `evaluateDrink` that returns reasons and a half-caf suggestion.
- `POST /api/caffeine/check` (auth, Zod, 120/min) and `PUT /api/caffeine/settings` (auth, `HH:MM` or null).
- UI: panel under the drink metrics, a cutoff time input, and a one-tap **Make it half-caf** button. `auth.js` emits `coffeelab:signed-in` so the panel starts after login (admins excluded).
- 12 new tests (62 → 74), plus a mutation check (4 deliberate breaks, each caught).

**Decisions made by the AI that the owner should confirm**

- A 400 mg daily guide (a fixed constant, not per-user). The UI says "guidance only, not medical advice".
- Asia/Manila as the shop time zone.
- "Today" counts orders placed today, not drinks actually consumed.

**Human checks required**

- [ ] Approve applying the migration (Claude will run it via the Supabase MCP only after your yes).
- [ ] Manual checklist in the PR.

## 2026-10-30 · Fix · Caffeine guardian visibility and basket

- **Tool:** Claude Code (Claude Opus 5.5)
- **Branch:** `fix-caffeine-guardian-visibility` · **PR:** https://github.com/SAKMAL08-maker/coffee-website/pull/19

**What the owner found:** after three 3-shot drinks, no half-caf offer appeared and there was no "No caffeine after" control.

**Diagnosis (from Supabase logs, not guesswork)**

1. The live code was deployed and `/api/caffeine/check` succeeded for the owner's account, but the panel sat inside the summary card, which is hidden until the preview is flipped. This was the AI's placement error.
2. No checkout reached the database (last order: 2026-10-27), so the three drinks were in the basket, and the guardian only counted _placed_ orders.

**Fix**

- Panel moved above "Add to order basket", always visible.
- The check now also counts the basket: the browser sends basket drink configurations, never numbers; the server recomputes caffeine (strict Zod, max 20).
- Regression test: `test/api.test.js` fails if the panel is inside the hidden summary card (verified to fail on the old markup).
- 3 more caffeine tests, including "three 3-shots trigger the half-caf offer".

**Lesson:** the unit tests proved the logic but not that the UI was visible. The manual checklist caught it, and there is now a structural test for it.

## 2026-10-30 · Polish · Caffeine guardian UI

- **Tool:** Claude Code (Claude Opus 5.5)
- **Branch:** `caffeine-guardian-polish` · **PR:** https://github.com/SAKMAL08-maker/coffee-website/pull/20
- **Owner's request:** "looks a bit clunky… sleek, user friendly, and non overwhelming".

**What changed (UI only; no API or database change)**

- The panel became one slim card matching the page's cards: "☕ Caffeine today", a `576 / 400 mg` total, and a thin meter (ordered · basket · striped "this drink") with a marker at the guide.
- The run-on sentence was replaced by a short breakdown that hides zero parts and doubles as the meter's legend (coloured dots).
- The warning only appears when relevant: one short sentence plus a pill **Switch to half-caf · 96 mg**.
- The cutoff is tucked behind a small **⏰ Cutoff** pill (it reads "⏰ After 3:00 PM" when set) and opens inline, so it never covers the button. The disclaimer moved in there.
- **Bug found while previewing:** if the session check finished before `app.js` loaded, the "signed in" event was missed and the panel never appeared. `auth.js` now also records `window.CoffeeLabSession`, and `app.js` checks it on start.

**How it was checked:** screenshots of the real page and scripts in headless Edge with a stubbed `fetch` (light and dark; calm, over the guide, and cutoff-open states). Not checked: a real phone. The 400 px preview showed the whole page overflowing horizontally, but that also happens on `main` before this change.

## 2026-10-31 · Batch while the owner was away · Admin dashboard, admin access, terms, scalability

- **Tool:** Claude Code (Claude Opus 5.5)
- **Owner's request:** an admin dashboard with metrics and bar charts per tab; a way to verify admins without a terminal; a ready admin account (`Arthur_Admin`, authenticator only, no one-time key); Terms of Use beside the Privacy Policy with the contact email; at least 3 scalability PRs to choose from; any free extra features.

| PR                                                              | What                                                                                                                                                               | Migration                                | Base   |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------- | ------ |
| [#21](https://github.com/SAKMAL08-maker/coffee-website/pull/21) | Terms of Use page, linked beside all 5 Privacy Policy links; email on both pages                                                                                   | none                                     | `main` |
| [#22](https://github.com/SAKMAL08-maker/coffee-website/pull/22) | Admin dashboard: 4 totals plus 10 bar-chart tabs (orders/sales per day, drink type, base, milk, temperature, add-ons, caffeine, fulfillment, status), 7/30/90 days | none                                     | `main` |
| [#23](https://github.com/SAKMAL08-maker/coffee-website/pull/23) | Admin access panel: approve or reset another admin's authenticator in the app; approved admins scan a QR code with no key; `scripts/create-admin-account.js`       | `20261104000000_admin_setup_preapproval` | on #22 |
| [#24](https://github.com/SAKMAL08-maker/coffee-website/pull/24) | Scalability **A**: dashboard counted in Postgres (`admin_order_metrics`), with a Node fallback                                                                     | `20261105000000_admin_order_metrics`     | on #22 |
| [#25](https://github.com/SAKMAL08-maker/coffee-website/pull/25) | Scalability **B**: brotli/gzip (220 KB → 45 KB first load), cached page, 30 s dashboard cache                                                                      | none                                     | on #22 |
| [#26](https://github.com/SAKMAL08-maker/coffee-website/pull/26) | Scalability **C**: optional Postgres-shared rate limits for several instances (`RATE_LIMIT_STORE=postgres`)                                                        | `20261106000000_shared_rate_limits`      | `main` |
| [#27](https://github.com/SAKMAL08-maker/coffee-website/pull/27) | Extra: download orders as CSV (no customer contact details; formula-injection safe)                                                                                | none                                     | on #22 |

**AI recommendation among the scalability PRs:** A. The dashboard is the only feature whose cost grows with total order history. B helps page speed but may duplicate Render's own compression. C only matters once more than one instance runs.

**Production actions taken by the AI**

- Created the requested admin `arthur_admin` with the new script (Supabase Auth user `arthur_admin@coffeelab.invalid`, confirmed, linked, role admin). This was explicitly requested by the owner. Checked with the app's own sign-in: the wrong password is rejected and the right one is accepted.
- **No migrations were applied.** Each was dry-run on the live database inside a transaction that always rolls back. #24's SQL produced metrics identical to Node's on all 13 measures. Afterwards I confirmed nothing persisted. Applying them waits for the owner's yes, as agreed.
- Read-only queries only otherwise (schema, indexes, metrics on real orders).

**Mistakes caught along the way**

- The first draft of #23's PR description quoted the admin password. The tool's safety check blocked it before anything was published; it was rewritten without it. The password is in no file or commit.
- The CSV writer briefly contained a literal BOM character, which lint caught; it was replaced with the `﻿` escape.
- Option A's first test fake had no `rpc`; the old paging test was turned into the "before the migration" fallback test.

**Human checks needed:** read the Terms text; apply the migrations you choose; approve Arthur from the admin page after #23 merges; change Arthur's password after first sign-in, since it was shared in a chat; consider `ADMIN_APPROVER_USERNAMES`.

## 2026-10-31 · Superadmin, account dashboard, sign-in flash fix

- **Tool:** Claude Code (Claude Opus 5.5)
- **Branch:** `superadmin-accounts`

**What changed**

- New role `superadmin` (one account, `Super_Admin`). It signs in with a password and three security questions, with no authenticator. Typing the username and pressing Enter opens that screen. Three wrong attempts lock it. The owner unlocks it in Supabase (`superadmin_security.locked`).
- Superadmin-only **Accounts** section (Admins / Customers): signed-in status and last sign-in, remove admin rights, delete account. API: `/api/superadmin/accounts`.
- Fixed the login page briefly showing for signed-in visitors. It now stays hidden behind an "Opening Coffee Lab…" line until the saved session is checked.
- Migration `20261107000000_superadmin`, dry-run on the live database in a rolled-back transaction: the counter goes 1, 2, 3 and locks on the third; a success while locked changes nothing; a manual unlock resets the count; a second superadmin is refused.

**Why:** the owner asked for one account above the admins that manages accounts and can be locked from Supabase.

**Security trade-offs, told to the owner:** this account has no second factor, and the answers are personal facts that were shared in a chat. They are stored only as scrypt hashes, set from shell variables, and appear in no file or commit. Mitigations: lockout after 3 attempts, IP rate limit, a 12-hour session, and the normal login and password reset refuse the account.

## 2026-10-31 · Admin page tabs

- **Tool:** Claude Code (Claude Opus 5.5)
- **Branch:** `admin-tabs`

**What changed:** the admin page is split into tabs, so you no longer scroll past the charts and account lists to reach orders. Tabs: Orders, Dashboard, and Admin access (labeled Accounts for the superadmin). Built as accessible ARIA tabs with arrow-key support; the last tab is remembered per browser session. Markup was moved, not changed, so every existing element ID is kept.

Follow-up: a count badge on the Admin access / Accounts tab shows how many admins are waiting for authenticator approval. Screen readers hear "2 waiting for approval". Colours are coffee on paper: 10.6:1 contrast in light mode, 6.4:1 in dark.

**Why:** the owner found the single long admin page inconvenient.

**Mistake caught:** the first version saved "Orders" on page load before reading the saved tab, so the remembered tab was always lost. The headless preview showed it, and it was fixed before the PR.

## 2026-10-31 · Full app review, then fixes

- **Tool:** Claude Code (Claude Opus 5.5), with four parallel review agents (admin UX, customer UX, accessibility/mobile, code/scalability) and one report writer. Notes and report are kept locally (not committed).

**Fixes so far**

- [#35](https://github.com/SAKMAL08-maker/coffee-website/pull/35): customers were charged for espresso shots on filter coffee, cold brew and matcha, and for milk on filter coffee and cold brew.
- `admin-orders-compact`: the owner's complaint. Each order was a 650–1,000 px card (raw JSON per drink made it overflow sideways). Now a compact row with one next-step button that finally uses the status endpoint (Received → Crafting → Out for delivery → Arrived), confirmations on final and money actions, Active/Done/All views with counts, search, a new-order title alert, and polling that no longer wipes open rows or focus. Also fixes a duplicate `admin-access-badge` id I introduced in #34.

**Mistakes caught along the way**

- The review report claimed CI skips merges because the default branch is `version_0.1`; checking GitHub showed the default is `main`, so nothing was changed.
- A shell heredoc stripped the backslashes from the new search pattern (`\p{L}` became `p{L}`), which rejected every search; the new validation test caught it before commit.

### Customer checkout and tracking (from the review)

- The drink price is now on the main builder card; before, it was only behind a small arrow.
- Tip: "No tip" comes first and is the default. Before, the tip defaulted to 15%, was also charged on pickup, and had no zero option.
- Checkout lists every fee (drinks, delivery, 8% service, 12% VAT, tip, total) and shows errors inside the dialog; they used to be hidden behind it. The contradictory "prototype, no payment is processed" line next to "Pay in cash" is gone.
- Tracking shows real steps: Order received → Being made → On the way → Arrived → Delivered, or → Ready for pickup for pickups. This works now that the admin page moves orders through those steps. "I've received my order" appears only once the order has left the shop.
- The sign-in screen no longer tells customers about Supabase and authenticator codes.

### Accessibility and visual polish (from the review)

- The closed cart drawer is `inert`, so Tab no longer lands on its invisible buttons; while it is open, the page behind it is `inert`.
- Contrast was measured with the WCAG formula, not by eye:
    - The focus ring went from 2.95:1 to 4.4:1 and now also covers `summary` and `[tabindex]`.
    - Muted text went from 4.37:1 to 4.99:1, and the eyebrow labels to 5.1:1.
    - Dark-theme pairs that used white or light-theme reds were fixed: complete status, active nav, cart count, errors, Delete and Remove are now 6.4–8.9:1.
- Restored the focus ring on the dashboard's day columns, made sign-in screen switches move focus to the heading, and turned the Admins/Customers switch into toggle buttons (it claimed to be tabs without tab panels).
- The logo link and "Download CSV" no longer render as default blue underlined links. The cart's Edit and Remove buttons are 32 px tall.
- Removed 21 dead CSS rules (an old tracking timeline and driver card that nothing uses), each checked with grep across the HTML, JS and tests.

### Server messages and receipts (from the review)

- **Error messages:** the error handler replaced every 4xx message with a generic one, so users saw "The request conflicts with the current resource state." instead of "…Demote it instead." It now passes the message through unless the error is marked `expose: false`, which is the convention of the `http-errors` package that Express uses. 5xx errors stay generic.
- **Receipt numbers:** receipts printed `CL-` plus the first 8 characters of the order id, while every screen shows `CL-` plus the last 6 of the tracking code. Both receipts now use the shared `services/orderCode.js`.
- **Receipt time:** the PDF receipt printed its time in UTC, 8 hours off; it now uses Manila time, like the image receipt.
- **Superadmin accounts:** the account list now looks up admin sign-in times in parallel instead of one after another.
- **Not changed, on purpose:** long-lived browser caching of static files. The files have no content hashes in their names, so after a deploy browsers could run old scripts against new HTML. ETag revalidation (304 responses) already avoids re-downloading unchanged files.

### VAT-inclusive prices, cancelled orders, foreign-key indexes (owner decisions D2–D4)

- **VAT (D4, owner: yes):** prices now include 12% VAT, as Philippine menus do. The order shows "VAT included" (amount × 12/112 of drinks, delivery and service fee; tips aren't VAT-able) instead of adding it. New orders carry `pricing.vat_inclusive: true`, so the admin page and receipts still show older orders' added tax correctly. The server's default tip is 0, matching the page (D2, owner: no tip).
- **Delete policy (D3, owner: "rely on you"):** admins **cancel** orders instead of deleting them. A cancelled order keeps its record, shows as cancelled to the customer, leaves the sales dashboard (both the Postgres function and the Node fallback), and can't be advanced, approved or have cash recorded. Permanent delete is superadmin-only on the server.
- **Migration `20261108000000_cancelled_orders_fk_indexes.sql`:** allows the Cancelled status, adds the 4 foreign-key indexes the live Supabase advisor flags, and re-creates `admin_order_metrics` with one added filter (diffed against the original). Applying it from here was blocked by the permission system, so the owner applies it.

### Footer, legal page buttons, point-of-sale receipts

- **Footer:** one site footer on the app, Privacy and Terms pages: legal links, contact email, Facebook and Instagram (new tab, labelled for screen readers). Removed the duplicate legal links from the header, sign-in card and builder bar, plus their unused CSS.
- **Legal page buttons:** "Back to Coffee Lab" was default blue link text (link-buttons had no colour of their own), and my earlier `a.button` fix outranked `.button-primary`, so "Return to Coffee Lab" became dark brown on dark brown. Colour now lives on `.button` itself. The legal pages also follow the dark theme now.
- **Receipts:** a shared model (`services/receiptModel.js`) drives both the PDF and the image. Layout: an 80 mm, 42-column point-of-sale receipt with business header, receipt number, date (Manila), item rows, VAT breakdown (VATable / VAT / exempt / zero-rated), and paid or unpaid status. The receipt is reissued when cash is collected, so it says PAID. Business name, address, TIN and BIR permit come from `BUSINESS_*` / `BIR_PERMIT_NUMBER`. Until a permit is set, it says it is a system-generated proof of purchase.

### Profiles for customers and admins

- **Profile page:** customers get a nav button and admins/superadmin a tab. It shows the picture, username, role, member-since date and a bio (280 characters, cleaned on the server).
- **Picture:** the browser crops it to a 256 px square and makes it a JPEG before upload, so it's about 20 KB. The server checks the real type from the bytes (JPEG/PNG/WebP only, no SVG), stores it in the private B2 bucket under `avatars/`, and serves it through `GET /api/profile/avatar/:id?v=<version>`, signed-in only and cached for a year (the URL changes when the picture does).
- **Customer statistics:** most-ordered drink, loyalty points (earned and pending, from `recipe_royalty_summary`), recipes published, orders, drinks, total spent, and usual pickup or delivery. Computed by `customer_profile_stats` in Postgres.
- **Admin statistics** (last 30 days and all time): orders accepted, closed and cancelled, and cash collected. Closed and cash come from the existing approved-by and collected-by columns, so they include earlier work. Accepted and cancelled come from the new `order_events` table, which every admin order action now writes to (best effort: a failed insert never fails the action). Computed by `staff_profile_stats`.
- **Migration `20261109000000_profiles_order_events.sql`** (additive): adds the bio and picture columns, the `order_events` table with indexes and row-level security, and the two statistics functions (service role only).

### Support tickets and chat

- **Customers** (new "Support" nav button with an unread badge) open tickets, with a subject, an optional link to one of their own orders and a first message, and chat with the shop. They see only their own tickets, can close one, and can have at most 5 open.
- **Admins and the superadmin** (new "Support" tab with a "needs reply" badge) see every ticket (Open / Closed / All), answer, close and reopen. The first admin to reply takes the ticket. Support replies count on the admin's profile.
- **Access:** checked on the server for every ticket: its customer or an MFA-verified admin or the superadmin (`hasAdminAccess`, the same rule as `requireAdmin`). Everyone else gets 404. Messages are plain text, cleaned on the server and rendered with `textContent`.
- **Updates:** the open conversation polls `messages?after=<id>` every 5 s while it is on screen, and badges refresh every 30 s. That's enough at this scale; Supabase Realtime is the next step (see the scalability notes).
- **Migration `20261110000000_support_tickets.sql`** (additive): `support_tickets` and `support_messages` with indexes and row-level security, and `staff_profile_stats` gains `supportReplies` (copied from the profiles migration with that one addition, diffed).

### Installable app, receipts out of checkout, Facebook link

- **Installable on phones (PWA):** `manifest.webmanifest`, app icons (192, 512, maskable, Apple touch), and a service worker (`public/sw.js`) that only falls back to cached CSS/JS/icons and an offline page when there's no connection. Pages and `/api` always come from the network, so deploys are live immediately and no stale data is ever shown. The footer shows "Install app" when the browser offers it; on iPhone it explains Share → Add to Home Screen.
- **Receipts no longer slow down checkout:** the order is saved and answered immediately with receipt status `pending`; `services/receiptQueue.js` builds the PDF and image in the background (2 at a time, 3 attempts), and the tracking page checks back after 3 s and 8 s. A sweeper re-queues receipts left pending by a restart. The cash-collected reissue uses the same queue.
- **Footer:** Facebook now links to the real profile.

### Loyalty rewards and "Order again"

- **Earning:** signed-in customers now earn 10 points per drink they buy (on top of recipe royalties), counted once the order is paid; cancelled orders never count. Stored per drink (`order_items.purchase_points`), so changing the rate later won't rewrite history.
- **Free drink at 100 points:** a "Use my points" checkbox at checkout (shown only when the customer has 100+) makes the most expensive drink in the basket free. It's a discount line before the service fee and VAT, on the quote, the order and the receipt. The balance check and the order are one database transaction under a per-account lock, so the same points can't be spent twice; cancelling the order returns them.
- **Profile:** the points card shows the spendable balance with a progress bar to the next free drink.
- **Order again:** every past order in Order history has "Order again" (puts its drinks back in the basket exactly as made, at today's prices). The profile's most-ordered drink card has "Order it again".
- **Fix:** cancelled orders no longer show as "pending" recipe royalties.
- **Migration `20261111000000_loyalty_rewards.sql`** (additive).

### Branches and sold-out switches

- **Branches:** a `branches` table with "Coffee Lab Main" created and every existing order assigned to it. While only one branch is open nothing changes for customers. With two or more, the delivery bar shows a Branch picker (remembered on the device), checkout sends it, and admin orders get a branch filter and a branch label. The superadmin opens, renames and closes branches on the admin Menu tab; the last open branch can't be closed.
- **Sold-out switches:** the admin Menu tab lists every base, decaf beans, milk, syrup, sweetener and topping with an Available / Sold out switch per branch. The builder greys sold-out options out ("Sold out"), refuses to add a drink that uses one, and "Order again" skips such drinks. Checkout re-checks on the server and answers 409 naming the drink and the missing ingredient.
- **Compatibility:** everything works before the migration: no branches means orders behave as before, the admin list falls back quietly, and the Menu tab explains that the migration is needed.
- **Migration `20261112000000_branches_sold_out.sql`:** additive, plus a one-time backfill of `orders.branch_id`.

### Support: welcome note on every ticket

- Right after the customer's opening message, the chat shows a note from Coffee Lab: "Thank you for using Coffee Lab! You'll be connected with an admin shortly, and they'll reply right here in this chat." Staff see it too, so they know what the customer was told.
- It's drawn by the page rather than saved as a message, so it never marks a ticket as answered, never counts as an admin's support reply, and also appears on tickets opened before this change. No database change.

### Superadmin sign-in on phones; masked answers

- **Fix:** typing Super_Admin and tapping **Log in** now opens the security-question screen. Before, the empty (required) password box made the browser block the button, and phones have no Enter key to fall back on. The password box is no longer required while Super_Admin is typed, and anything in it is cleared when the superadmin screen opens.
- **Masked:** birthday, favourite dog and favourite colour are now hidden like the password (they act as passwords). A test keeps all four masked.

### − and + buttons on every builder slider

- Espresso shots and Foam aeration now have − and + buttons like Drink size, for anyone who can't drag a slider (small screens, motor impairments, trackpads). Each button turns off at the slider's end, so a press always does something.

### Admin orders: newest first

- The admin Orders tab now lists newest first in every view. "Active" used to list oldest first, like a work queue. The age badge still flags orders that have waited too long.

### Branches tab; UI/UX review fixes

- **Branches tab (superadmin only):** opening, renaming and closing branches moved out of the Menu tab into its own tab. Regular admins don't see it; a remembered Branches tab falls back to Orders for them. Menu keeps the sold-out switches for every admin.
- **Fix:** the Menu and Branches tabs stayed blank when they were already open on page load (remembered tab); they now load straight away.
- **Admin orders:** columns line up on every row (fixed-width status and action columns, full-width action buttons); on phones the age column is fixed too.
- **Branch rows:** the same columns on every row, the "Add branch" row included.
- **Phones:** the "Coffee Lab" name no longer breaks onto two lines, and the customer nav stays on one line (it scrolls sideways if needed) instead of wrapping labels like "Order history".
- **Builder:** removed the stray "Crafted to your taste." line above the basket buttons (the footer already says it); the buttons sit on the right.
- **Admin subtitle** now mentions the menu and branches.
- **Follow-up (risks from the review):**
    - On screens 761–1000 px wide, the admin order's drinks summary moves to its own line under the customer's name instead of being squeezed by the fixed status and action columns.
    - On phones up to 520 px, the customer nav uses short labels ("Customize", "Orders", "Support", "Profile") and fits on one line down to 360 px. On narrower phones it scrolls, and the edge with more buttons fades out as a visible hint.
