# Coffee Lab — Security, Safety & Engineering Instructions Review

**Review date:** October 26, 2026  
**Scope:** Current repository worktree, including application source, authentication and MFA changes, SQL migrations, bootstrap tooling, tests, and repository-level deployment configuration.

## Executive summary

The focused repository security review identified **no confirmed exploitable vulnerabilities** in the reviewed worktree. The automated checks completed for this review also passed:

| Check                                                                       | Result                                      |
| --------------------------------------------------------------------------- | ------------------------------------------- |
| Focused security review                                                     | No confirmed vulnerabilities reported       |
| `npm test`                                                                  | 21 passed, 0 failed                         |
| Production dependency audit (`npm audit --omit=dev --audit-level=moderate`) | 0 vulnerabilities                           |
| JavaScript syntax checks                                                    | 34 application/test JavaScript files passed |
| `git diff --check`                                                          | Passed                                      |

This is a source-code review, not a certification of the live Render service or its Supabase and Backblaze configuration. Production configuration and provider-side state require separate verification.

## Findings

| #   | Severity | File | Lines | Vulnerability                                                             | Confidence |
| --- | -------- | ---- | ----- | ------------------------------------------------------------------------- | ---------- |
| —   | —        | —    | —     | No confirmed vulnerabilities identified in the reviewed repository state. | —          |

### Checks requiring access to production services

The following settings cannot be proven from this repository and should be checked in Render, Supabase, and Backblaze:

1. **Render production mode and HTTPS:** Confirm `NODE_ENV=production`, HTTPS is enforced, and proxy trust settings match the real Render/network topology. Cookie `Secure`, HSTS, and CSP upgrade behavior depend on production configuration.
2. **Supabase schema and policy:** Confirm all migrations are applied to the project referenced by Render’s `SUPABASE_URL`. Verify database grants/RLS, the admin-to-Auth-user mapping, and that the actual TOTP factor matches the app-approved factor.
3. **Backblaze bucket and key:** Confirm the receipt bucket is private and the application key is limited to the required bucket/operations. Signed URL code does not by itself prove bucket permissions.
4. **Secret management:** Confirm service-role and B2 secrets are configured as protected Render environment variables, not committed or exposed in build logs.
5. **Production behavior:** Exercise admin MFA enrollment and login, customer order isolation, receipt access, and order approvals against staging or production with test accounts. The local test suite does not make live provider calls.

## Security controls observed in source

- **HTTP protections:** Express disables the `X-Powered-By` header and configures Helmet, a restrictive Content Security Policy, and production HSTS in `server.js`.
- **Origin and input controls:** API requests are protected by same-origin checks. Zod schemas validate request bodies, parameters, and queries, with additional server-side checks for drink and order data.
- **Server-side pricing:** Checkout totals are recalculated by the server in integer cents; the client does not control persisted prices.
- **Customer authentication:** Passwords use scrypt hashes. Customer session tokens are random opaque values and only their hashes are stored.
- **Administrator authentication:** Admin sign-in is linked to Supabase Auth. Admin API access requires an AAL2 session and the factor ID approved for that Coffee Lab account.
- **MFA bootstrap:** First-factor setup requires a time-limited, single-use owner authorization. The bootstrap utility removes existing factors before issuing a new token; this is a destructive recovery operation and should only be run for the intended admin.
- **Session cookies:** Tokens are in `HttpOnly; SameSite=Lax` cookies, with `Secure` in production. Pending MFA cookies are short-lived.
- **Authorization:** Admin routes are protected by the admin guard; customer order and receipt queries are constrained to the authenticated account.
- **Rate limiting:** Sensitive routes have individual limits. The default limiter is in-memory, so limits are not shared between horizontally scaled Render instances.
- **Receipt privacy:** Receipt files are stored as private B2 objects and delivered using short-lived signed URLs after ownership/admin checks.
- **Error responses:** The Express error handler returns generic client-facing server errors while recording technical details server-side.
- **Credential hygiene:** `.env` is ignored by Git and the local `.env` was reported as ignored/untracked during this review. No checked-in credential exposure was identified by the focused reviewer.

## Review against `.github/copilot-instructions.md`

| Instruction area                            | Assessment                                | Evidence / notes                                                                                                                                                                     |
| ------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| CommonJS and existing stack                 | **Followed**                              | Server and backend modules use CommonJS; frontend remains plain HTML/CSS/JavaScript.                                                                                                 |
| Modular separation                          | **Mostly followed**                       | Routes, controllers, middleware, schemas, and services are separate. Some browser behavior remains in larger JavaScript files, but the app is divided into purpose-specific scripts. |
| Environment-based secrets and `.env` ignore | **Followed in source**                    | Supabase and B2 credentials are read from environment variables; `.gitignore` excludes `.env`. Live Render secret configuration still needs confirmation.                            |
| Helmet and secure headers                   | **Followed**                              | Helmet, CSP, HSTS in production, and removal of the Express fingerprint are configured. Production flags must be verified in Render.                                                 |
| Input validation                            | **Followed**                              | Zod schemas and service/controller validation are present.                                                                                                                           |
| Rate limiting                               | **Followed, with scaling caveat**         | Limiters cover authentication, MFA, checkout, receipts, and other routes; default storage is process-local.                                                                          |
| Central error handling                      | **Followed**                              | Express has a centralized handler with generic API responses and server-side diagnostic logging.                                                                                     |
| Injection defense                           | **No issue identified in focused review** | Supabase client query builders and parameterized RPC calls are used in the reviewed paths.                                                                                           |
| Dynamic interactive UI                      | **Followed**                              | Customizer state updates the drink visualization, classification, estimated nutrition, and pricing.                                                                                  |
| Explicit “level-based” workflow             | **Not fully implemented**                 | The UI groups controls and updates dynamically, but the repository does not implement a distinct sequential level/progression workflow.                                              |
| Type safety                                 | **Partially addressed**                   | The project uses JavaScript with runtime Zod validation, not TypeScript or a static type-check step.                                                                                 |
| Progressive, focused changes                | **Followed for this review**              | The audit was carried out against the existing worktree and recorded in this report; unrelated application code was not rewritten.                                                   |

### Stale repository guidance

The opening project notes in `.github/copilot-instructions.md` and `AGENTS.md` say that `index.html` and `server.js` are empty and that no dependencies or working test scripts exist. Those statements are stale: the files contain the implemented application, `package.json` declares dependencies, and `npm test` runs a real Node test suite. Updating those notes would reduce future instruction conflicts.

## Delivery and operational safety

- The repository identifies GitHub as source control and the application is deployed on Render, with Supabase and Backblaze B2 as external services.
- No CI workflow or Render deployment configuration file is checked into the repository. Auto-deploy triggers, branch selection, build/start commands, health checks, and rollback policy are controlled outside the source tree and were not verified.
- There is no frontend compilation step. The package scripts are `npm start` and `npm test`.
- Apply Supabase migrations deliberately and in timestamp order. Test changes in staging before production, especially MFA bootstrap and database schema changes.
- Consider adding a shared rate-limit store, automated CI checks, migration verification, dependency update monitoring, backup/restore drills, and an incident/recovery runbook.

## Limitations

- No live requests were made to Render, Supabase Auth/Postgres, or Backblaze B2 as part of this review.
- Passing unit/API tests does not establish that production migrations, IAM permissions, bucket privacy, HTTPS, environment variables, or service deployment settings are correct.
- `npm audit` reports advisories known to the npm audit service at audit time; it is not a guarantee that dependencies contain no unknown vulnerabilities.
- No penetration test, external network scan, or production data review was performed.
