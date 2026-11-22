-- MODULE 3a database: email readiness. Run AFTER module1 and module2 (SQL Editor, then Run).
-- Safe to run once. Adds consent/unsubscribe columns, a public unsubscribe function,
-- an email log table, and a database-level "never send to the wrong person" guard.
-- It does NOT send anything. Sending comes later, from a Supabase Edge Function.

-- ============ 1. CONTACT COLUMNS ============
-- email_status: none = never opted in, subscribed, unsubscribed, bounced, complained.
-- Only 'subscribed' may be emailed.
alter table public.contacts
  add column if not exists email_status text not null default 'none',
  add column if not exists consented_at timestamptz,
  add column if not exists consent_source text,          -- form, import, manual
  add column if not exists unsubscribed_at timestamptz,
  add column if not exists unsub_token uuid not null default gen_random_uuid();

alter table public.contacts drop constraint if exists contacts_email_status_check;
alter table public.contacts add constraint contacts_email_status_check
  check (email_status in ('none', 'subscribed', 'unsubscribed', 'bounced', 'complained'));
create unique index if not exists contacts_unsub_token_key on public.contacts (unsub_token);

-- Backfill: leads who ticked a consent box on a Lead Form already have consent_at in custom_fields.
update public.contacts set
  email_status = 'subscribed',
  consented_at = (custom_fields->>'consent_at')::timestamptz,
  consent_source = 'form'
where email_status = 'none'
  and email is not null and btrim(email) <> ''
  and custom_fields->>'consent_at' ~ '^\d{4}-\d{2}-\d{2}T';

-- ============ 2. submit_lead: ticking consent now sets the real columns ============
-- A visitor who ticks consent becomes 'subscribed' only if they were 'none'.
-- Someone who unsubscribed, bounced or complained is never silently re-subscribed by a form.
do $p$
declare d text; n text;
begin
  select pg_get_functiondef('public.submit_lead(text,jsonb,text,integer)'::regprocedure) into d;
  if d like '%consent_source%' then return; end if;   -- already patched
  n := replace(d, $a$custom_fields = coalesce(custom_fields, '{}'::jsonb) || v_cf,$a$,
    $b$custom_fields = coalesce(custom_fields, '{}'::jsonb) || v_cf,
        consented_at   = case when v_consent and v_email is not null and email_status = 'none' then now() else consented_at end,
        consent_source = case when v_consent and v_email is not null and email_status = 'none' then 'form' else consent_source end,
        email_status   = case when v_consent and v_email is not null and email_status = 'none' then 'subscribed' else email_status end,$b$);
  if n = d then raise exception 'patch A not applied'; end if; d := n;
  n := replace(d, $a$company, source, tags, custom_fields)$a$,
    $b$company, source, tags, custom_fields, email_status, consented_at, consent_source)$b$);
  if n = d then raise exception 'patch B not applied'; end if; d := n;
  n := replace(d, $a$v_source, v_form.tags, v_cf)$a$,
    $b$v_source, v_form.tags, v_cf,
        case when v_consent and v_email is not null then 'subscribed' else 'none' end,
        case when v_consent and v_email is not null then now() end,
        case when v_consent and v_email is not null then 'form' end)$b$);
  if n = d then raise exception 'patch C not applied'; end if;
  execute n;
end
$p$;

-- ============ 3. PUBLIC UNSUBSCRIBE (no login; the link in each email calls this) ============
-- The token is a random uuid per contact. Unknown or malformed tokens get the same reply,
-- so nobody can probe for valid ones.
create or replace function public.unsubscribe_contact(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid; v_was text;
begin
  if p_token is null or p_token !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return jsonb_build_object('ok', true);
  end if;
  select id, email_status into v_id, v_was from public.contacts where unsub_token = p_token::uuid;
  if v_id is not null and v_was <> 'unsubscribed' then
    update public.contacts set email_status = 'unsubscribed', unsubscribed_at = now() where id = v_id;
    insert into public.activities (contact_id, type, body) values (v_id, 'email_unsubscribe', 'Unsubscribed from emails via the unsubscribe link');
  end if;
  return jsonb_build_object('ok', true);
exception when others then
  return jsonb_build_object('ok', false);
end;
$$;
revoke execute on function public.unsubscribe_contact(text) from public;
grant execute on function public.unsubscribe_contact(text) to anon, authenticated;

-- ============ 4. EMAIL LOG ============
create table if not exists public.email_messages (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  contact_id uuid references public.contacts(id) on delete cascade,
  to_email text not null,
  subject text,
  status text not null default 'queued'
    check (status in ('queued', 'sent', 'delivered', 'failed', 'bounced', 'complained')),
  provider text,
  provider_message_id text,
  error text,
  sent_at timestamptz
);
create index if not exists email_messages_contact_id_idx on public.email_messages (contact_id);
create index if not exists email_messages_created_idx on public.email_messages (created_at);

alter table public.email_messages enable row level security;
create policy "authenticated all" on public.email_messages for all to authenticated
  using ((select auth.uid()) is not null) with check ((select auth.uid()) is not null);
revoke all on public.email_messages from anon;

-- ============ 5. SEND GUARD ============
-- Hard rule, enforced in the database so no code path can skip it:
-- a message cannot be queued or marked sent unless the contact is 'subscribed' and has that email.
create or replace function public.email_send_guard() returns trigger
language plpgsql set search_path = public as $$
declare c public.contacts%rowtype;
begin
  if new.status not in ('queued', 'sent') then return new; end if;
  select * into c from public.contacts where id = new.contact_id;
  if not found or c.email_status <> 'subscribed' or c.email is null or lower(c.email) <> lower(new.to_email) then
    raise exception 'Blocked: contact is not subscribed to email';
  end if;
  return new;
end;
$$;
revoke execute on function public.email_send_guard() from public, anon, authenticated;
drop trigger if exists email_messages_send_guard on public.email_messages;
create trigger email_messages_send_guard before insert or update of status on public.email_messages
for each row execute function public.email_send_guard();

-- ============ 6. ONE CONTACT PER EMAIL ============
-- Only created if there are no duplicates yet. If there are, run Merge duplicates in the app, then run this block again.
do $u$
begin
  if exists (select 1 from public.contacts where email is not null and btrim(email) <> ''
             group by lower(email) having count(*) > 1) then
    raise notice 'Duplicate emails exist. Merge them in the app (Contacts, Duplicates), then re-run section 6.';
  else
    create unique index if not exists contacts_lower_email_uniq on public.contacts (lower(email))
      where email is not null and btrim(email) <> '';
    drop index if exists public.contacts_lower_email_idx;
  end if;
end
$u$;
