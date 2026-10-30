# How AI is used on Coffee Lab

AI tools helped build this project. This page explains which ones, how they were used, how their output is checked, and where they got things wrong.

## Tools

| Tool                          | Period             | How it was used                                                       | Evidence                                                                               |
| ----------------------------- | ------------------ | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| GitHub Copilot                | 2026-10-22 → 10-26 | HTML rework, backend scaling, security review, admin-panel bug fixing | Commit messages that name Copilot (see [PLAN.md learning log](PLAN.md#3-learning-log)) |
| ChatGPT                       | 2026-10-29         | Opened phase PRs #2–#8                                                | All seven were **closed without merging** and their branches deleted                   |
| Claude Code (Claude Opus 5.5) | 2026-10-30 →       | Phased improvements, one PR per phase                                 | [docs/ai-logs/CHANGELOG-AI.md](docs/ai-logs/CHANGELOG-AI.md), PR descriptions          |

## Working rules

1. **The owner decides and merges.** AI proposes changes in a pull request; the owner reviews and merges. AI never approves or merges its own work.
2. **Verification is shown, not claimed.** Every AI PR includes the real output of `npm ci`, lint, and `npm test`, a list of files changed _and_ files checked, and a self-review risk list.
3. **Small steps.** One phase per branch and PR, so each change can be reviewed and reverted on its own.
4. **No secrets in prompts.** `.env` values, keys, and customer data are never pasted into an AI tool.
5. **Instructions are versioned.** The guidance AI tools read lives in the repo: [`CLAUDE.md`](CLAUDE.md), [`AGENTS.md`](AGENTS.md), [`.github/copilot-instructions.md`](.github/copilot-instructions.md). When they were found to be wrong (claiming `server.js` was empty), they were fixed in Phase 0.

## When AI got it wrong

### Recorded in the repository

- **Copilot chose the wrong stack.** Commit on 2026-10-22: _"made an error with copilot, it used mongo and jwt, converted to supa"_.
    > ✍️ _Owner: how did you notice, and what did you change?_
- **ChatGPT's phase PRs were discarded.** PRs #2–#8 were closed unmerged and the work restarted with Claude Code.
    > ✍️ _Owner: why did you reject them? What was wrong or missing?_
- **Claude Code exposed secrets during setup (2026-10-30).** While searching the code for unused variables, Claude ran a search that didn't exclude `.env`, printing two secret values into the AI session. Claude reported it immediately; the owner rotated the Supabase key by hand and removed the unused values. Since then every search excludes `.env*`, and it is logged in [CHANGELOG-AI.md](docs/ai-logs/CHANGELOG-AI.md).
- **Claude's first doc-edit script failed on Windows line endings (2026-10-30).** It expected LF but the working copy was CRLF; the script's own check stopped it before writing anything, and the edit was redone safely.

### Your corrections

> ✍️ **Owner: fill these in with real examples only.** Reviewers value specific moments where you caught or overrode AI output. Use this format for each:
>
> - **Date / tool:**
> - **What the AI produced:**
> - **What was wrong:**
> - **How you noticed:**
> - **What you did instead:**

1. _(placeholder)_
2. _(placeholder)_
3. _(placeholder)_

## What AI is good and bad at here (owner's view)

> ✍️ _Owner: a few sentences in your own words._
