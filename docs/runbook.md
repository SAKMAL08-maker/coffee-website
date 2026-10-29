# Coffee Lab runbook

This runbook is for the hackathon demo and assumes one Render free web service, Supabase free, and Backblaze B2 free. Provider behavior and quotas can change; verify current settings in each dashboard.

## Deploy

1. Review and merge the approved PR yourself.
2. Confirm Render's connected repository and deploy branch before expecting an automatic deployment.
3. Verify the service uses `npm ci` and `npm start`, and `NODE_ENV=production`.
4. Configure `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and B2 variables in Render's environment settings. Never put values in this repository or issue comments.
5. Check `GET /healthz`; HTTP 200 indicates the read-only Supabase query succeeded. HTTP 503 indicates the database dependency check failed.
6. Manually test login, a cash-only pickup order, a cash-only delivery order, order status, and receipt access.
7. Review Render logs for errors without copying secrets or personal information into reports.

## Database migrations

- Review each SQL migration before applying it.
- Apply migrations manually in timestamp order using the Supabase dashboard/tooling you control.
- Never run migrations from CI or automatically at server startup.
- Do not use destructive SQL without a separately approved migration plan.

## Rollback

1. Identify the last known-good commit/deployment in Render.
2. Use Render's rollback/redeploy controls to restore that version; verify current provider UI before acting.
3. If a migration has already been applied, do not assume rolling back application code reverses the schema. Review a compatible forward fix with the maintainer.
4. Verify health, authentication, checkout, order tracking, and receipts after rollback.

## Key rotation

1. Rotate the affected key in its provider dashboard.
2. Update the corresponding Render environment variable directly in the dashboard.
3. Redeploy/restart the service as required.
4. Verify the affected integration.
5. Never paste old or new key values into GitHub, chat, logs, or this runbook. If a key was committed, treat it as exposed and rotate it; deleting a file alone does not revoke it.

## Keep-alive and free-tier caveats

The `/healthz` endpoint makes a read-only Supabase query and is suitable for monitoring. A scheduled pinger may be used if provider terms permit, but it cannot guarantee the free Render service or Supabase project stays awake, and should not be used to evade provider limits. Check free-tier policies and current quota/idle behavior first.

## Privacy and incidents

- Never include customer names, addresses, phone numbers, tracking codes, or receipt contents in public issues.
- Limit access to provider dashboards and rotate credentials if exposure is suspected.
- Report suspected personal-data exposure to the project owner promptly and follow the applicable incident response process.
