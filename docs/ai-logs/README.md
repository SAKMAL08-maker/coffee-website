# AI work logs

This folder records how AI tools contributed to Coffee Lab, so reviewers can tell what was AI-assisted and what a human checked.

## What gets logged

- **`CHANGELOG-AI.md`**: one entry per AI-assisted phase or pull request, appended at the end of the work. Each entry has:
    - **Date** (absolute, `YYYY-MM-DD`)
    - **Tool and model** (e.g. Claude Code, Claude Opus 5.5)
    - **What changed** and **why**
    - **Human checks required**: things the owner must verify by hand before or after merging (live services, secrets, migrations, UI behavior)
    - **PR link** once the PR is open
- **Pull request descriptions**: the real `npm ci` / `npm test` output and a self-review risk list, written before the owner reviews.

## Rules

1. The AI never approves or merges its own pull requests. The owner reviews and merges every change.
2. Entries describe what the AI did. They never invent what the owner did, thought, or corrected; the owner writes those parts.
3. No secrets, keys, customer data, or `.env` contents ever go into a log.
4. Logs are append-only. Fix mistakes with a new dated note instead of rewriting history.

## History before logging started

Work before 2026-10-30 (GitHub Copilot, ChatGPT) has no checked-in transcripts. The only evidence is commit messages; see section 4 of [DOCUMENTATION.md](../../DOCUMENTATION.md).
