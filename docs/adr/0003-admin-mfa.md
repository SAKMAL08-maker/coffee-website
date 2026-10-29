# ADR 0003: Administrator access requires MFA

- **Status:** Accepted
- **Date:** 2026-10-30

## Context

Administrative order-management actions have a higher impact than customer actions.

## Decision

Administrators use Supabase Auth and an authenticator-based MFA flow. Admin-only operations must pass the server's authentication and role checks; UI visibility is not an authorization boundary.

## Consequences

- Keep bootstrap and MFA secrets out of source control and logs.
- Test enrollment, verification, invalid codes, and protected route behavior.
- Any MFA recovery process must be documented and verified by the project owner.
