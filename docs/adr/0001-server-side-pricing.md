# ADR-0001: Calculate prices on the server in integer centavos

- **Status:** Accepted
- **Recorded:** 2026-10-30 (decision made during October 2026 development; see commits "converted usd prices to php prices< including VAT, etc." and the security review commits)

## Context

Customers build drinks in the browser, and the browser shows a live price. Anything the browser sends can be edited with developer tools, so a total computed in the browser cannot be trusted. Prices are in Philippine pesos and include 12% VAT (since 2026-10-31; earlier orders added it on top and lack `pricing.vat_inclusive`), an 8% service fee, optional tip, and a ₱49 delivery fee. Floating-point arithmetic (`0.1 + 0.2 !== 0.3`) causes off-by-a-centavo errors in money.

## Decision

- The server is the only source of truth for prices. `POST /api/orders/checkout` receives drink **configurations**, never prices; `calculateOrderPricing` in `services/pricingService.js` recomputes every line item and fee before saving.
- All server amounts are **integer centavos** (`price_cents`, `subtotal_cents`, `tax_cents`, …). Percentages are applied in basis points and rounded once per component with `Math.round`.
- Order rows store the computed breakdown, so receipts and history show what was charged even if prices change later.

## Consequences

- ✅ A tampered request cannot change what an order costs.
- ✅ No floating-point drift in stored totals.
- ✅ Since Phase 3 the rules live only in `services/pricingService.js`. The browser no longer has its own copy (it used to compute in pesos as floats, which could drift by a centavo on custom tips); it displays quotes from `POST /api/orders/quote`, which uses the same function as checkout. `test/pricingRegression.test.js` proves the refactor kept every total identical.
- ⚠️ Live price updates need a network round-trip (debounced, cached); if the quote request fails the UI shows "—" and checkout still calculates correctly.
- ⚠️ Price changes currently require a code deploy (hardcoded constants). Phase 6 (optional) moves them to database tables.
