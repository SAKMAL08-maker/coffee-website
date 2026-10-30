# Coffee Lab: Plan

Three parts: where the product is going (roadmap), why it could work as a business (short plan), and how it got here (learning log from the git history).

## 1. Roadmap

Each phase is one branch and one pull request, reviewed and merged by the owner. Status as of 2026-10-30.

| Phase | Goal                                                                                                                                         | Status               |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| 0     | Repo hygiene: README, LICENSE, line endings, accurate docs, AI-log folder                                                                    | ✅ Merged (#9)       |
| 1     | CI (lint, format, test, audit), `/healthz` keep-alive, PR/issue templates                                                                    | ✅ Merged (#10, #11) |
| 2     | Collaboration docs: CONTRIBUTING, ADRs, runbook, this plan, AI-USAGE                                                                         | 🔄 In review (#12)   |
| 3     | Refactor: `services/pricingService.js` (integer cents), order-status state machine, rate limit on status updates, browser uses server quotes | 🔄 In review         |
| 4     | Cash handling: `payment_method`, cash-collected tracking, admin "mark cash collected"                                                        | Planned              |
| 5     | **Community recipes with royalties**: shareable recipe link/QR, "order this recipe", creator earns loyalty points                            | Planned              |
| 5b    | Then, owner's choice: caffeine guardian (daily caffeine total, cutoff time, half-caf nudge) **or** origin-traceable beans                    | Decide after 5       |
| 6     | _(Optional)_ Data-driven menu: prices in database tables with cache, admin price editing, safe fallback                                      | Only if requested    |

**Technical follow-ups** (no phase yet): shared rate-limit store before running more than one instance; replace order polling with push updates if traffic grows; B2 lifecycle rule for old receipts; passkeys for admins.

## 2. Short business plan

> ✍️ **Draft by Claude for the owner to revise.** Market figures and assumptions below are not validated; replace them with your own research before presenting.

**Problem.** Custom coffee orders are hard to communicate at the counter ("less sweet, oat milk, extra shot, half ice"), and mistakes cost the shop a remade drink and the customer their time.

**Solution.** Coffee Lab lets customers build a drink visually, see its estimated caffeine, calories, and sugar, and send an exact recipe for pickup or delivery. The shop gets an unambiguous order and a receipt; the customer gets the same drink every time.

**Customers.**

- _Primary:_ students and young professionals who order customized drinks regularly.
- _Secondary:_ small independent cafés that want online ordering without paying marketplace commissions.

**Differentiator.** Community recipes with royalties (Phase 5): customers publish their creations, others order them by link or QR, and creators earn loyalty points. This turns customers into marketers.

**Revenue model (options to evaluate).**

1. Single café: margin on drinks, plus a delivery fee (currently ₱49) and service fee (currently 8%).
2. White-label for other cafés: monthly subscription per shop.

**Costs today.** Near zero: Render, Supabase, and Backblaze free tiers, plus a domain if added. The first paid step would be Render's starter plan (no sleep) when real traffic arrives.

**Key risks.** Payments are cash-only (Phase 4 records it; no online payment yet); free-tier limits; data-privacy obligations under the Philippine Data Privacy Act (privacy notice already added).

**Success metrics.** Orders per week, repeat-order rate, share of orders from community recipes, remade-drink rate reported by staff.

## 3. Learning log

Built from the commit history. Quotes are the owner's own commit messages; nothing here is added beyond what the history shows.

| Date       | Milestone                                                                                                                                                                                                               |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-21 | First commit: "1st commit, testing the commit message".                                                                                                                                                                 |
| 2026-10-22 | HTML then JavaScript: "able to complete html, currently understanding .js".                                                                                                                                             |
| 2026-10-22 | First deployment: "was able to use onrender for allowing this to be ran on the web", then "added process.env.PORT for cloud".                                                                                           |
| 2026-10-22 | Database: "currently learning supabase" → "working localhost supabase, will try for onrender".                                                                                                                          |
| 2026-10-22 | First recorded AI correction: "made an error with copilot, it used mongo and jwt, converted to supa".                                                                                                                   |
| 2026-10-22 | Localization and security: "converted usd prices to php prices< including VAT, etc." and "used copilot to review and implement security measures".                                                                      |
| 2026-10-25 | Accounts: "implemented account creation and login, did not use betterauth, used supabase auth instead"; customer accounts later moved to username-based tables (see [ADR-0004](docs/adr/0004-custom-customer-auth.md)). |
| 2026-10-25 | Bug fix: "fixed a bug when using the addons or extra, inputs werent being taken."                                                                                                                                       |
| 2026-10-26 | Receipts: "used backblaze b2 for storage, and added a pdf generation service for receipts. Also added a receipt test file".                                                                                             |
| 2026-10-26 | Debugging: "I found the admin initialization was fragile: it depended on an authentication event listener being installed before the auth script dispatched the event."                                                 |
| 2026-10-26 | Admin security: "implemented authroziation checks and login flow for admin users with the use of TOTP".                                                                                                                 |
| 2026-10-26 | Privacy: privacy policy page and signup/checkout notices (PR #1).                                                                                                                                                       |
| 2026-10-26 | Documentation: "constructed a guide.md" for future developers.                                                                                                                                                          |
| 2026-10-30 | Switched to Claude Code; phased, PR-based workflow with CI begins (see [docs/ai-logs](docs/ai-logs/CHANGELOG-AI.md)).                                                                                                   |

> ✍️ _Owner: add a sentence per row on what you actually learned or found hardest, in your own words. That is the part reviewers can't get from the commits._
