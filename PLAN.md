# Coffee Lab roadmap and learning log

## Goal

Finish a clear, demoable custom-coffee ordering app for a one-week solo hackathon using the existing stack and free tiers. The judging priorities are architecture, repository quality, responsible AI use, and collaboration readiness.

## Scope boundaries

- Payment is cash on pickup or cash on delivery only.
- No staging environment, paid services, multi-instance scaling, payment gateways, or payment webhooks.
- Keep Node.js/Express 5 CommonJS and plain HTML/CSS/JS.
- Customer auth remains custom; Supabase Auth remains admin-only.
- Backblaze B2 is for receipt files only.
- Existing 15–20 second polling is acceptable for this demo.

## Roadmap

1. **Phase 0 — Repository hygiene:** README, license, line endings, current repository guidance, and removal of unused dependency/config entries.
2. **Phase 1 — CI/deploy configuration:** CI checks, health endpoint, Render blueprint, and PR/issue templates.
3. **Phase 2 — Collaboration docs:** contribution guide, ADRs, runbook, roadmap, and AI-use evidence.
4. **Phase 3 — Pricing and state:** central server-side integer-cent pricing, quote endpoint, tested status state machine, and status-route rate limit.
5. **Phase 4 — Cash handling:** additive migration, cash instructions, and admin collection record.
6. **Phase 5 — Differentiator:** select one feature and ship it end-to-end.
7. **Phase 6 — Data-driven menu (only if time remains):** additive tables, seed values, in-memory TTL cache, admin price edit, and fallback values.

## Business plan (demo scale)

- **Value proposition:** let a customer build a custom coffee and place a simple pickup/delivery order without requiring online payment.
- **Primary users:** customers configuring drinks and staff/admins processing orders.
- **Operational constraints:** a small demo catalog, cash handling, manual order fulfillment, limited receipt storage, and free-tier service availability.
- **Success indicators:** a complete demo order, accurate server quote, clear order state, accessible receipt, and a reviewer can understand setup from the README.
- **Not in scope:** production-scale operations, payment processing, paid analytics, or guaranteed uptime.

## Learning log

This repository's visible history and current implementation show ongoing work across custom authentication, admin MFA, receipt generation/storage, delivery/pickup approval, and security hardening. Add personal reflections based on your own experience; this file does not infer skills or lessons you have not confirmed.

- **[Fill in]** The most useful architectural lesson I learned:
- **[Fill in]** A bug or AI suggestion I corrected and how I verified the fix:
- **[Fill in]** What I would change if I had another week:
- **[Fill in]** Which test gave me the most confidence and why:
