-- Short share links: stores a plan payload keyed by a short random id.
-- Anonymous users may create and read shared plans; row-level security
-- plus a size cap keep this safe to expose via the publishable key.

create table public.shared_plans (
  id text primary key default substr(md5(gen_random_uuid()::text), 1, 10),
  plan jsonb not null check (pg_column_size(plan) <= 100000),
  created_at timestamptz not null default now()
);

alter table public.shared_plans enable row level security;

create policy "anyone can read shared plans"
  on public.shared_plans for select
  to anon
  using (true);

create policy "anyone can create shared plans"
  on public.shared_plans for insert
  to anon
  with check (true);
