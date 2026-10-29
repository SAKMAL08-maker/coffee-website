# ADR 0002: Backblaze B2 stores receipt artifacts

- **Status:** Accepted
- **Date:** 2026-10-30

## Context

Coffee Lab generates receipt PDFs and preview images. Storing receipt artifacts separately avoids placing binary content directly in order rows.

## Decision

Use Backblaze B2 object storage for generated receipt PDFs/images only. Keep credentials server-side, use a private bucket, and provide short-lived download access through the application’s ownership/admin checks.

## Consequences

- B2 outage or missing configuration can affect receipt access without changing order ownership.
- Do not store menu data or general application state in B2.
- Keep receipts small to respect free-tier limits and review retention/deletion behavior manually.
