# Operations runbook

Step-by-step procedures for running Coffee Lab in production. First-time setup (Supabase project, admin linking, B2 bucket) is in [instructions/guide.md](../instructions/guide.md).

**Where things live**

| What                  | Where                                                                   |
| --------------------- | ----------------------------------------------------------------------- |
| App hosting           | Render web service (free plan), auto-deploys the `main` branch          |
| Database + admin auth | Supabase project (free plan)                                            |
| Receipt files         | Backblaze B2 private bucket                                             |
| Secrets               | Render → service → **Environment**; local `.env` (never committed)      |
| Health                | `GET /healthz` → `200 {"status":"ok"}` / `503 {"status":"unavailable"}` |

---

## 1. Deploy

Deploys happen when a PR is merged into `main`.

1. **Before merging:** if the PR has migrations, apply them in Supabase (**SQL Editor**) in the order the PR lists. They are additive, so the currently running app keeps working.
2. Merge the PR with **"Create a merge commit"**.
3. Render → service → **Events**: wait for "Deploy live" for the merge commit (usually a few minutes). If it fails, open the deploy log; the old version keeps serving.
4. **Verify:**
    - `https://<your-app>.onrender.com/healthz` returns `{"status":"ok"}`
    - Home page loads; place one pickup order; open its receipt
    - Admin login with TOTP reaches the dashboard
5. Note anything unusual in the PR as a comment.

If Render isn't deploying merges, check **Settings → Build & Deploy**: branch must be `main` and auto-deploy on.

## 2. Roll back

Pick the smallest rollback that fixes the problem.

**App code (most common):**

1. Render → **Events** → find the last good deploy → **Rollback**. This redeploys that exact build within minutes.
2. Render may switch auto-deploy off after a rollback. Check **Settings** and turn it back on once `main` is fixed.
3. Fix `main` properly: on GitHub, open the bad PR → **Revert** → merge the revert PR. Now `main` matches what's running.

**Database:**

- Migrations are additive, so rolling back the **app** never requires rolling back the database: old code ignores new columns.
- Do **not** drop columns or tables in a hurry. If a migration itself is wrong, write a new corrective migration and apply it like any other.
- Free Supabase projects have limited backup options. Before any risky manual SQL, export the affected tables first (Table Editor → export CSV, or `supabase db dump` with the Supabase CLI).

## 3. Rotate keys

Rotate immediately if a key may have leaked (pasted in chat, committed, shown on screen, laptop lost), and otherwise on a regular schedule.

### Supabase server key (`SUPABASE_SERVICE_ROLE_KEY`)

Legacy `service_role` keys can't be rotated individually; use the newer secret keys (`sb_secret_…`).

1. Supabase → **Project Settings → API Keys** → create a new **secret key**.
2. Render → **Environment** → set `SUPABASE_SERVICE_ROLE_KEY` to it → **Save** (triggers a redeploy). Update your local `.env` too.
3. Verify: `/healthz` OK, a customer can log in and order, **admin TOTP login works** (admin login uses this key).
4. Only after step 3 passes: delete/disable the old secret key (or the legacy keys) in Supabase.

### Backblaze B2 key (`B2_KEY_ID`, `B2_APPLICATION_KEY`)

1. Backblaze → **Application Keys** → **Add a New Application Key**, restricted to the receipts bucket.
2. Update both variables in Render (and `.env`) → save → redeploy.
3. Verify: open a receipt preview and download on a recent order.
4. Delete the old application key in Backblaze.

### Customer sessions (log everyone out)

If session tokens may be compromised, run in the Supabase SQL Editor:

```sql
delete from public.coffee_sessions;
```

Every customer will need to sign in again. Passwords are unaffected.

### Admin authenticator (lost phone or suspected compromise)

**Easiest:** sign in as another admin, open **Admin access** on the admin page, and click **Reset** next to them (or **Approve setup** for a brand-new admin). Their old authenticator stops working, and at their next sign-in, within 24 hours, they scan a new QR code with no key to type. Set `ADMIN_APPROVER_USERNAMES` on Render (comma-separated) to limit who can do this. Without it, any MFA-verified admin can.

**New admin (usual way):** the person signs up as a customer. The superadmin opens **Accounts → Customers**, clicks **Make admin** next to them and enters an email for their admin sign-in. They keep their username and password; at their next login (within 24 hours) they scan a QR code with an authenticator app. Until then they're listed in **Admin access**, where the superadmin can **Renew approval** or **Remove admin rights**; after that they appear under **Accounts → Admins**.

**New admin (terminal):** `NEW_ADMIN_PASSWORD=... node scripts/create-admin-account.js <username> --email <email>` creates the confirmed Supabase Auth user and the linked admin account in one step. Then approve them as above.

**Terminal fallback:** follow [guide.md §6](../instructions/guide.md#6-owner-authorized-first-totp-enrollment): run `node scripts/admin-mfa-bootstrap.js <admin-username> --confirm-reset` locally. It deletes the admin's existing factors and approves a new setup for 24 hours (no key to pass on). Also change that admin's Supabase Auth password (Supabase → **Authentication → Users**).

### Superadmin (create, reset, unlock)

- **Unlock or lock:** Supabase → **Table editor → superadmin_security** → set `locked` to `false` (unlock) or `true` (lock).
- **Create or reset** (new password or answers; also unlocks): set `SUPERADMIN_PASSWORD`, `SUPERADMIN_BIRTHDAY`, `SUPERADMIN_DOG` and `SUPERADMIN_COLOR` in your shell, run `node scripts/create-superadmin.js`, then clear them. Never put them in `.env` or a commit.

## 4. Keep-alive (free tiers)

Free Render services sleep after ~15 minutes idle (first request then takes ~30–60 s), and free Supabase projects pause after about a week without database activity. `/healthz` runs a real one-row query, so one external ping prevents both.

**Set up (once), with UptimeRobot (free) or cron-job.org:**

1. Create an **HTTP(s)** monitor for `https://<your-app>.onrender.com/healthz`.
2. Interval: **every 10–14 minutes** (must be under 15).
3. Alert contact: your email, so you hear about real outages (`503` = database problem; timeout = Render problem).

**Rules:**

- Ping **one** service only. A service awake 24/7 uses ~744 of Render's 750 free instance hours per month.
- Do **not** set Render's own _Health Check Path_ to `/healthz`: Render probes far more often, and every probe would query Supabase.
- `/healthz` is rate-limited to 30 requests/minute; a pinger uses about 1 per 10 minutes.

**If the monitor alerts:**

| Symptom                    | Likely cause                        | Check                                                                 |
| -------------------------- | ----------------------------------- | --------------------------------------------------------------------- |
| `503 unavailable`          | Supabase down, paused, or key wrong | Supabase dashboard status; Render logs for "Health check failed"      |
| Timeout / connection error | Render service down or deploying    | Render **Events** and **Logs**                                        |
| `404 Not found`            | Running code older than `/healthz`  | Render deploy branch is `main`; latest deploy succeeded               |
| `429`                      | Rate limit hit by other traffic     | Usually harmless; if persistent, see `TRUST_PROXY_HOPS` in the README |

## 5. Incident checklist

1. **Contain:** rotate the affected key (§3) or roll back (§2).
2. **Verify:** `/healthz`, a test order, admin login.
3. **Record:** open a GitHub issue describing what happened, when, impact, and the fix, with no secrets or customer data in it.
4. **Prevent:** add a test, a check, or a runbook step so it can't recur silently.
