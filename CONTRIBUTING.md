# Contributing to Coffee Lab

Thanks for helping. This guide covers how work flows from an idea to production. For first-time setup, start with the [README](README.md).

## Workflow at a glance

1. **Open or pick an issue** (use the bug or feature form) so the work is visible before code is written.
2. **Branch from `main`** using a descriptive name:
    - `feature/<short-topic>`: new behavior (e.g. `feature/community-recipes`)
    - `fix/<short-topic>`: bug fixes
    - `chore/<short-topic>` or `docs/<short-topic>`: tooling or documentation
    - `phase-<n>-<topic>`: planned roadmap phases from [PLAN.md](PLAN.md)
3. **Make small, focused commits** (see message format below).
4. **Run the checks locally** before pushing:
    ```bash
    npm run lint
    npm run format:check   # or `npm run format` to fix
    npm test
    ```
5. **Open a pull request** against `main`. The PR template asks for real verification output, migrations, risks, and AI usage.
6. **CI must be green** (lint, format, tests, audit).
7. **The owner reviews and merges** with **"Create a merge commit"**. Nobody merges their own PR, and AI tools never merge.
8. Render deploys `main` automatically; check `/healthz` and the [runbook](docs/runbook.md) post-deploy checks.

## Commit messages

Use the [Conventional Commits](https://www.conventionalcommits.org/) style already in the history:

```
feat: add cash-collected admin action
fix: keep pickup orders out of "Out for Delivery"
docs: add ADR for receipt storage
chore: bump express to 5.1.1
style: formatting only
test: cover delivery fee rounding
```

The first line says _what_ changed in under ~72 characters; the body (optional) says _why_.

## Code conventions

These keep the codebase predictable; reviewers will ask for them.

| Area          | Convention                                                                                                                                                                       |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Layers        | `routes/` wire URLs to middleware and a controller; `controllers/` handle HTTP; `services/` hold business logic and integrations. Controllers should not contain business rules. |
| Naming        | camelCase, descriptive names (`calculateOrderPricing`, not `calc`). Files are camelCase too.                                                                                     |
| Modules       | CommonJS (`require` / `module.exports`).                                                                                                                                         |
| Validation    | Every new body, query, and route param gets a strict Zod schema in `schemas/requestSchemas.js`, applied with `validateRequest`.                                                  |
| Rate limiting | Sensitive or high-frequency routes get a limiter from `middleware/rateLimiters.js`.                                                                                              |
| Errors        | `async` handlers use `try/catch` and call `next(error)`. The global handler in `server.js` logs details and returns generic JSON; never send raw error messages to the client.   |
| Money         | Integer centavos (`*_cents`) on the server. Never trust a price sent by the browser. See [ADR-0001](docs/adr/0001-server-side-pricing.md).                                       |
| Database      | Use the Supabase query builder (parameterized). Never build SQL by string concatenation.                                                                                         |
| Secrets       | Only in `.env` (local) or Render environment settings. Never in code, tests, logs, issues, or PRs.                                                                               |
| Comments      | Explain _why_ (intent, trade-offs), not what the syntax does.                                                                                                                    |

## Tests

- Tests live in `test/` and run with Node's built-in runner (`npm test`).
- Behavior changes need a test that would fail without the change.
- Tests must not call real Supabase or Backblaze. Use an injected fake (see `test/health.test.js`). CI runs without any secrets.

## Database migrations

- Add a new file in `supabase/migrations/` named `YYYYMMDDHHMMSS_short_description.sql`. Never edit a migration that has already been applied.
- Migrations must be **additive and backward compatible**: new nullable columns or columns with defaults, new tables, new indexes. The currently deployed code must keep working after the migration runs.
- In the PR, list the exact order to apply the migration files. The owner applies them in Supabase **before** merging, so the new code never runs against an old schema.
- Enable row-level security on new tables (the server uses the service key; RLS blocks any accidental public access).

## Using AI tools

AI assistance is welcome and must be transparent:

- Say in the PR which tool you used and what you verified by hand.
- Add an entry to [`docs/ai-logs/CHANGELOG-AI.md`](docs/ai-logs/CHANGELOG-AI.md).
- Never paste secrets, `.env` contents, or customer data into an AI tool.
- You are responsible for every line you submit, whoever wrote it. See [AI-USAGE.md](AI-USAGE.md).

## Reporting security issues

Do not open a public issue for vulnerabilities. Contact the repository owner privately through GitHub.
