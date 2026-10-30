## What and why

<!-- What does this PR change, and what problem does it solve? Link the issue: "Closes #123". -->

## How it was verified

<!-- Paste real output, not "tests pass". -->

- [ ] `npm ci`
- [ ] `npm run lint`
- [ ] `npm test`
- [ ] Manual check in the browser (describe what you clicked):

## Database migrations

- [ ] None
- [ ] Yes: file(s) and the order to apply them. Migrations must be additive and applied to Supabase **before** merging.

## Risks

<!-- What could break? What did you deliberately leave out? -->

## AI assistance

- [ ] No AI used
- [ ] AI used: tool, what it did, and what you checked by hand. Add an entry to `docs/ai-logs/CHANGELOG-AI.md`.

## Checklist

- [ ] No secrets, keys, or `.env` values in the diff
- [ ] New request inputs are validated with Zod in `schemas/`
- [ ] New sensitive or high-frequency routes have a rate limiter
- [ ] Docs updated (README / DOCUMENTATION / ADRs) if behavior changed
