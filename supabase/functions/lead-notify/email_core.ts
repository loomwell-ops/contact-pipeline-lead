// Shared by send-email, lead-notify and automation-run (each function ships its own copy of this file).
// Footer builder, Resend call, and the daily-count query. No secrets are read here.
import { escHtml } from "./email_render.ts";

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Line breaks in subject/sender fields are the classic way to smuggle extra email headers
const LS = new RegExp("[" + String.fromCharCode(0x2028, 0x2029) + "]+", "g");
export const oneLine = (s: unknown) => String(s ?? "").replace(/[\r\n\0]+/g, " ").replace(LS, " ").trim();

export function fromHeader(fromEnv: string, senderName: unknown): string {
  const addr = (fromEnv.match(/<([^>]+)>/)?.[1] ?? fromEnv).trim();
  const name = oneLine(senderName).replace(/[<>"]/g, "");
  return name ? `${name} <${addr}>` : fromEnv;
}

// The footer (postal address + unsubscribe link) is always added and cannot be edited away.
export function withFooter(bodyHtml: string, bodyText: string, postal: string, unsubPage: string) {
  const html = `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5">${bodyHtml}</div>` +
    `<hr style="border:0;border-top:1px solid #ddd;margin:24px 0 12px"><p style="font-size:12px;color:#666">${escHtml(postal)}<br><a href="${unsubPage}">Unsubscribe</a></p>`;
  const text = `${bodyText}\n\n--\n${postal}\nUnsubscribe: ${unsubPage}`;
  return { html, text };
}

// Sends through Resend. The idempotency key is the message id, so a retry of the same row cannot double-send.
export async function resendSend(apiKey: string, idemKey: string, payload: Record<string, unknown>) {
  let status: "sent" | "failed" = "sent", providerId: string | null = null, err: string | null = null;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      signal: AbortSignal.timeout(15000),
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Idempotency-Key": idemKey },
      body: JSON.stringify(payload),
    });
    const j = await res.json().catch(() => ({}));
    if (res.ok && j.id) providerId = j.id;
    else { status = "failed"; err = `${res.status}: ${oneLine(j.message ?? j.error ?? "send failed")}`.slice(0, 200); }
  } catch (e) {
    status = "failed";
    err = e instanceof Error && e.name === "TimeoutError" ? "The email provider did not answer in time." : "Could not reach the email provider.";
  }
  return { status, providerId, err };
}

// Messages that count against today's cap (UTC day), failed ones excluded
// deno-lint-ignore no-explicit-any
export async function sentToday(db: any): Promise<number> {
  const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
  const { count } = await db.from("email_messages").select("id", { count: "exact", head: true })
    .gte("created_at", dayStart.toISOString()).neq("status", "failed");
  return count ?? 0;
}
