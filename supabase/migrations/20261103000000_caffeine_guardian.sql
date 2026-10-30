-- Caffeine guardian: a per-customer "no caffeine after" time.
--
-- Additive and backward compatible:
--   * One nullable column; null means "no cutoff set" (the default for everyone).
--   * Existing code never selects it.
--   * Safe to run twice.
--
-- The daily caffeine total needs no new storage: it is summed from
-- order_items.nutrition->caffeineMg for the customer's orders placed today.

alter table public.coffee_users
    add column if not exists caffeine_cutoff_time time;
