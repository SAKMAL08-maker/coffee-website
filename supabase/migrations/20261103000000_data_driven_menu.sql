create table if not exists public.ingredients (
    ingredient_key text primary key check (ingredient_key ~ '^[a-zA-Z][a-zA-Z0-9_]*$'),
    label text not null check (char_length(label) between 1 and 80),
    category text not null check (category in ('base', 'milk', 'syrup', 'sweetener', 'topping')),
    metadata jsonb not null default '{}'::jsonb,
    is_available boolean not null default true,
    updated_at timestamptz not null default now()
);

insert into public.ingredients (ingredient_key, label, category, metadata) values
    ('espresso', 'Espresso', 'base', '{"caffeineMg":64,"calories":3,"sugar":0}'),
    ('drip', 'Filter coffee', 'base', '{"caffeineMg":80,"calories":2,"sugar":0}'),
    ('coldBrew', 'Cold brew', 'base', '{"caffeineMg":100,"calories":5,"sugar":0}'),
    ('matcha', 'Matcha', 'base', '{"caffeineMg":70,"calories":6,"sugar":0}'),
    ('whole', 'Whole milk', 'milk', '{"calories":0.62,"sugar":0.05}'),
    ('skim', 'Skim milk', 'milk', '{"calories":0.35,"sugar":0.05}'),
    ('oat', 'Oat milk', 'milk', '{"calories":0.5,"sugar":0.04}'),
    ('almond', 'Almond milk', 'milk', '{"calories":0.18,"sugar":0.01}'),
    ('vanilla', 'Vanilla syrup', 'syrup', '{"calories":20,"sugar":5,"ml":7}'),
    ('caramel', 'Caramel sauce', 'syrup', '{"calories":25,"sugar":6,"ml":7}'),
    ('chocolate', 'Dark chocolate mocha', 'syrup', '{"calories":28,"sugar":5,"ml":8}'),
    ('whiteSugar', 'White sugar', 'sweetener', '{"calories":16,"sugar":4}'),
    ('rawSugar', 'Raw sugar', 'sweetener', '{"calories":16,"sugar":4}'),
    ('honey', 'Honey', 'sweetener', '{"calories":21,"sugar":5.7}'),
    ('stevia', 'Stevia', 'sweetener', '{"calories":0,"sugar":0}'),
    ('cinnamon', 'Cinnamon', 'topping', '{}'),
    ('whippedCream', 'Whipped cream', 'topping', '{}'),
    ('cocoa', 'Cocoa', 'topping', '{}')
on conflict (ingredient_key) do nothing;

create table if not exists public.menu_prices (
    price_key text primary key check (price_key ~ '^[a-z][a-z0-9_]*$'),
    value integer not null check (value between 0 and 10000000),
    updated_at timestamptz not null default now()
);

insert into public.menu_prices (price_key, value) values
    ('base_price_cents', 25000),
    ('volume_step_cents', 2800),
    ('extra_shot_cents', 5500),
    ('oat_milk_cents', 3900),
    ('almond_milk_cents', 2800),
    ('syrup_pump_cents', 2500),
    ('delivery_fee_cents', 4900),
    ('service_fee_basis_points', 800),
    ('tax_basis_points', 1200)
on conflict (price_key) do nothing;

-- Menu data is public to read; writes stay behind the server-side service-role API.
alter table public.ingredients enable row level security;
alter table public.menu_prices enable row level security;

drop policy if exists ingredients_read_available on public.ingredients;
create policy ingredients_read_available
    on public.ingredients for select
    to anon, authenticated
    using (is_available = true);

drop policy if exists menu_prices_read on public.menu_prices;
create policy menu_prices_read
    on public.menu_prices for select
    to anon, authenticated
    using (true);
