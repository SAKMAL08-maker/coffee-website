# Coffee Lab Setup and Operations Guide

This guide covers local development, the Render deployment, Supabase database/authentication setup, Backblaze B2 receipt storage, and the administrator MFA bootstrap process.

> **Secret-handling rule:** Never send or commit passwords, Supabase service-role keys, Backblaze application keys, MFA setup keys, one-time bootstrap tokens, TOTP codes, or production `.env` values.

## 1. Services and responsibilities

| Service | Purpose |
|---|---|
| GitHub — `SAKMAL08-maker/coffee-website` | Source repository and Git history. |
| Render | Hosts and runs the Node.js/Express application. |
| Supabase | PostgreSQL database and Supabase Auth identities/MFA. |
| Backblaze B2 | Private object storage for generated order receipt PDFs and preview images. |

The browser calls the Express API. Supabase service-role and B2 credentials are used by the server only; they must not be put into frontend JavaScript.

## 2. Local development

### Prerequisites

- Node.js LTS compatible with the project dependencies.
- npm.
- Access to a Supabase project with the migrations applied.
- Optional: a private B2 bucket and bucket-scoped credentials if testing receipt storage.

### Clone and install

```powershell
git clone https://github.com/SAKMAL08-maker/coffee-website.git
Set-Location coffee-website
npm ci
Copy-Item .env.example .env
```

Use the branch currently agreed by the team; do not assume the default branch or an old release branch is the active development branch.

### Configure local environment

Edit `.env` with the correct Supabase project:

```dotenv
PORT=3000
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-server-only-service-role-key
```

For receipt storage, fill in **all** values in the `B2_*` group from `.env.example`:

```dotenv
B2_BUCKET_NAME=your-private-bucket
B2_ENDPOINT=https://s3.your-region.backblazeb2.com
B2_REGION=your-region
B2_KEY_ID=your-bucket-scoped-key-id
B2_APPLICATION_KEY=your-bucket-scoped-application-key
```

If B2 variables are omitted, receipt storage is unavailable in that environment. Partial B2 configuration is an error. Never use production credentials for local development if a separate staging project/bucket is available.

Run the server and tests:

```powershell
npm start
npm test
```

The app defaults to `http://localhost:3000` unless `PORT` is set. There is no frontend build step.

## 3. Supabase database setup

### Select the correct project

Use the same Supabase project in:

- Supabase Dashboard / SQL Editor.
- The local `.env` or Render environment variable `SUPABASE_URL`.
- The corresponding server-only `SUPABASE_SERVICE_ROLE_KEY`.

Applying migrations to a different project will not fix the database used by the app.

### Apply migrations

Check the project’s migration history and current schema first. Apply only migrations that have not already succeeded, in timestamp order, and stop if any migration returns an error. Do not blindly rerun or skip migrations on a database with partial/older schema.

Repository migration order:

1. `supabase/migrations/20261022000000_coffee_lab.sql`
2. `supabase/migrations/20261025000000_username_accounts.sql`
3. `supabase/migrations/20261026000000_order_receipts.sql`
4. `supabase/migrations/20261027000000_delivery_approval.sql`
5. `supabase/migrations/20261028000000_pickup_approval.sql`
6. `supabase/migrations/20261029000000_receipt_image.sql`
7. `supabase/migrations/20261030000000_admin_supabase_auth.sql`
8. `supabase/migrations/20261031000000_admin_mfa_factor_approval.sql`

When applying manually in the SQL Editor, run each required file separately and confirm success before moving to the next. In particular, the first migration creates `public.profiles` and its Auth-user trigger; later migrations depend on earlier tables.

Confirm that core tables exist:

```sql
select
    to_regclass('public.profiles') as profiles_table,
    to_regclass('public.coffee_users') as coffee_users_table,
    to_regclass('public.orders') as orders_table;
```

The `profiles_table` should not be `null` after the base migration succeeds. This query checks table presence only; it does not certify all policies, grants, columns, or migration versions.

## 4. Configure Render

In the Render service connected to the GitHub repository:

1. Confirm the connected repository and deployment branch.
2. Set the Node.js start command to `npm start`.
3. Use `npm ci` as the install/build command where appropriate; there is no separate frontend compilation.
4. Add secrets through Render’s protected environment settings, not through committed files.
5. Set at minimum:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `NODE_ENV=production`
6. Set the complete `B2_*` variable group to enable receipt storage.
7. Confirm HTTPS is enabled and verify the deployment’s proxy arrangement before setting `TRUST_PROXY_HOPS`.
8. Confirm whether auto-deploy is enabled and which branch triggers it. This configuration is managed in Render and is not defined by repository files.
9. Deploy, inspect the Render logs, and run the verification steps below.

`NODE_ENV=production` enables production cookie/security behavior, including `Secure` cookies and HSTS. Do not set proxy trust values by guesswork.

## 5. Create and link an administrator

Admin authentication uses a Supabase Auth identity linked to an existing Coffee Lab admin username. The old Coffee Lab custom password is not used for an admin’s Supabase Auth sign-in.

1. Apply the required database migrations, including migrations `20261030000000` and `20261031000000`.
2. In Supabase Dashboard, open **Authentication → Users** and create the admin’s Auth user with an email and a strong password. Confirm the email.
3. Open `supabase/admin-account-setup.sql`, replace:
   - `REPLACE_WITH_ADMIN_EMAIL` with the new Auth user email.
   - `REPLACE_WITH_EXISTING_USERNAME` with the intended existing Coffee Lab username.
4. Run the SQL in the same Supabase project. Check that the returned row is the intended Coffee Lab account, has `role = admin`, and has a non-null `supabase_auth_user_id`.
5. Confirm that the Render service uses this same Supabase project.

Do not create a second Coffee Lab username if an account already exists and should be promoted.

## 6. Owner-authorized first TOTP enrollment

The bootstrap operation clears existing MFA factors for the linked Supabase Auth user before issuing a new, short-lived setup authorization. This can invalidate the admin’s existing authenticator and active sessions. Run it **only for the intended linked admin**, when you are authorized to reset that user’s MFA.

From the repository root, with the correct project credentials in the local environment:

```powershell
node scripts\admin-mfa-bootstrap.js <admin-username> --confirm-reset
```

Example format (replace the placeholder):

```powershell
node scripts\admin-mfa-bootstrap.js julian_admin --confirm-reset
```

The script prints the setup authorization once and reports its expiry. Treat this token as a secret:

1. Verify the printed username is correct.
2. Deliver the token directly to the intended admin over a separate trusted channel.
3. The admin signs in to Coffee Lab using the Coffee Lab username and the Supabase Auth password.
4. On the administrator verification screen, enter the setup authorization and select **Authorize authenticator setup**.
5. Scan the displayed QR code with the admin’s authenticator app. Keep the TOTP setup key private.
6. Enter the current six-digit authenticator code and select **Verify and continue**.
7. Confirm the admin can reach the dashboard, then sign out and test a new login using the password and a fresh TOTP code.

The bootstrap authorization expires after 30 minutes and is consumed after successful enrollment. It is **not** used for future logins. Every subsequent admin sign-in requires the password and a code from the approved authenticator.

If setup is interrupted or the token expires, the project owner may rerun the script. It deletes any current Auth factors for that user and creates a new authorization, so coordinate with the admin first. Do not paste the token, QR code, setup secret, password, or TOTP code into support chats or logs.

## 7. Backblaze B2 receipt storage

The app creates PDF and SVG receipt objects and stores them in the configured B2 bucket. The server records receipt state and object keys in Supabase and provides short-lived signed URLs only after checking customer ownership or admin authorization.

1. Create/use a private B2 bucket.
2. Create a bucket-scoped S3-compatible application key with only the operations the application requires (upload, read/signing, and delete if admin order deletion is enabled).
3. Configure `B2_BUCKET_NAME`, `B2_ENDPOINT`, `B2_REGION`, `B2_KEY_ID`, and `B2_APPLICATION_KEY` locally or in Render.
4. Confirm all values refer to the same B2 account, bucket, and region.
5. Place a test order in a non-production environment and generate/view its receipt from the customer/admin UI.
6. Confirm objects appear in the expected `receipts/` prefix and that the bucket remains private.

If receipt status reports unavailable, check whether all B2 variables are configured in the environment running the app. If generation fails, inspect the server/Render logs and verify application-key permissions. Never make the bucket public as a workaround.

## 8. Release and post-deployment checks

Before release:

```powershell
npm ci
npm test
```

Then verify in staging before production:

- The home page and static assets load over HTTPS.
- A customer can create an account, sign in, check out, and view only their own order history/receipt.
- Delivery and pickup orders follow the correct admin approval paths.
- Admin login requires a TOTP code every time; a password-only session cannot use admin APIs.
- An unapproved or extra Auth factor causes Coffee Lab admin access to fail closed.
- Receipt generation and signed preview/download work with a private B2 bucket.
- Render logs do not show configuration, token, or credential leakage.

Monitor Render, Supabase, and Backblaze logs after deployment. Keep a rollback plan for both app releases and database changes. A passing local test suite does not validate live provider configuration.

## 9. Troubleshooting

| Symptom | Checks |
|---|---|
| `public.profiles` is `null` | Verify the base migration was applied successfully to the Supabase project configured in Render. |
| Admin password is rejected | Check that the Coffee Lab username exists, is `admin`, links to the intended confirmed Auth user, and that the password is the Supabase Auth password. |
| “Authenticator setup is not authorized” | Confirm migration `20261031000000` and the updated app are deployed, rerun the owner bootstrap for the intended username, and use the newly issued token before expiry. |
| Authenticator factor is not approved | Ask the project owner to verify the account’s Auth factors and perform the controlled bootstrap reset if appropriate. The bootstrap removes all factors for that user. |
| Receipt unavailable | Check the full B2 configuration in the running environment, bucket/key permissions, Supabase receipt migrations, and Render server logs. |
| Orders do not load | Check that required Supabase migrations exist, `SUPABASE_URL` and the service-role key match, and Render logs show no query/schema errors. |
| Secure-cookie/session issues in production | Confirm `NODE_ENV=production`, HTTPS termination, cookie behavior, and trusted proxy configuration. |

When requesting assistance, share only sanitized error messages. Remove email addresses, customer/order personal data, tokens, setup secrets, and all credential values.
