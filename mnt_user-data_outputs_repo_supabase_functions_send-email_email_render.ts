// Pure helpers for send-email: merge fields, a small HTML allow-list sanitizer, and plain-text conversion.
// No network and no Deno APIs, so the same code can be tested anywhere.

export const FIELDS = ["first_name", "last_name", "full_name", "company", "email", "phone", "sender_name"] as const;
export type Vars = Record<string, string>;

export const escHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const id = (s: string) => s;

// {{first_name}} or {{first_name|there}} (fallback after the pipe; an empty fallback {{phone|}} is allowed)
const FIELD_RE = () => /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?:\|([^{}]*))?\}\}/g;

function merge(src: string, vars: Vars, textFn: (s: string) => string, valFn: (s: string) => string) {
  const problems: string[] = [];
  const re = FIELD_RE();
  let out = "", last = 0, m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    out += textFn(src.slice(last, m.index));
    last = re.lastIndex;
    const name = m[1], key = name.toLowerCase(), fb = m[2];
    if (!(FIELDS as readonly string[]).includes(key)) { problems.push(`Unknown merge field {{${name}}}.`); continue; }
    let v = (vars[key] ?? "").trim();
    if (!v && fb !== undefined) v = fb.trim();
    else if (!v) { problems.push(`{{${key}}} is empty for this contact. Add a fallback, for example {{${key}|there}}.`); continue; }
    out += valFn(v);
  }
  out += textFn(src.slice(last));
  if (/\{\{|\}\}/.test(src.replace(FIELD_RE(), ""))) problems.push("A merge field is not closed properly. Check the {{ }} brackets.");
  return { out, problems };
}

// ---- simple HTML allow-list ----
const ALLOWED = new Set(["p", "br", "b", "strong", "i", "em", "u", "a", "ul", "ol", "li", "h2", "h3", "blockquote"]);
const ANY_TAG = /<\/?(p|br|b|strong|i|em|u|a|ul|ol|li|h2|h3|blockquote)\b/i;
const BLOCK_TAG = /<\/?(p|ul|ol|li|h2|h3|blockquote)\b/i;
const STYLE: Record<string, string> = {
  p: "margin:0 0 12px",
  h2: "font-size:20px;margin:16px 0 8px",
  h3: "font-size:17px;margin:14px 0 6px",
  blockquote: "margin:0 0 12px;padding-left:12px;border-left:3px solid #ddd;color:#555",
  ul: "margin:0 0 12px;padding-left:22px",
  ol: "margin:0 0 12px;padding-left:22px",
};
// Escape stray < > and bare & but keep existing entities (&amp; &lt; &#39; ...)
const escText = (s: string) =>
  s.replace(/&(?!(?:[a-zA-Z][a-zA-Z0-9]{1,31}|#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6});)/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export const looksLikeHtml = (s: string) => ANY_TAG.test(s);

export function sanitizeHtml(src: string): string {
  const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s[^<>]*)?)>/g;
  const stack: string[] = [];
  let out = "", last = 0, m: RegExpExecArray | null;
  while ((m = TAG.exec(src))) {
    out += escText(src.slice(last, m.index));
    last = TAG.lastIndex;
    const closing = m[1] === "/", name = m[2].toLowerCase(), attrs = m[3] || "";
    if (!ALLOWED.has(name)) { out += escText(m[0]); continue; }       // unknown tag: shown as text, never run
    if (name === "br") { if (!closing) out += "<br>"; continue; }
    if (closing) {
      const i = stack.lastIndexOf(name);
      if (i < 0) continue;                                              // stray closing tag: drop
      while (stack.length > i) out += `</${stack.pop()}>`;
      continue;
    }
    if (stack.length >= 40) { out += escText(m[0]); continue; }
    if (name === "a") {
      const h = /\shref\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs);
      const url = ((h && (h[1] ?? h[2])) ?? "").trim();
      if (!/^(https?:\/\/|mailto:)[^\s"'<>`\x00-\x1f]+$/i.test(url)) continue; // bad or missing link: drop the tag, keep the text
      out += `<a href="${url}" style="color:#2a5bd7">`;
    } else out += STYLE[name] ? `<${name} style="${STYLE[name]}">` : `<${name}>`;
    stack.push(name);
  }
  out += escText(src.slice(last));
  while (stack.length) out += `</${stack.pop()}>`;
  return out;
}

const decode = (s: string) =>
  s.replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");

export function htmlToText(html: string): string {
  return decode(
    html
      .replace(/<a href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g, (_m, u: string, t: string) => {
        const tt = t.replace(/<[^>]+>/g, "").trim();
        return tt && decode(tt) !== decode(u) ? `${tt} (${u})` : u;
      })
      .replace(/<br>/g, "\n")
      .replace(/<\/(p|h2|h3|blockquote|ul|ol)>/g, "\n\n")
      .replace(/<li[^>]*>/g, "• ")
      .replace(/<\/li>/g, "\n")
      .replace(/<[^>]+>/g, ""),
  ).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

const LS = new RegExp("[" + String.fromCharCode(0x2028, 0x2029) + "]+", "g");
const oneLine = (s: string) => s.replace(/[\r\n\0]+/g, " ").replace(LS, " ").trim();

export type Rendered = { ok: true; subject: string; html: string; text: string } | { ok: false; error: string };

// Same function builds the preview and the real email, so what you preview is what is sent.
export function renderMessage(subjectSrc: string, bodySrc: string, vars: Vars): Rendered {
  const sub = merge(subjectSrc, vars, id, id);
  const subject = oneLine(sub.out).slice(0, 200);
  let html: string, text: string, problems = sub.problems;

  if (looksLikeHtml(bodySrc)) {
    const mh = merge(bodySrc, vars, id, escHtml);   // contact values are escaped; the sanitizer handles the rest
    problems = problems.concat(mh.problems);
    html = sanitizeHtml(mh.out);
    if (!BLOCK_TAG.test(bodySrc)) html = html.replace(/\n/g, "<br>");  // plain line breaks still work unless you use <p>/<ul>
    text = htmlToText(html);
  } else {
    const mh = merge(bodySrc, vars, escHtml, escHtml);
    const mt = merge(bodySrc, vars, id, id);
    problems = problems.concat(mh.problems);
    html = mh.out.replace(/\n/g, "<br>");
    text = mt.out;
  }
  problems = [...new Set(problems)];
  if (problems.length) return { ok: false, error: problems[0] + (problems.length > 1 ? ` (${problems.length - 1} more problem${problems.length > 2 ? "s" : ""})` : "") };
  if (!subject) return { ok: false, error: "The subject is empty after merging." };
  if (html.length > 60000) return { ok: false, error: "That message is too long once merged." };
  return { ok: true, subject, html, text };
}
