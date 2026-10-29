# Contributing to Coffee Lab

Coffee Lab is a solo hackathon project, but changes should be easy for another developer to review.

## Before changing code

1. Read `README.md`, `AGENTS.md`, and `.github/copilot-instructions.md`.
2. Check the current default branch in GitHub. The current repository default may change; do not assume a historical branch is current.
3. Keep one pull request focused on one phase or concern.
4. Never open or print `.env`, copy secrets into prompts, or include customer data in logs.
5. Do not run SQL against Supabase. Add a migration file for the maintainer to review and apply manually.

## Branches and commits

- Create a branch named `phase-<n>-<short-topic>`.
- Do not push directly to `main` or the default branch.
- Use conventional commit prefixes: `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`.
- Keep commits small enough to explain and review.

## Tests and checks

Run `npm ci` and `npm test` before requesting review for code changes. Run the CI lint, formatting, and audit commands when possible. Include exact command results in the PR; if a check cannot run, explain why rather than claiming success.

## Pull request checklist

- Explain what changed and why.
- Give exact steps to verify.
- List manual checks the reviewer must do.
- Confirm cash-only payment remains unchanged.
- Confirm no secret values, user data, or real environment configuration are included.
- Review migrations for additive/backward-compatible behavior; never apply them automatically.
- Review CI results and inspect the final diff.
- Do not merge automatically; the repository owner reviews and merges.

## Architecture boundaries

- Keep CommonJS; do not convert the project to ESM without approval.
- Keep the frontend plain HTML/CSS/JavaScript with no build step.
- Customer auth remains custom `coffee_users` / `coffee_sessions`; Supabase Auth is for administrators.
- Backblaze B2 stores receipt files only.
- Cash on pickup/delivery is the only payment method.
- Continue polling order status for the demo; do not introduce realtime infrastructure as part of this scope.
