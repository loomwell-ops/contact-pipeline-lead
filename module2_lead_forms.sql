-- MODULE 2 database: lead forms. REQUIRES module1_contacts_pipeline.sql to be run first.
-- Final SQL as applied to loomwell-contract-pipeline (initial migration, then patches folded in below).
-- (Applied as migration "module2_lead_forms" plus a one-line in-place patch, folded in below.)

-- ============ TABLES ============
create table public.forms (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null,
  title text,
  description text,
  fields jsonb not null default '[]'::jsonb,
  submit_label text default 'Send',
  success_message text default 'Thanks, we will be in touch soon.',
  redirect_url text,
  pipeline_id uuid references public.pipelines(id) on delete set null,
  stage_id uuid references public.stages(id) on delete set null,
  source text,
  tags text[] not null default '{}',
  consent_text text,
  active boolean not null default true
);

create table public.form_submissions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  form_id uuid references public.forms(id) on delete set null,
  contact_id uuid references public.contacts(id) on delete set null,
  deal_id uuid references public.deals(id) on delete set null,
  outcome text not null check (outcome in ('accepted','spam','rate_limited','invalid')),
  payload jsonb
);

-- ============ INDEXES ============
-- forms(slug) is already indexed by its UNIQUE constraint, so no second index is created.
create index form_submissions_form_created_idx on public.form_submissions (form_id, created_at);
create index contacts_lower_email_idx on public.contacts (lower(email));   -- non-unique on purpose
create index forms_pipeline_id_idx on public.forms (pipeline_id);
create index forms_stage_id_idx on public.forms (stage_id);
create index form_submissions_contact_id_idx on public.form_submissions (contact_id);
create index form_submissions_deal_id_idx on public.form_submissions (deal_id);

create trigger forms_set_updated_at before update on public.forms
for each row execute function public.set_updated_at();

-- ============ RLS: logged-in users only, nothing for anon ============
alter table public.forms enable row level security;
alter table public.form_submissions enable row level security;

create policy "authenticated all" on public.forms for all to authenticated
  using ((select auth.uid()) is not null) with check ((select auth.uid()) is not null);
create policy "authenticated select" on public.form_submissions for select to authenticated
  using ((select auth.uid()) is not null);
create policy "authenticated delete" on public.form_submissions for delete to authenticated
  using ((select auth.uid()) is not null);

revoke all on public.forms from anon;
revoke all on public.form_submissions from anon;

-- ============ INTERNAL LOG HELPER (owner only; never callable from the API) ============
create or replace function public.log_form_submission(p_form uuid, p_outcome text, p_contact uuid, p_deal uuid, p_payload jsonb)
returns void
language plpgsql
set search_path = public
as $$
begin
  -- Flood guard: after 200 log rows per form per 10 minutes, stop logging non-accepted
  -- outcomes so an attacker cannot fill the free-tier database with junk rows.
  if p_outcome <> 'accepted' and (
       select count(*) from public.form_submissions
       where form_id = p_form and created_at > now() - interval '10 minutes') >= 200 then
    return;
  end if;
  insert into public.form_submissions (form_id, outcome, contact_id, deal_id, payload)
  values (p_form, p_outcome, p_contact, p_deal, p_payload);
end;
$$;
revoke execute on function public.log_form_submission(uuid, text, uuid, uuid, jsonb) from public, anon, authenticated;

-- ============ PUBLIC FUNCTION 1: get_public_form ============
create or replace function public.get_public_form(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'slug', slug, 'name', name, 'title', title, 'description', description, 'fields', fields,
    'submit_label', submit_label, 'success_message', success_message,
    'redirect_url', redirect_url, 'consent_text', consent_text)
  from public.forms
  where slug = p_slug and active
  limit 1;
$$;

-- ============ PUBLIC FUNCTION 2: submit_lead ============
create or replace function public.submit_lead(
  p_slug text, p_payload jsonb, p_hp text default '', p_elapsed_ms int default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_form public.forms%rowtype;
  v_contact public.contacts%rowtype;
  v_fld jsonb; raw jsonb;
  k text; t text; lbl text; val text;
  req boolean; ticked boolean; v_exists boolean;
  v_bad text[] := '{}';
  v_clean jsonb := '{}'::jsonb; v_cf jsonb := '{}'::jsonb; v_attr jsonb := '{}'::jsonb; v_small jsonb;
  v_first text; v_last text; v_email text; v_phone text; v_company text;
  v_consent boolean := false;
  v_body text := '';
  v_key text; v_n int; v_max int;
  v_contact_id uuid; v_deal_id uuid; v_stage uuid; v_pipe uuid;
  v_source text; v_name text;
begin
  begin  -- inner block: any unexpected error rolls back this submission and returns a generic reply
    -- a. find the active form
    select * into v_form from public.forms where slug = p_slug and active;
    if not found then return jsonb_build_object('ok', false, 'error', 'form_not_found'); end if;

    p_payload := coalesce(p_payload, '{}'::jsonb);
    v_small := case when octet_length(p_payload::text) <= 2000 then p_payload
                    else jsonb_build_object('truncated', true, 'email', left(coalesce(p_payload->>'email', ''), 200)) end;

    -- b. size / shape
    if octet_length(p_payload::text) > 20480 or jsonb_typeof(p_payload) <> 'object' then
      perform public.log_form_submission(v_form.id, 'invalid', null, null, v_small);
      return jsonb_build_object('ok', false, 'error', 'invalid', 'fields', '[]'::jsonb);
    end if;

    -- c. spam: honeypot filled or submitted too fast. Bots get a success-looking reply.
    if coalesce(p_hp, '') <> '' or (p_elapsed_ms is not null and p_elapsed_ms < 2000) then
      perform public.log_form_submission(v_form.id, 'spam', null, null, v_small);
      return jsonb_build_object('ok', true);
    end if;

    -- d. rate limit (spam and already-limited rows are not counted, so bots cannot lock out real visitors)
    v_key := lower(btrim(left(coalesce(p_payload->>'email', ''), 320)));
    select count(*) into v_n from public.form_submissions
      where form_id = v_form.id and created_at > now() - interval '10 minutes' and outcome in ('accepted', 'invalid');
    if v_n >= 60 or (v_key <> '' and (
         select count(*) from public.form_submissions
         where form_id = v_form.id and created_at > now() - interval '10 minutes'
           and outcome in ('accepted', 'invalid') and lower(payload->>'email') = v_key) >= 5) then
      perform public.log_form_submission(v_form.id, 'rate_limited', null, null, v_small);
      return jsonb_build_object('ok', false, 'error', 'rate_limited');
    end if;

    -- e. validate against the form definition (keys the form does not define are ignored)
    for v_fld in select value from jsonb_array_elements(v_form.fields) loop
      k := v_fld->>'key';
      continue when k is null or k = '';
      t := coalesce(v_fld->>'type', 'text');
      req := (v_fld->'required') = 'true'::jsonb;
      lbl := coalesce(nullif(v_fld->>'label', ''), k);
      raw := p_payload->k;

      if raw is not null and jsonb_typeof(raw) not in ('string', 'number', 'boolean', 'null') then
        v_bad := v_bad || k; continue;
      end if;

      if t in ('checkbox', 'consent') then
        ticked := raw is not null and (raw = 'true'::jsonb or lower(coalesce(raw #>> '{}', '')) in ('true', 'on', 'yes', '1'));
        if req and not ticked then v_bad := v_bad || k; continue; end if;
        v_clean := v_clean || jsonb_build_object(k, ticked);
        if t = 'consent' then
          if ticked then v_consent := true; v_body := v_body || lbl || E': Yes\n'; end if;
        else
          v_cf := v_cf || jsonb_build_object(k, ticked);
          if ticked then v_body := v_body || lbl || E': Yes\n'; end if;
        end if;
        continue;
      end if;

      val := nullif(btrim(coalesce(raw #>> '{}', '')), '');
      if val is null then
        if req then v_bad := v_bad || k; end if;
        continue;
      end if;
      v_max := case when t = 'textarea' then 5000 else 500 end;
      if length(val) > v_max then v_bad := v_bad || k; continue; end if;
      if t = 'email' and val !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then v_bad := v_bad || k; continue; end if;
      if t = 'select' and not exists (
           select 1 from jsonb_array_elements(coalesce(v_fld->'options', '[]'::jsonb)) o
           where (case when jsonb_typeof(o) = 'string' then o #>> '{}' else o->>'value' end) = val) then
        v_bad := v_bad || k; continue;
      end if;

      -- f. map to contact columns, everything else to custom_fields
      v_clean := v_clean || jsonb_build_object(k, val);
      v_body := v_body || lbl || ': ' || val || E'\n';
      case k
        when 'first_name' then v_first := val;
        when 'last_name'  then v_last := val;
        when 'email'      then v_email := val;
        when 'phone'      then v_phone := val;
        when 'company'    then v_company := val;
        else v_cf := v_cf || jsonb_build_object(k, val);
      end case;
    end loop;

    -- whitelisted attribution keys (only these extra keys are ever stored)
    foreach k in array array['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'referrer'] loop
      if jsonb_typeof(p_payload->k) = 'string' and nullif(btrim(p_payload->>k), '') is not null then
        v_attr := v_attr || jsonb_build_object(k, left(btrim(p_payload->>k), 500));
      end if;
    end loop;
    v_cf := v_cf || v_attr;

    -- at least an email or a phone overall (PATCHED: not added when email/phone is already flagged)
    if v_email is null and v_phone is null and not (v_bad && array['email', 'phone']) then
      v_bad := array(select distinct x from unnest(v_bad || array['email', 'phone']) x);
    end if;

    if coalesce(array_length(v_bad, 1), 0) > 0 then
      perform public.log_form_submission(v_form.id, 'invalid', null, null, v_small);
      return jsonb_build_object('ok', false, 'error', 'invalid', 'fields', to_jsonb(v_bad));
    end if;

    if v_consent then
      v_cf := v_cf || jsonb_build_object('consent_text', v_form.consent_text, 'consent_at', to_jsonb(now()));
      v_body := v_body || E'\nConsent: ' || coalesce(v_form.consent_text, '')
                || ' (' || to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI') || ' UTC)';
    end if;

    -- g. find or create the contact. The lock stops two simultaneous submissions creating duplicates.
    perform pg_advisory_xact_lock(hashtextextended(lower(coalesce(v_email, v_phone)), 0));
    if v_email is not null then
      select * into v_contact from public.contacts where lower(email) = lower(v_email) order by created_at limit 1;
    else
      select * into v_contact from public.contacts where phone = v_phone order by created_at limit 1;
    end if;
    v_exists := found;
    v_source := coalesce(nullif(v_form.source, ''), nullif(v_cf->>'utm_source', ''), v_form.name);

    if v_exists then
      v_contact_id := v_contact.id;
      update public.contacts set
        first_name = coalesce(nullif(first_name, ''), v_first),
        last_name  = coalesce(nullif(last_name, ''), v_last),
        email      = coalesce(nullif(email, ''), v_email),
        phone      = coalesce(nullif(phone, ''), v_phone),
        company    = coalesce(nullif(company, ''), v_company),
        source     = coalesce(nullif(source, ''), v_source),
        custom_fields = coalesce(custom_fields, '{}'::jsonb) || v_cf,
        tags = (select coalesce(array_agg(distinct x), '{}') from unnest(coalesce(tags, '{}') || v_form.tags) x)
      where id = v_contact_id;
    else
      insert into public.contacts (first_name, last_name, email, phone, company, source, tags, custom_fields)
      values (v_first, v_last, v_email, v_phone, v_company, v_source, v_form.tags, v_cf)
      returning id into v_contact_id;
    end if;

    select * into v_contact from public.contacts where id = v_contact_id;
    v_name := coalesce(nullif(btrim(concat_ws(' ', v_contact.first_name, v_contact.last_name)), ''),
                       nullif(v_contact.email, ''), v_contact.phone);

    -- i. open deal: form stage, else first stage of form pipeline, else first stage of first pipeline
    v_stage := v_form.stage_id; v_pipe := v_form.pipeline_id;
    if v_stage is not null then
      select pipeline_id into v_pipe from public.stages where id = v_stage;
    elsif v_pipe is not null then
      select id into v_stage from public.stages where pipeline_id = v_pipe order by position, created_at limit 1;
    else
      select s.id, s.pipeline_id into v_stage, v_pipe from public.stages s
        where s.pipeline_id = (select id from public.pipelines order by created_at limit 1)
        order by s.position, s.created_at limit 1;
    end if;

    if v_pipe is not null then
      select id into v_deal_id from public.deals
        where contact_id = v_contact_id and pipeline_id = v_pipe and status = 'open' order by created_at limit 1;
    end if;
    if v_deal_id is null and v_stage is not null and v_pipe is not null then
      insert into public.deals (contact_id, pipeline_id, stage_id, title, value, status, position)
      values (v_contact_id, v_pipe, v_stage, v_form.name || ': ' || v_name, 0, 'open',
              (select count(*) from public.deals where stage_id = v_stage))
      returning id into v_deal_id;
    end if;

    -- h. timeline entry
    insert into public.activities (contact_id, deal_id, type, body)
    values (v_contact_id, v_deal_id, 'form_submission', btrim(v_body, E'\n'));

    -- j. audit log
    perform public.log_form_submission(v_form.id, 'accepted', v_contact_id, v_deal_id, v_clean || v_attr);

    -- k. reply (never any internal error text)
    return jsonb_build_object('ok', true, 'message', v_form.success_message, 'redirect_url', v_form.redirect_url);
  exception when others then
    return jsonb_build_object('ok', false, 'error', 'server_error');
  end;
end;
$$;

-- ============ GRANTS: anon may run exactly these two functions (plus keepalive from Module 1) ============
revoke execute on function public.get_public_form(text) from public;
revoke execute on function public.submit_lead(text, jsonb, text, int) from public;
grant execute on function public.get_public_form(text) to anon, authenticated;
grant execute on function public.submit_lead(text, jsonb, text, int) to anon, authenticated;

-- ============ SEED FORM ============
insert into public.forms (slug, name, title, fields, consent_text, pipeline_id, stage_id, active)
values (
  'contact', 'Contact form', 'Get in touch',
  '[{"key":"first_name","label":"First name","type":"text","required":true},
    {"key":"last_name","label":"Last name","type":"text","required":false},
    {"key":"email","label":"Email","type":"email","required":true},
    {"key":"phone","label":"Phone","type":"tel","required":false},
    {"key":"message","label":"Message","type":"textarea","required":false},
    {"key":"consent","label":"Contact consent","type":"consent","required":false}]'::jsonb,
  'I agree to be contacted about my enquiry.',
  (select id from public.pipelines order by created_at limit 1),
  (select s.id from public.stages s
     where s.pipeline_id = (select id from public.pipelines order by created_at limit 1)
     order by s.position, s.created_at limit 1),
  true);

-- ============ PATCH 2: structured answers for timeline cards (applied after the above) ============
alter table public.activities add column if not exists data jsonb;

do $p$
declare d text; n text;
begin
  select pg_get_functiondef('public.submit_lead(text,jsonb,text,integer)'::regprocedure) into d;
  n := replace(d, $a$v_consent boolean := false;$a$, $b$v_consent boolean := false; v_answers jsonb := '[]'::jsonb;$b$);
  if n = d then raise exception 'patch 1 not applied'; end if; d := n;
  n := replace(d, $a$v_body := v_body || lbl || ': ' || val || E'\n';$a$,
    $b$v_body := v_body || lbl || ': ' || val || E'\n';
      v_answers := v_answers || jsonb_build_array(jsonb_build_object('label', lbl, 'value', val));$b$);
  if n = d then raise exception 'patch 2 not applied'; end if; d := n;
  n := replace(d, $a$insert into public.activities (contact_id, deal_id, type, body)$a$,
                  $b$insert into public.activities (contact_id, deal_id, type, body, data)$b$);
  if n = d then raise exception 'patch 3a not applied'; end if; d := n;
  n := replace(d, $a$'form_submission', btrim(v_body, E'\n'));$a$,
    $b$'form_submission', btrim(v_body, E'\n'),
      jsonb_build_object('form_name', v_form.name, 'answers', v_answers,
        'consent_text', case when v_consent then v_form.consent_text end,
        'consent_at', case when v_consent then to_jsonb(now()) end,
        'utm', v_attr));$b$);
  if n = d then raise exception 'patch 3b not applied'; end if;
  execute n;
end
$p$;
