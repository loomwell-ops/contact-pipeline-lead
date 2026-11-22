-- MODULE 1 database: contacts, pipeline, notes. Run FIRST in a new Supabase project (SQL Editor, then Run).
-- This is the foundation; later modules (forms, and so on) build on these tables.

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  first_name text, last_name text, email text, phone text, company text, source text,
  tags text[] not null default '{}',
  custom_fields jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create table public.pipelines (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null
);
create table public.stages (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  pipeline_id uuid not null references public.pipelines(id) on delete cascade,
  name text not null,
  position int not null default 0
);
create table public.deals (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  contact_id uuid not null references public.contacts(id) on delete cascade,
  pipeline_id uuid not null references public.pipelines(id) on delete cascade,
  stage_id uuid not null references public.stages(id),  -- no cascade: a stage with deals cannot be deleted
  title text not null,
  value numeric not null default 0,
  status text not null default 'open' check (status in ('open','won','lost')),
  position int not null default 0
);
create table public.activities (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  contact_id uuid not null references public.contacts(id) on delete cascade,
  deal_id uuid references public.deals(id) on delete set null,
  type text not null default 'note',
  body text,
  data jsonb                      -- structured details for non-note entries (for example form answers)
);

create index contacts_email_idx on public.contacts (email);
create index deals_stage_id_idx on public.deals (stage_id);
create index activities_contact_id_idx on public.activities (contact_id);
create index deals_contact_id_idx on public.deals (contact_id);
create index deals_pipeline_id_idx on public.deals (pipeline_id);
create index stages_pipeline_id_idx on public.stages (pipeline_id);
create index activities_deal_id_idx on public.activities (deal_id);

create function public.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end; $$;
revoke execute on function public.set_updated_at() from public, anon, authenticated;
create trigger contacts_set_updated_at before update on public.contacts
for each row execute function public.set_updated_at();

-- Row Level Security: logged-in users only, nothing for anonymous visitors
alter table public.contacts enable row level security;
alter table public.pipelines enable row level security;
alter table public.stages enable row level security;
alter table public.deals enable row level security;
alter table public.activities enable row level security;
do $$
declare t text;
begin
  foreach t in array array['contacts','pipelines','stages','deals','activities'] loop
    execute format('create policy "authenticated select" on public.%I for select to authenticated using ((select auth.uid()) is not null)', t);
    execute format('create policy "authenticated insert" on public.%I for insert to authenticated with check ((select auth.uid()) is not null)', t);
    execute format('create policy "authenticated update" on public.%I for update to authenticated using ((select auth.uid()) is not null) with check ((select auth.uid()) is not null)', t);
    execute format('create policy "authenticated delete" on public.%I for delete to authenticated using ((select auth.uid()) is not null)', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- Weekly keep-alive ping target (used by the GitHub Actions workflow). Returns 1, reads no data.
create or replace function public.keepalive() returns integer
language sql security invoker set search_path = '' as $$ select 1 $$;
revoke execute on function public.keepalive() from public;
grant execute on function public.keepalive() to anon, authenticated;
