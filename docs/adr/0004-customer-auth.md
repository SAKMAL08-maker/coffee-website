# ADR 0004: Customer authentication is separate from Supabase Auth

- **Status:** Accepted
- **Date:** 2026-10-30

## Context

The application uses custom customer account tables while administrators use Supabase Auth. Replacing one flow with the other would be a larger and riskier scope change.

## Decision

Keep customer authentication on the existing `coffee_users` / `coffee_sessions` implementation and use Supabase Auth for administrators only. This ADR documents the current architecture; it is not a recommendation to build a new authentication system.

## Consequences

- Do not rewrite authentication as part of unrelated features.
- Keep password hashing, session token hashing, cookie flags, rate limits, and authorization tests.
- Security changes to either flow require focused tests and a manual review of cookie/session behavior.
