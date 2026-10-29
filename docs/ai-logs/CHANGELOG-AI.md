# AI-assisted change log

## 2026-10-30 — Phase 0: repository hygiene

- **What changed:** Added the README, MIT license, LF normalization, AI-use guidance, and a dated change log; updated package metadata to MIT and removed the unused `pg` dependency.
- **Decisions and why:** Keep CommonJS and plain HTML/CSS/JS. Document cash-only checkout and the existing customer-custom-auth/admin-Supabase-Auth split. Use placeholders only in environment examples.
- **Verification:** `npm test` was attempted against the supplied ZIP workspace but failed because dependencies were missing from its `node_modules`; `npm ci` timed out in this environment.
- **Maintainer must verify by hand:** Run `npm ci` and `npm test` in a network-enabled clean checkout; review the README architecture and MIT license.

## 2026-10-30 — Phase 1: CI and deploy configuration

- **What changed:** Added `GET /healthz`, CI workflow, ESLint/Prettier config, Render blueprint, PR template, issue templates, and a test for the health endpoint's missing-configuration response.
- **Decisions and why:** Health checks perform a read-only query and return only generic dependency status. Render secret variables are marked as dashboard-supplied, never embedded in the blueprint.
- **Verification:** Tests not verified in this environment: dependencies were missing from the ZIP's `node_modules`, and `npm ci` timed out. CI must be observed after the draft PR is updated.
- **Maintainer must verify by hand:** Confirm the `coffee_users.id` column from checked-in migrations, inspect the Render blueprint before applying it, and verify dashboard environment-variable names.

## 2026-10-30 — Phase 2: collaboration documentation

- **What changed:** Added `CONTRIBUTING.md`, four ADRs, `docs/runbook.md`, and `PLAN.md`. AI examples and personal learning reflections remain placeholders for the maintainer to complete with real events.
- **Decisions and why:** Document current architecture rather than inventing personal experiences or claiming legal/security certification. Keep manual migration review and PR approval explicit.
- **Verification:** Documentation-only changes have not been linted or tested locally in this environment.
- **Maintainer must verify by hand:** Confirm the ADRs match actual implementation, complete the learning log and AI examples honestly, and review deployment steps against current Render/Supabase/B2 dashboards.

## 2026-10-30 — Phase 4: cash handling

- **What changed:** Added an additive migration for cash-only payment metadata and collection tracking; added a server-side collection helper, admin-only rate-limited route/action, checkout notice, and cash payment instructions on receipt PDF/image.
- **Decisions and why:** Cash remains the only payment method. Collection is one-way and uses conditional updates to reduce duplicate marking; no payment processing was added.
- **Verification:** Tests could not be run in this environment because dependencies are incomplete and `npm ci` timed out.
- **Maintainer must verify by hand:** Review/apply the migration manually after checking the referenced `coffee_users` table; test the admin action with a demo order and confirm receipt regeneration reflects cash payment.
