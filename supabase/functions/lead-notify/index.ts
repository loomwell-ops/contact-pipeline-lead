// automation-run: works through the queue of automation runs (table automation_runs).
// Called by database triggers and by a 15-minute pg_cron job (pg_net) with NO input. It is safe to expose without a login:
//  - it never reads recipients, templates or text from the request, only from the database;
//  - it can only act on runs a database trigger or the scheduler queued, and each run is claimed atomically (once);
//  - every safety rule is checked again at the moment of sending (rule on, deal still in the stage, no reply yet,
//    subscribed, not suppressed, per-contact cooldown, hourly ceiling, daily cap).
// Secrets: RESEND_API_KEY, FROM_ADDRESS (same as send-email).
import { createClient } from "npm:@supabase/supabase-js@2";
import { renderMessage } from "./email_render.ts";
import { fromHeader, oneLine, resendSend, sentToday, withFooter } from "./email_core.ts";

const reply = (o: unknown) => new Response(JSON.stringify(o), { headers: { "Content-Type": "application/json" } });
const BATCH = 20;                       // runs per call
const EXPIRE_MS = 72 * 3600 * 1000;     // a run that waited this long is stale and is dropped
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const BLOCKED = ["unsubscribed", "bounced", "complained"];

type Outcome =
  | { status: "done"; reason?: string; message_id?: string }
  | { status: "skipped" | "failed"; reason: string; message_id?: string }
  | { status: "wait"; reason: string };   // limit reached: put back in the queue and stop this batch

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const URL_ = Deno.env.get("SUPABASE_URL")!, SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const db = createClient(URL_, SERVICE, { auth: { persistSession: false } });

  // 1. Claim up to BATCH queued runs. The status filter makes the claim atomic: a run is handled by one caller only.
  const { data: queued } = await db.from("automation_runs").select("id").eq("status", "queued").order("created_at").limit(BATCH);
  const ids = (queued ?? []).map((r: Row) => r.id);
  if (!ids.length) return reply({ ok: true, processed: 0 });
  const { data: claimed } = await db.from("automation_runs")
    .update({ status: "processing", claimed_at: new Date().toISOString() })
    .in("id", ids).eq("status", "queued").select("*");
  const runs: Row[] = (claimed ?? []).sort((a: Row, b: Row) => String(a.created_at).localeCompare(String(b.created_at)));

  const { data: auto } = await db.from("automation_settings").select("*").eq("id", true).maybeSingle();
  const { data: st } = await db.from("email_settings").select("*").eq("id", true).maybeSingle();

  let processed = 0, waiting = false;
  for (const run of runs) {
    if (waiting) { await release(db, run.id, "Waiting for a sending limit to clear"); continue; }
    let out: Outcome;
    try { out = await handle(db, run, auto, st); }
    catch (e) { out = { status: "failed", reason: `error: ${e instanceof Error ? e.message : "unknown"}`.slice(0, 200) }; }

    if (out.status === "wait") { waiting = true; await release(db, run.id, out.reason); continue; }
    await db.from("automation_runs").update({
      status: out.status, reason: ("reason" in out ? out.reason : null) ?? null,
      email_message_id: ("message_id" in out ? out.message_id : null) ?? null,
      processed_at: new Date().toISOString(),
    }).eq("id", run.id);
    processed++;
  }
  return reply({ ok: true, processed });
});

// deno-lint-ignore no-explicit-any
async function release(db: any, id: string, reason: string) {
  await db.from("automation_runs").update({ status: "queued", claimed_at: null, reason }).eq("id", id);
}

// deno-lint-ignore no-explicit-any
async function handle(db: any, run: Row, auto: Row | null, st: Row | null): Promise<Outcome> {
  if (!auto?.enabled) return { status: "skipped", reason: "Automations are switched off" };
  if (Date.now() - new Date(run.created_at).getTime() > EXPIRE_MS) return { status: "skipped", reason: "Expired: waited more than 72 hours" };

  const { data: rule } = run.rule_id ? await db.from("automation_rules").select("*").eq("id", run.rule_id).maybeSingle() : { data: null };
  if (!rule) return { status: "skipped", reason: "The rule was deleted" };
  if (!rule.enabled) return { status: "skipped", reason: "The rule is switched off" };

  const { data: c } = await db.from("contacts")
    .select("id,email,email_status,unsub_token,first_name,last_name,company,phone,tags").eq("id", run.contact_id).maybeSingle();
  if (!c) return { status: "skipped", reason: "Contact no longer exists" };

  // Deal-based rules: the deal must still be open and still in the stage that triggered the run
  if (rule.trigger_type === "stage_entered" || rule.trigger_type === "no_reply") {
    const { data: d } = run.deal_id ? await db.from("deals").select("id,stage_id,status").eq("id", run.deal_id).maybeSingle() : { data: null };
    if (!d) return { status: "skipped", reason: "The deal no longer exists" };
    if (d.status !== "open") return { status: "skipped", reason: `The deal is already ${d.status}` };
    if (d.stage_id !== run.stage_id) return { status: "skipped", reason: "The deal has left that stage" };
  }

  // No-reply rule: stop if the operator marked the contact as replied since the last email
  if (rule.trigger_type === "no_reply") {
    const { data: last } = await db.from("email_messages").select("sent_at,created_at")
      .eq("contact_id", c.id).in("status", ["sent", "delivered"]).neq("kind", "internal")
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    const since = last ? (last.sent_at ?? last.created_at) : null;
    if (!since) return { status: "skipped", reason: "No earlier email to follow up on" };
    const { count } = await db.from("activities").select("id", { count: "exact", head: true })
      .eq("contact_id", c.id).eq("type", "reply").gte("created_at", since);
    if ((count ?? 0) > 0) return { status: "skipped", reason: "Contact replied" };
  }

  // ---------- actions that send nothing ----------
  if (rule.action_type === "add_tag") {
    const tag = oneLine(rule.tag);
    if (!tag) return { status: "failed", reason: "The rule has no tag" };
    const have: string[] = Array.isArray(c.tags) ? c.tags : [];
    if (!have.includes(tag)) {
      const { error } = await db.from("contacts").update({ tags: [...have, tag] }).eq("id", c.id);
      if (error) return { status: "failed", reason: String(error.message).slice(0, 200) };
    }
    await db.from("activities").insert({
      contact_id: c.id, deal_id: run.deal_id, type: "automation", body: `Automation "${rule.name}": added tag ${tag}`,
      data: { rule: rule.name, action: "add_tag", tag },
    });
    return { status: "done", reason: have.includes(tag) ? "Tag was already there" : undefined };
  }
  if (rule.action_type === "add_note") {
    const note = String(rule.note_text ?? "").trim();
    if (!note) return { status: "failed", reason: "The rule has no note text" };
    await db.from("activities").insert({
      contact_id: c.id, deal_id: run.deal_id, type: "automation", body: note,
      data: { rule: rule.name, action: "add_note" },
    });
    return { status: "done" };
  }
  if (rule.action_type !== "send_template") return { status: "failed", reason: "Unknown action" };

  // ---------- send an email template ----------
  const apiKey = Deno.env.get("RESEND_API_KEY"), fromEnv = Deno.env.get("FROM_ADDRESS");
  const URL_ = Deno.env.get("SUPABASE_URL")!;
  if (!apiKey || !fromEnv) return { status: "failed", reason: "Sending is not set up (secrets missing)" };
  const postal = oneLine(st?.postal_address), site = oneLine(st?.site_url).replace(/\/+$/, "");
  if (!postal || !/^https?:\/\//i.test(site)) return { status: "failed", reason: "Postal address or site URL missing in Email settings" };

  const to = oneLine(c.email);
  if (!EMAIL.test(to)) return { status: "skipped", reason: "Contact has no valid email address" };
  if (BLOCKED.includes(c.email_status)) return { status: "skipped", reason: "Contact has opted out or cannot be reached" };
  if (c.email_status !== "subscribed") return { status: "skipped", reason: "Contact has not agreed to email" };
  const { data: sup } = await db.from("email_suppressions").select("reason").eq("email", to.toLowerCase()).maybeSingle();
  if (sup) return { status: "skipped", reason: "Address is on the suppression list" };

  // Per-contact cooldown: counts automation emails AND the Module 3 auto-reply
  if (rule.cooldown_hours > 0) {
    const like = to.replace(/[\\%_]/g, (m) => "\\" + m);
    const { count: recent } = await db.from("email_messages").select("id", { count: "exact", head: true })
      .in("source", ["automation", "auto_reply"]).ilike("to_email", like).neq("status", "failed")
      .gte("created_at", new Date(Date.now() - rule.cooldown_hours * 3600 * 1000).toISOString());
    if ((recent ?? 0) > 0) return { status: "skipped", reason: `Cooldown: already emailed automatically in the last ${rule.cooldown_hours} hours` };
  }
  // Hourly ceiling and daily cap: wait instead of dropping the run
  const { count: hour } = await db.from("email_messages").select("id", { count: "exact", head: true })
    .eq("source", "automation").neq("status", "failed").gte("created_at", new Date(Date.now() - 3600 * 1000).toISOString());
  if ((hour ?? 0) >= (auto.hourly_limit ?? 20)) return { status: "wait", reason: "Waiting: hourly automation limit reached" };
  const cap = st?.daily_cap ?? 90;
  if ((await sentToday(db)) >= cap) return { status: "wait", reason: `Waiting: daily sending limit reached (${cap})` };

  const { data: t } = await db.from("email_templates").select("id,subject,body,kind").eq("id", rule.template_id).maybeSingle();
  if (!t) return { status: "failed", reason: "The template no longer exists" };
  const r = renderMessage(t.subject, t.body, {
    first_name: oneLine(c.first_name), last_name: oneLine(c.last_name),
    full_name: [oneLine(c.first_name), oneLine(c.last_name)].filter(Boolean).join(" "),
    company: oneLine(c.company), email: to, phone: oneLine(c.phone), sender_name: oneLine(st?.sender_name),
  });
  if (!r.ok) return { status: "failed", reason: `Template problem: ${r.error}`.slice(0, 200) };

  const kind = t.kind === "marketing" ? "marketing" : "transactional";
  const full = withFooter(r.html, r.text, postal, `${site}/unsubscribe.html?t=${c.unsub_token}`);
  const { data: msg, error: me } = await db.from("email_messages").insert({
    contact_id: c.id, deal_id: run.deal_id, template_id: t.id, to_email: to, subject: r.subject, body: r.text, body_html: r.html,
    kind, status: "queued", provider: "resend", source: "automation",
  }).select("id").single();
  if (me || !msg) return { status: "failed", reason: `Not logged: ${String(me?.message ?? "").slice(0, 150)}` };

  const out = await resendSend(apiKey, msg.id, {
    from: fromHeader(fromEnv, st?.sender_name), to: [to], subject: r.subject, html: full.html, text: full.text,
    ...(oneLine(st?.reply_to) ? { reply_to: oneLine(st.reply_to) } : {}),
    headers: { "List-Unsubscribe": `<${URL_}/functions/v1/unsubscribe?t=${c.unsub_token}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
  });
  await db.from("email_messages").update({
    status: out.status, provider_message_id: out.providerId, error: out.err, sent_at: out.status === "sent" ? new Date().toISOString() : null,
  }).eq("id", msg.id);
  await db.from("activities").insert({
    contact_id: c.id, deal_id: run.deal_id, type: "email", body: r.subject,
    data: { subject: r.subject, status: out.status, message_id: msg.id, kind, template_id: t.id, automation: rule.name, ...(out.err ? { error: out.err } : {}) },
  });
  return out.status === "sent"
    ? { status: "done", message_id: msg.id }
    : { status: "failed", reason: out.err ?? "Send failed", message_id: msg.id };
}
