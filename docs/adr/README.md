# Architecture Decision Records

An ADR captures one significant decision: the context, what was decided, and the consequences, so future contributors understand _why_ the code looks the way it does before changing it.

| #                                     | Decision                                                              | Status   |
| ------------------------------------- | --------------------------------------------------------------------- | -------- |
| [0001](0001-server-side-pricing.md)   | Calculate prices on the server in integer centavos                    | Accepted |
| [0002](0002-backblaze-b2-receipts.md) | Store receipts in a private Backblaze B2 bucket                       | Accepted |
| [0003](0003-admin-mfa.md)             | Require Supabase Auth TOTP (AAL2) with one approved factor for admins | Accepted |
| [0004](0004-custom-customer-auth.md)  | Custom username/password auth for customers instead of Supabase Auth  | Accepted |

## Writing a new ADR

1. Copy the structure of an existing ADR into `NNNN-short-title.md` (next number).
2. Status starts as **Proposed**; it becomes **Accepted** when the PR merges.
3. Never rewrite an accepted ADR's decision. If it changes, write a new ADR and mark the old one **Superseded by NNNN**.

Sections marked **"Owner to confirm"** hold reasoning that isn't recorded anywhere in the repository. They were left for the project owner to fill in rather than guessed.
