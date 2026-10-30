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
- **Branch:** `phase-2-collaboration-docs`

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
