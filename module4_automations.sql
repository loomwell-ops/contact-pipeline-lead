-- MODULE 4 database: automations. Run AFTER modules 1, 2 and 3 (SQL Editor, then Run).
-- Adds a master switch, a rules table, a run log (also the work queue), the database triggers that
-- queue runs, and one 15-minute pg_cron job. It sends nothing itself: the automation-run Edge Function
-- reads the queue and does the work, re-checking every safety rule at the moment of sending.
-- Everything is OFF until you switch it on in the Automations screen.

-- ============ 1. MASTER SWITCH ============
create table if not exists public.automation_settings (
  id boolean primary key default true check (id),
  enabled boolean not null default false,
  hourly_limit integer not null default 20 check (hourly_limit between 1 and 1000),
  updated_at timestamptz not null default now()
);
insert into public.automation_settings (id) values (true) on conflict (id) do nothing;

-- ============ 2. RULES ============
create table if not exists public.automation_rules (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  name text not null check (char_length(name) between 1 and 100),
  enabled boolean not null default false,
  trigger_type text not null check (trigger_type in ('stage_entered', 'lead_created', 'no_reply')),
  stage_id uuid references public.stages(id) on delete cascade,
  wait_hours integer check (wait_hours between 1 and 720),
  action_type text not null check (action_type in ('send_template', 'add_tag', 'add_note')),
  template_id uuid references public.email_templates(id),
  tag text check (tag is null or char_length(tag) between 1 and 40),
  note_text text check (note_text is null or char_length(note_text) between 1 and 500),
  cooldown_hours integer not null default 24 check (cooldown_hours between 0 and 720),
  constraint automation_rule_trigger_shape check (
    (trigger_type = 'stage_entered' and stage_id is not null)
    or (trigger_type = 'no_reply' and stage_id is not null and wait_hours is not null)
    or (trigger_type = 'lead_created')
  ),
  constraint automation_rule_action_shape check (
    (action_type = 'send_template' and template_id is not null)
    or (action_type = 'add_tag' and tag is not null)
    or (action_type = 'add_note' and note_text is not null)
  )
);
create index if not exists automation_rules_stage_id_idx on public.automation_rules (stage_id);
create index if not exists automation_rules_template_id_idx on public.automation_rules (template_id);

-- ============ 3. RUN LOG (also the queue) ============
create table if not exists public.automation_runs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  processed_at timestamptz,
  rule_id uuid references public.automation_rules(id) on delete set null,
  rule_name text not null,
  trigger_type text not null,
  action_type text not null,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  deal_id uuid references public.deals(id) on delete set null,
  stage_id uuid,
  status text not null default 'queued' check (status in ('queued', 'processing', 'done', 'skipped', 'failed')),
  reason text,
  email_message_id uuid references public.email_messages(id) on delete set null,
  -- one nudge per rule and deal, one lead_created run per rule and contact
  dedupe_key text
);
create unique index if not exists automation_runs_dedupe_key on public.automation_runs (dedupe_key) where dedupe_key is not null;
create index if not exists automation_runs_queue_idx on public.automation_runs (created_at) where status in ('queued', 'processing');
create index if not exists automation_runs_created_idx on public.automation_runs (created_at desc);
create index if not exists automation_runs_contact_id_idx on public.automation_runs (contact_id);
create index if not exists automation_runs_rule_id_idx on public.automation_runs (rule_id);
create index if not exists automation_runs_deal_id_idx on public.automation_runs (deal_id);
create index if not exists automation_runs_email_message_id_idx on public.automation_runs (email_message_id);

-- ============ 4. EMAIL LOG: allow the new source ============
alter table public.email_messages drop constraint if exists email_messages_source_check;
alter table public.email_messages add constraint email_messages_source_check
  check (source in ('manual', 'auto_reply', 'alert', 'retry', 'automation'));

-- ============ 5. ROW LEVEL SECURITY ============
alter table public.automation_settings enable row level security;
alter table public.automation_rules enable row level security;
alter table public.automation_runs enable row level security;
create policy "authenticated all" on public.automation_settings for all to authenticated
  using ((select auth.uid()) is not null) with check ((select auth.uid()) is not null);
create policy "authenticated all" on public.automation_rules for all to authenticated
  using ((select auth.uid()) is not null) with check ((select auth.uid()) is not null);
-- The log is read-only for the operator (plus delete, to prune it). Only the server writes to it.
create policy "authenticated select" on public.automation_runs for select to authenticated
  using ((select auth.uid()) is not null);
create policy "authenticated delete" on public.automation_runs for delete to authenticated
  using ((select auth.uid()) is not null);
revoke all on public.automation_settings from anon;
revoke all on public.automation_rules from anon;
revoke all on public.automation_runs from anon;
revoke insert, update on public.automation_runs from authenticated;

create trigger automation_settings_set_updated_at before update on public.automation_settings
  for each row execute function public.set_updated_at();
-- Saving a rule moves updated_at. The no-reply rule only counts emails sent after that moment,
-- so switching a rule on never blasts leads you emailed long ago.
create trigger automation_rules_set_updated_at before update on public.automation_rules
  for each row execute function public.set_updated_at();

-- ============ 6. WAKE THE WORKER ============
-- Asks the Edge Function to drain the queue. The function takes no input and can only act on queued runs.
create or replace function public.automation_kick() returns void
language plpgsql security definer set search_path = '' as $$
begin
  begin
    perform net.http_post(
      url := 'https://daxftvwilzdtkxcsbtxz.supabase.co/functions/v1/automation-run',
      body := '{}'::jsonb,
      headers := '{"Content-Type":"application/json"}'::jsonb,
      timeout_milliseconds := 5000);
  exception when others then null;
  end;
end $$;
revoke execute on function public.automation_kick() from public, anon, authenticated;

-- ============ 7. EVENT TRIGGERS ============
-- A deal enters a stage (created there, or moved there)
create or replace function public.automation_on_deal() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r public.automation_rules%rowtype; n integer := 0;
begin
  if (select enabled from public.automation_settings where id) is not true then return new; end if;
  if tg_op = 'UPDATE' and new.stage_id is not distinct from old.stage_id then return new; end if;
  for r in select * from public.automation_rules where enabled and trigger_type = 'stage_entered' and stage_id = new.stage_id loop
    insert into public.automation_runs (rule_id, rule_name, trigger_type, action_type, contact_id, deal_id, stage_id)
    values (r.id, r.name, r.trigger_type, r.action_type, new.contact_id, new.id, new.stage_id);
    n := n + 1;
  end loop;
  if n > 0 then perform public.automation_kick(); end if;
  return new;
exception when others then
  return new;   -- an automation problem must never block moving a deal
end $$;
revoke execute on function public.automation_on_deal() from public, anon, authenticated;
drop trigger if exists automation_deal_stage on public.deals;
create trigger automation_deal_stage after insert or update of stage_id on public.deals
  for each row execute function public.automation_on_deal();

-- A public form submission was accepted
create or replace function public.automation_on_submission() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r public.automation_rules%rowtype; n integer := 0;
begin
  if new.outcome <> 'accepted' or new.contact_id is null then return new; end if;
  if (select enabled from public.automation_settings where id) is not true then return new; end if;
  for r in select * from public.automation_rules where enabled and trigger_type = 'lead_created' loop
    insert into public.automation_runs (rule_id, rule_name, trigger_type, action_type, contact_id, deal_id, stage_id, dedupe_key)
    values (r.id, r.name, r.trigger_type, r.action_type, new.contact_id, new.deal_id, null, 'lead_created:' || r.id || ':' || new.contact_id)
    on conflict (dedupe_key) where dedupe_key is not null do nothing;
    n := n + 1;
  end loop;
  if n > 0 then perform public.automation_kick(); end if;
  return new;
exception when others then
  return new;
end $$;
revoke execute on function public.automation_on_submission() from public, anon, authenticated;
drop trigger if exists automation_form_submission on public.form_submissions;
create trigger automation_form_submission after insert on public.form_submissions
  for each row execute function public.automation_on_submission();

-- ============ 8. TIME-BASED RULE: NO REPLY ============
-- Finds open deals sitting in a rule's stage whose contact was last emailed at least wait_hours ago, with no
-- "reply" entry on the timeline since. One run per rule and deal, ever.
create or replace function public.automation_enqueue_no_reply() returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer := 0;
begin
  if (select enabled from public.automation_settings where id) is not true then return 0; end if;
  with last_out as (
    select contact_id, max(coalesce(sent_at, created_at)) as at
    from public.email_messages
    where status in ('sent', 'delivered') and kind <> 'internal' and contact_id is not null
    group by contact_id
  ), ins as (
    insert into public.automation_runs (rule_id, rule_name, trigger_type, action_type, contact_id, deal_id, stage_id, dedupe_key)
    select r.id, r.name, r.trigger_type, r.action_type, d.contact_id, d.id, d.stage_id, 'no_reply:' || r.id || ':' || d.id
    from public.automation_rules r
    join public.deals d on d.stage_id = r.stage_id and d.status = 'open'
    join last_out lo on lo.contact_id = d.contact_id
    where r.enabled and r.trigger_type = 'no_reply'
      and lo.at >= r.updated_at
      and lo.at <= now() - make_interval(hours => r.wait_hours)
      and not exists (select 1 from public.activities a where a.contact_id = d.contact_id and a.type = 'reply' and a.created_at >= lo.at)
    on conflict (dedupe_key) where dedupe_key is not null do nothing
    returning 1
  )
  select count(*) into n from ins;
  return n;
end $$;
revoke execute on function public.automation_enqueue_no_reply() from public, anon, authenticated;

-- Every 15 minutes: queue due nudges, give up on stuck runs (never retried, in case the email already went),
-- and wake the worker if anything is waiting.
create or replace function public.automation_tick() returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.automation_enqueue_no_reply();
  update public.automation_runs set status = 'failed', processed_at = now(), reason = 'Processing did not finish'
    where status = 'processing' and claimed_at < now() - interval '15 minutes';
  if exists (select 1 from public.automation_runs where status = 'queued') then perform public.automation_kick(); end if;
end $$;
revoke execute on function public.automation_tick() from public, anon, authenticated;

-- ============ 9. SCHEDULE ============
create extension if not exists pg_cron;
select cron.unschedule(jobid) from cron.job where jobname = 'automation-tick';
select cron.schedule('automation-tick', '*/15 * * * *', 'select public.automation_tick()');
