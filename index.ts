// send-email: sends ONE email to ONE existing contact, on behalf of the logged-in operator.
// Recipients are read from the database by contact id, never from the request (no open relay).
// Secrets (set in Supabase > Edge Functions > Secrets): RESEND_API_KEY, FROM_ADDRESS.
// Phase B: merge fields, simple HTML, template_id, preview.  Phase E: retry_message_id re-sends a failed message.
import { createClient } from "npm:@supabase/supabase-js@2";
import { escHtml, renderMessage } from "./email_render.ts";
import { UUID, fromHeader, oneLine, resendSend, sentToday, withFooter } from "./email_core.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const refuse = (error: string, status = 200) => json({ ok: false, error }, status);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return refuse("Use POST.", 405);

  const URL_ = Deno.env.get("SUPABASE_URL")!;
  const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // 1. Must be a real logged-in user (the public anon key is also a valid JWT, so check the user)
  const userClient = createClient(URL_, ANON, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
  const { data: u, error: ue } = await userClient.auth.getUser();
  if (ue || !u?.user) return refuse("Please log in again.", 401);

  let input: Record<string, unknown>;
  try { input = await req.json(); } catch { return refuse("Bad request."); }
  const retryId = input.retry_message_id ? String(input.retry_message_id) : null;
  const preview = !retryId && input.preview === true;
  let contactId = String(input.contact_id ?? "");
  const dealIn = input.deal_id ? String(input.deal_id) : null;
  const templateIn = input.template_id ? String(input.template_id) : null;
  let kind: string = input.kind === "marketing" ? "marketing" : "transactional";
  let subjectSrc = String(input.subject ?? "").replace(/\r\n/g, "\n").trim();
  let bodySrc = String(input.body ?? "").replace(/\r\n/g, "\n").trim();
  if ((retryId && !UUID.test(retryId)) || (!retryId && !UUID.test(contactId)) || (dealIn && !UUID.test(dealIn)) || (templateIn && !UUID.test(templateIn)))
    return refuse("Bad request.");
  if (!retryId) {
    if (preview) { subjectSrc ||= "(no subject yet)"; bodySrc ||= "(no message yet)"; }
    if (!oneLine(subjectSrc)) return refuse("Write a subject first.");
    if (!bodySrc) return refuse("Write a message first.");
    if (subjectSrc.length > 400) return refuse("That subject is too long.");
    if (bodySrc.length > 20000) return refuse("That message is too long.");
  }

  const db = createClient(URL_, SERVICE, { auth: { persistSession: false } });

  // 2. Settings and secrets must be in place
  const { data: st } = await db.from("email_settings").select("*").eq("id", true).maybeSingle();
  const apiKey = Deno.env.get("RESEND_API_KEY"), fromEnv = Deno.env.get("FROM_ADDRESS");
  if (!preview && (!apiKey || !fromEnv)) return refuse("Sending is not set up: add RESEND_API_KEY and FROM_ADDRESS in Supabase secrets.");
  const postal = oneLine(st?.postal_address);
  const site = oneLine(st?.site_url).replace(/\/+$/, "");
  if (!postal) return refuse("Add your postal address in Email settings first. It is printed in every email footer.");
  if (!/^https?:\/\//i.test(site)) return refuse("Add your CRM site address in Email settings first. The unsubscribe link needs it.");

  // Retry: load the failed message it re-sends
  // deno-lint-ignore no-explicit-any
  let orig: any = null;
  if (retryId) {
    const { data: m } = await db.from("email_messages").select("*").eq("id", retryId).maybeSingle();
    if (!m) return refuse("Message not found.");
    if (m.status !== "failed") return refuse("Only failed messages can be retried.");
    if (m.kind === "internal") return refuse("Internal alerts are not retried.");
    if (!m.contact_id) return refuse("This message is no longer linked to a contact.");
    const { count: live } = await db.from("email_messages").select("id", { count: "exact", head: true }).eq("retry_of", m.id).neq("status", "failed");
    if ((live ?? 0) > 0) return refuse("This message was already retried.");
    orig = m; contactId = m.contact_id; kind = m.kind === "marketing" ? "marketing" : "transactional";
  }

  // 3. Load the contact, then merge (or reuse the stored message for a retry)
  const { data: c } = await db.from("contacts")
    .select("id,email,email_status,unsub_token,first_name,last_name,company,phone").eq("id", contactId).maybeSingle();
  if (!c) return refuse("Contact not found.");
  const to = oneLine(c.email);
  let r: { ok: true; subject: string; html: string; text: string } | { ok: false; error: string };
  if (orig) {
    if (to.toLowerCase() !== oneLine(orig.to_email).toLowerCase())
      return refuse("This contact's email address has changed since that message. Send a new email instead.");
    r = { ok: true, subject: oneLine(orig.subject), html: orig.body_html ?? escHtml(String(orig.body ?? "")).replace(/\n/g, "<br>"), text: String(orig.body ?? "") };
  } else {
    const vars = {
      first_name: oneLine(c.first_name), last_name: oneLine(c.last_name),
      full_name: [oneLine(c.first_name), oneLine(c.last_name)].filter(Boolean).join(" "),
      company: oneLine(c.company), email: to, phone: oneLine(c.phone), sender_name: oneLine(st?.sender_name),
    };
    r = renderMessage(subjectSrc, bodySrc, vars);
  }
  if (!r.ok) return refuse(r.error);

  const page = `${site}/unsubscribe.html?t=${c.unsub_token}`;
  const oneClick = `${URL_}/functions/v1/unsubscribe?t=${c.unsub_token}`;
  const full = withFooter(r.html, r.text, postal, page);

  if (preview) return json({ ok: true, preview: true, subject: r.subject, html: full.html, text: full.text });

  // 4. Recipient safeguards (a retry is checked again from scratch: the contact may have opted out since)
  if (!to) return refuse("This contact has no email address.");
  const { data: sup } = await db.from("email_suppressions").select("reason").eq("email", to.toLowerCase()).maybeSingle();
  if (sup || ["unsubscribed", "bounced", "complained"].includes(c.email_status))
    return refuse("This address has opted out or cannot be reached, so it will not be emailed.");
  if (kind === "marketing" && c.email_status !== "subscribed")
    return refuse("This contact has not agreed to marketing email.");

  const cap = st?.daily_cap ?? 90;
  if ((await sentToday(db)) >= cap) return refuse(`Daily sending limit reached (${cap}). Try again tomorrow.`);

  // Record which template it came from, only if that template still exists
  let templateId: string | null = orig?.template_id ?? null;
  if (templateIn) {
    const { data: t } = await db.from("email_templates").select("id").eq("id", templateIn).maybeSingle();
    templateId = t?.id ?? null;
  }
  const dealId = orig ? orig.deal_id : dealIn;
  const from = fromHeader(fromEnv!, st?.sender_name);

  // 5. Log as queued first (the database guard re-checks the recipient here).
  //    A unique index allows only one live retry per failed message, so a double click cannot send twice.
  const { data: msg, error: me } = await db.from("email_messages").insert({
    contact_id: c.id, deal_id: dealId, template_id: templateId, to_email: to, subject: r.subject, body: r.text, body_html: r.html,
    kind, status: "queued", provider: "resend", source: orig ? "retry" : "manual", retry_of: orig?.id ?? null,
  }).select("id").single();
  if (me?.code === "23505") return refuse("This message was already retried.");
  if (me || !msg) return refuse(String(me?.message ?? "Could not log the message.").slice(0, 200));

  // 6. Send through Resend
  const out = await resendSend(apiKey!, msg.id, {
    from, to: [to], subject: r.subject, html: full.html, text: full.text,
    ...(oneLine(st?.reply_to) ? { reply_to: oneLine(st.reply_to) } : {}),
    headers: { "List-Unsubscribe": `<${oneClick}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
  });

  await db.from("email_messages").update({
    status: out.status, provider_message_id: out.providerId, error: out.err, sent_at: out.status === "sent" ? new Date().toISOString() : null,
  }).eq("id", msg.id);
  await db.from("activities").insert({
    contact_id: c.id, deal_id: dealId, type: "email", body: r.subject,
    data: {
      subject: r.subject, status: out.status, message_id: msg.id, kind,
      ...(templateId ? { template_id: templateId } : {}), ...(orig ? { retry_of: orig.id } : {}), ...(out.err ? { error: out.err } : {}),
    },
  });

  return json({ ok: out.status === "sent", status: out.status, message_id: msg.id, ...(out.err ? { error: out.err } : {}) });
});
