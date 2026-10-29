# ADR 0001: Server-side pricing is authoritative

- **Status:** Accepted
- **Date:** 2026-10-30

## Context

The browser has pricing logic for immediate display while the server also calculates order totals. Duplicated rules can drift and must not be trusted for final order totals.

## Decision

The server is authoritative for all final prices, fees, taxes, and totals. The browser may display estimates but must use the server quote endpoint for checkout totals. Represent monetary values as integer cents internally and round at explicit boundaries.

## Consequences

- Checkout cannot trust client-supplied prices.
- Tests should cover boundary values, rounding, tips, and fulfillment fees.
- Pricing changes should be implemented once in the server pricing service and reflected in client presentation.
