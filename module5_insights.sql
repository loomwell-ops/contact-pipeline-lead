-- MODULE 5 database: reporting. Run AFTER modules 1 to 4 (SQL Editor, then Run).
-- Adds ONE read-only function, insights_summary(days), that the Insights screen calls.
-- It changes no table and sends nothing. It runs as the logged-in user (SECURITY INVOKER),
-- so Row Level Security still applies, and anonymous visitors cannot call it.
-- Counting happens in the database, so the 1000-row limit of the API never cuts the numbers short.

create or replace function public.insights_summary(p_days integer default 30)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
with p as (
  select greatest(1, least(coalesce(p_days, 30), 365)) as d,
         now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 365))) as since
)
select jsonb_build_object(
  'days', (select d from p),

  -- who can be emailed right now
  'audience', coalesce((select jsonb_object_agg(email_status, n)
    from (select email_status, count(*) as n from public.contacts group by 1) q), '{}'::jsonb),

  'new_contacts', (select count(*) from public.contacts c, p where c.created_at >= p.since),
  'leads_by_source', coalesce((select jsonb_agg(jsonb_build_object('source', s, 'n', n) order by n desc)
    from (select coalesce(nullif(btrim(c.source), ''), 'Unknown') as s, count(*) as n
          from public.contacts c, p where c.created_at >= p.since group by 1 order by 2 desc limit 8) q), '[]'::jsonb),

  -- emails to customers (internal alerts to you are left out)
  'email_by_status', coalesce((select jsonb_object_agg(status, n)
    from (select m.status, count(*) as n from public.email_messages m, p
          where m.created_at >= p.since and m.kind <> 'internal' group by 1) q), '{}'::jsonb),
  'email_by_source', coalesce((select jsonb_object_agg(source, n)
    from (select m.source, count(*) as n from public.email_messages m, p
          where m.created_at >= p.since and m.kind <> 'internal' and m.status <> 'failed' group by 1) q), '{}'::jsonb),
  'email_daily', coalesce((select jsonb_agg(jsonb_build_object('day', g.day, 'n', coalesce(c.n, 0)) order by g.day)
    from (select generate_series(((select (now() at time zone 'utc')::date - (d - 1) from p))::timestamp,
                                 (now() at time zone 'utc')::date::timestamp, interval '1 day')::date as day) g
    left join (select (m.created_at at time zone 'utc')::date as day, count(*) as n
               from public.email_messages m, p
               where m.created_at >= p.since and m.kind <> 'internal' and m.status <> 'failed' group by 1) c
      on c.day = g.day), '[]'::jsonb),
  'unsubscribed', (select count(*) from public.activities a, p where a.type = 'email_unsubscribe' and a.created_at >= p.since),
  -- same rule the sender uses: UTC day, failed messages not counted
  'sent_today', (select count(*) from public.email_messages m
                 where m.status <> 'failed'
                   and m.created_at >= (((now() at time zone 'utc')::date)::timestamp at time zone 'utc')),
  'daily_cap', (select daily_cap from public.email_settings where id),

  -- lead forms
  'forms', coalesce((select jsonb_agg(row_to_json(q)::jsonb order by q.total desc, q.name)
    from (select f.name,
                 count(s.id) as total,
                 count(s.id) filter (where s.outcome = 'accepted') as accepted,
                 count(s.id) filter (where s.outcome = 'spam') as spam,
                 count(s.id) filter (where s.outcome = 'invalid') as invalid,
                 count(s.id) filter (where s.outcome = 'rate_limited') as rate_limited
          from public.forms f
          left join public.form_submissions s on s.form_id = f.id and s.created_at >= (select since from p)
          group by f.id, f.name) q), '[]'::jsonb),

  -- automations
  'automation_rules', coalesce((select jsonb_agg(row_to_json(q)::jsonb order by q.total desc, q.rule_name)
    from (select r.rule_name,
                 count(*) as total,
                 count(*) filter (where r.status = 'done') as done,
                 count(*) filter (where r.status = 'skipped') as skipped,
                 count(*) filter (where r.status = 'failed') as failed,
                 count(*) filter (where r.status in ('queued', 'processing')) as waiting
          from public.automation_runs r, p where r.created_at >= p.since group by r.rule_name) q), '[]'::jsonb),
  'automation_skip_reasons', coalesce((select jsonb_agg(jsonb_build_object('reason', reason, 'n', n) order by n desc)
    from (select r.reason, count(*) as n from public.automation_runs r, p
          where r.created_at >= p.since and r.status = 'skipped' and r.reason is not null
          group by 1 order by 2 desc limit 5) q), '[]'::jsonb)
);
$$;

revoke execute on function public.insights_summary(integer) from public, anon;
grant execute on function public.insights_summary(integer) to authenticated;
