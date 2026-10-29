# AI-assisted change log

## 2026-10-30 — Phase 0: repository hygiene

- **What changed:** Started repository hygiene on `phase-0-repo-hygiene`: added project README, MIT license, LF normalization, AI-use guidance, and a dated change log; updated package metadata to MIT and removed the unused `pg` dependency.
- **Decisions and why:** Keep CommonJS and the plain HTML/CSS/JS frontend. Document cash-only checkout and the existing customer-custom-auth/admin-Supabase-Auth split. Use placeholders only in environment examples.
- **Verification:** Not yet run in a local project workspace at the time of this entry. Do not interpret this entry as a successful test report.
- **Maintainer must verify by hand:** Compare README architecture with current code; check free-tier provider limits; review license ownership; verify environment variable names in Render; inspect each PR diff and run `npm ci` and `npm test`.
