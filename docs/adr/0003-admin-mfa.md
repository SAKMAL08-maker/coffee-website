# ADR-0003: Require Supabase Auth TOTP (AAL2) with one approved factor for admins

- **Status:** Accepted
- **Recorded:** 2026-10-30 (decision made 2026-10-26; see commit "now moving closer to production, implemented authroziation checks and login flow for admin users with the use of TOTP" and migrations `20261030000000_admin_supabase_auth.sql`, `20261031000000_admin_mfa_factor_approval.sql`)

## Context

Admins can see every order (names, addresses), approve deliveries, delete orders, and access all receipts. A stolen admin password alone must not be enough. Building TOTP verification from scratch is easy to get subtly wrong (clock skew, replay, secret storage).

## Decision

- An admin is a `coffee_users` row with `role = 'admin'` **linked** to a Supabase Auth user (`supabase_auth_user_id`). Admins sign in with the Supabase Auth password, not the customer password system.
- Every admin API (`requireAdmin`) requires a Supabase session at **AAL2**, meaning password plus a verified TOTP code.
- The account must have **exactly one** verified TOTP factor, and its ID must match the factor the project approved (`admin_mfa_factor_id`). Extra or unknown factors make access **fail closed**.
- First enrollment needs a **one-time setup authorization** issued by the project owner with `scripts/admin-mfa-bootstrap.js`. It expires after 30 minutes and is consumed on success, so someone who steals the password cannot enroll their own authenticator.
- **Update (2026-10-31):** an MFA-verified admin can instead **approve** setup from the admin page (`POST /api/admin/accounts/:username/approve-setup`). That stores the same kind of authorization, flagged `admin_mfa_setup_preapproved`, for 24 hours, and the new admin enrolls by scanning a QR code with no typed key.
    - **Trade-off:** during that window, the password alone is enough to enroll. That's acceptable because a human approved it on purpose and the window is short.
    - `ADMIN_APPROVER_USERNAMES` can limit who approves. Admins can't approve themselves.

## Alternatives considered

**Owner to confirm.** Not recorded in the repository. Options that existed:

- Implementing TOTP directly in Express (e.g. with an OTP library) and storing secrets in `coffee_users`.
- Password-only admin login protected by rate limiting.

> ✍️ _Owner: note which alternatives you actually weighed and why you chose Supabase Auth MFA._

## Consequences

- ✅ Password theft alone does not grant admin access; TOTP verification logic is maintained by Supabase.
- ✅ Factor pinning blocks an attacker who briefly gets a session from silently adding their own authenticator.
- ⚠️ Two auth systems coexist: custom for customers ([ADR-0004](0004-custom-customer-auth.md)), Supabase Auth for admins.
- ⚠️ Lost authenticator = the owner must rerun the bootstrap script (it deletes existing factors). See the [runbook](../runbook.md).
- ⚠️ TOTP is not phishing-resistant; passkeys/WebAuthn would be the next step up.
