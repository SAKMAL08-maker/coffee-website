# AI usage and review notes

Use AI as a pair-programming and review aid, not as an authority. The human maintainer owns design choices, security decisions, tests, and merge approval.

## Practical rules

- Give tools only the files required for the current task; never provide `.env`, keys, tokens, customer data, or production credentials.
- Ask for small diffs, tests, assumptions, and manual verification steps.
- Review every suggested migration before applying it. AI tools must not connect to or mutate the Supabase database.
- Run the project's tests locally and report results accurately. A generated test is not proof until it runs.
- Do not merge PRs automatically. Review changed files and CI results first.
- Record actual AI-assisted changes in `docs/ai-logs/CHANGELOG-AI.md`.

## Human-completed examples

Fill these in with examples from your own work. Do not present the placeholders as events that already happened.

1. **AI suggestion I corrected:** [Describe the actual suggestion and why it was wrong.]
   - **My correction:** [What you changed.]
   - **Evidence:** [Commit, diff, test, or documentation.]
2. **AI suggestion I corrected:** [Describe another real example.]
   - **My correction:** [What you changed.]
   - **Evidence:** [Commit, diff, or documentation.]
3. **AI output I verified:** [Describe the actual output.]
   - **How I verified it:** [Commands or manual checks and the real outcome.]

## Review checklist

- [ ] No secrets or personal data in prompts, logs, or commits.
- [ ] I understand the diff and can explain the decision.
- [ ] Tests were actually run and the result is recorded.
- [ ] Migration SQL was reviewed and applied manually by the maintainer, if applicable.
- [ ] I reviewed the PR before merging.
