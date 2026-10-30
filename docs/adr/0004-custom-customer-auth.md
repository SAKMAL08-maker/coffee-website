# ADR-0004: Custom username/password auth for customers instead of Supabase Auth

- **Status:** Accepted
- **Recorded:** 2026-10-30

## Context

The git history shows customer accounts went through two designs:

1. 2026-10-25, commit "implemented account creation and login, did not use betterauth, used supabase auth instead".
2. Migration `20261025000000_username_accounts.sql` then introduced the current design: Coffee Lab's own `coffee_users`, `coffee_sessions`, and `coffee_recovery_codes` tables, keyed by **username** with no email column.

Supabase Auth identifies users by email or phone number. A username-only sign-up does not fit it directly.

## Decision

Customers use authentication implemented in this codebase:

- **Passwords:** hashed with Node's built-in `scrypt` and a random 16-byte salt per user (`services/accountSecurity.js`); minimum 12 characters (Zod).
- **Sessions:** a random 32-byte token in an `HttpOnly; SameSite=Lax` cookie (`Secure` in production). Only the token's SHA-256 hash is stored in `coffee_sessions`, so a database leak does not expose usable sessions. Sessions last 12 hours, or 30 days when "Stay signed in" is checked.
- **Recovery:** 10 one-time recovery codes are shown once at sign-up and stored hashed; they replace email-based password reset.
- **Abuse protection:** login, sign-up, and reset share a strict rate limiter (8 requests per 15 minutes).

## Why not Supabase Auth for customers

**Owner to confirm.** The repository shows the switch but not the reason. A likely driver (Claude's inference) is the username-only, no-email sign-up, which Supabase Auth does not support directly.

> ✍️ _Owner: replace this block with the actual reason you moved customers off Supabase Auth._

## Consequences

- ✅ Customers can sign up without giving an email address (less personal data to protect).
- ✅ Full control over session lifetime and cookie behavior.
- ⚠️ This project now owns password-security code that Supabase would otherwise maintain: hashing parameters, session revocation, and brute-force protection need ongoing review.
- ⚠️ Recovery codes are the only way back into a forgotten account; customers who lose them cannot recover.
- ⚠️ Two auth systems coexist (admins use Supabase Auth, [ADR-0003](0003-admin-mfa.md)), which every contributor must understand.
