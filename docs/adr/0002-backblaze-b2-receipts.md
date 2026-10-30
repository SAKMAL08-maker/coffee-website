# ADR-0002: Store receipts in a private Backblaze B2 bucket

- **Status:** Accepted
- **Recorded:** 2026-10-30 (decision made 2026-10-26; see commit "reintegrated the recipe feature, but this time repurposed for receipts, used backblaze b2 for storage, and added a pdf generation service for receipts")

## Context

Every order produces a PDF receipt and an SVG preview image. These are files, not rows: they don't belong in Postgres, and they must be private because they contain names and addresses. The app runs on free tiers (Render, Supabase).

## Decision

- Receipts are generated on the server (`services/receiptPdf.js` with PDFKit, `services/receiptImage.js`) and uploaded to a **private** Backblaze B2 bucket through its **S3-compatible API** (`@aws-sdk/client-s3`, `services/b2ReceiptStorage.js`).
- The database stores only the object key and a `receipt_status` (`pending` / `available` / `failed` / `unavailable`).
- Downloads use **pre-signed URLs that expire after 60 seconds**, issued only after the server checks the caller owns the order or is an admin.
- B2 configuration is all-or-nothing: with no `B2_*` variables the app still takes orders and marks receipts `unavailable`; a partial configuration fails fast.

## Why B2 rather than Supabase Storage

**Owner to confirm.** The repository does not record why B2 was chosen over Supabase Storage. Factors that apply to this project (Claude's notes, not the owner's stated reasons):

- B2's free allowance (first 10 GB) is larger than Supabase Storage's free-plan quota, and keeps file storage off the Supabase project's limits.
- The S3-compatible API means the code could move to AWS S3, Cloudflare R2, or another S3 provider by changing environment variables.

> ✍️ _Owner: replace this block with the actual reasons you chose B2._

## Consequences

- ✅ Receipts are never public; leaked URLs stop working within a minute.
- ✅ Order placement does not depend on B2 being up; receipts can be retried (`/receipt/retry`).
- ⚠️ A second provider to manage: another set of keys to rotate (see the [runbook](../runbook.md)) and another dashboard to monitor.
- ⚠️ No lifecycle/retention rule yet; storage grows with every order.
