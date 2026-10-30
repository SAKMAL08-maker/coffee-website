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
