/* MODULE 5 (add-on): Insights (reporting) and Book a call (Calendly).
   Plugs into app.js through window.CRM_EXT and never edits Module 1's code.
   Database: module5_insights.sql (one read-only function, insights_summary). Needs Modules 1 to 4.
   Booking: the link comes from bookingUrl in config.js. index.html must allow it with frame-src https://calendly.com.
   Everything is inside one function, so it adds no globals. */
(() => {
const IN = { days: 30 };
const BOOK_DEFAULT = 'https://calendly.com/loomwellops/30min';
const num = v => Number(v) || 0;
const fmt = n => num(n).toLocaleString();
const LABELS = {
  none: 'Not opted in', subscribed: 'Subscribed', unsubscribed: 'Unsubscribed', bounced: 'Bounced', complained: 'Complained',
  sent: 'Sent', delivered: 'Delivered', failed: 'Failed', queued: 'Queued',
  manual: 'Sent by you', auto_reply: 'Auto-reply', automation: 'Automations', retry: 'Retries', alert: 'Alerts',
};
const lab = k => LABELS[k] || k;

const bars = items => {
  const mx = Math.max(1, ...items.map(i => i.v));
  return items.length
    ? `<div class="rp-bars">${items.map(i => `<div class="rp-row"><span class="rp-l" title="${esc(i.l)}">${esc(i.l)}</span><span class="rp-t"><i style="width:${(i.v / mx * 100).toFixed(1)}%"></i></span><b>${esc(i.t != null ? i.t : fmt(i.v))}</b></div>`).join('')}</div>`
    : '<p class="muted" style="font-size:13.5px;margin:12px 0 0">Nothing in this period yet.</p>';
};
const fromObj = (o, order) => {
  const keys = order ? [...order.filter(k => k in o), ...Object.keys(o).filter(k => !order.includes(k))] : Object.keys(o);
  return keys.map(k => ({ l: lab(k), v: num(o[k]) }));
};
const th = a => `<thead><tr>${a.map(x => `<th>${esc(x)}</th>`).join('')}</tr></thead>`;

async function viewInsights() {
  const d = await ok(sb.rpc('insights_summary', { p_days: IN.days }));
  if (!d || typeof d !== 'object') { $('#view').innerHTML = '<p class="muted">Could not load the numbers. Check that module5_insights.sql has been run.</p>'; return; }
  const bySrc = d.email_by_source || {}, byStatus = d.email_by_status || {};
  const sentTotal = Object.values(bySrc).reduce((a, n) => a + num(n), 0);
  const cap = num(d.daily_cap), today = num(d.sent_today);
  const formsOk = (d.forms || []).reduce((a, f) => a + num(f.accepted), 0);
  const daily = d.email_daily || [];
  let series;
  if (IN.days <= 30) series = daily.map(x => ({ l: new Date(x.day + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), v: num(x.n) }));
  else {
    series = [];
    for (let i = daily.length; i > 0; i -= 7) {
      const part = daily.slice(Math.max(0, i - 7), i);
      series.unshift({ l: new Date(part[0].day + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' wk', v: part.reduce((a, x) => a + num(x.n), 0) });
    }
  }
  $('#view').innerHTML = `
    <div class="row" style="display:flex;gap:10px;align-items:center;margin:0 0 14px">
      <label style="margin:0;display:flex;gap:8px;align-items:center">Period
        <select id="in_days" style="width:auto">${[7, 30, 90].map(n => `<option value="${n}" ${n === d.days ? 'selected' : ''}>Last ${n} days</option>`).join('')}</select></label>
      <button class="sm" id="in_refresh" type="button">Refresh</button>
    </div>
    <div class="summary-bar">
      <div class="kpi"><span>Emails sent</span><b>${fmt(sentTotal)}</b><small>to customers, last ${num(d.days)} days</small></div>
      <div class="kpi"><span>Sent today</span><b>${fmt(today)}${cap ? ' / ' + fmt(cap) : ''}</b><small>daily limit (UTC day)</small></div>
      <div class="kpi"><span>Opt-outs</span><b>${fmt(d.unsubscribed)}</b><small>unsubscribed in period</small></div>
      <div class="kpi"><span>Form leads</span><b>${fmt(formsOk)}</b><small>${fmt(d.new_contacts)} new contacts</small></div>
    </div>
    <div class="rp-grid">
      <section class="settings-card"><h2>Emails per ${IN.days <= 30 ? 'day' : 'week'}</h2>${bars(series)}</section>
      <section class="settings-card"><h2>Where emails came from</h2>${bars(fromObj(bySrc, ['manual', 'auto_reply', 'automation', 'retry']))}</section>
      <section class="settings-card"><h2>Email results</h2>${bars(fromObj(byStatus, ['sent', 'delivered', 'failed', 'bounced', 'complained', 'queued']))}</section>
      <section class="settings-card"><h2>Who can be emailed</h2><p class="sub">All contacts, today. Only Subscribed contacts are ever emailed.</p>${bars(fromObj(d.audience || {}, ['subscribed', 'none', 'unsubscribed', 'bounced', 'complained']))}</section>
      <section class="settings-card"><h2>New leads by source</h2>${bars((d.leads_by_source || []).map(x => ({ l: x.source, v: num(x.n) })))}</section>
    </div>
    <section class="settings-card" style="margin-top:18px"><h2>Lead forms</h2>
      <div class="wrap"><table>${th(['Form', 'Submissions', 'Accepted', 'Spam', 'Invalid', 'Rate limited'])}<tbody>${(d.forms || []).map(f =>
        `<tr><td>${esc(f.name)}</td><td>${fmt(f.total)}</td><td>${fmt(f.accepted)}</td><td>${fmt(f.spam)}</td><td>${fmt(f.invalid)}</td><td>${fmt(f.rate_limited)}</td></tr>`).join('')
        || '<tr><td colspan="6" class="muted">No forms yet.</td></tr>'}</tbody></table></div></section>
    <section class="settings-card" style="margin-top:18px"><h2>Automations</h2>
      <div class="wrap"><table>${th(['Rule', 'Runs', 'Done', 'Skipped', 'Failed', 'Waiting'])}<tbody>${(d.automation_rules || []).map(r =>
        `<tr><td>${esc(r.rule_name)}</td><td>${fmt(r.total)}</td><td>${fmt(r.done)}</td><td>${fmt(r.skipped)}</td><td>${fmt(r.failed)}</td><td>${fmt(r.waiting)}</td></tr>`).join('')
        || '<tr><td colspan="6" class="muted">No automation runs in this period.</td></tr>'}</tbody></table></div>
      ${(d.automation_skip_reasons || []).length ? `<h3>Most common reasons for skipping</h3>${bars(d.automation_skip_reasons.map(x => ({ l: x.reason, v: num(x.n) })))}` : ''}
    </section>
    <p class="muted" style="font-size:13px">Counts come straight from the database. Emails exclude internal alerts to you. Bookings made in Calendly are not tracked here.</p>`;
  $('#in_days').onchange = e => { IN.days = num(e.target.value) || 30; viewInsights(); };
  $('#in_refresh').onclick = viewInsights;
}

// ---- Book a call (Calendly) ----
function bookingUrl() {
  const u = String((window.CRM_CONFIG || {}).bookingUrl || BOOK_DEFAULT).trim();
  return /^https:\/\/calendly\.com\/[A-Za-z0-9._~\/-]+$/.test(u) ? u : '';   // only Calendly links are ever framed
}
async function copy(t) {
  try { await navigator.clipboard.writeText(t); toast('Link copied.', true); }
  catch { toast('Could not copy. Select the link and copy it by hand.'); }
}
function viewBooking() {
  const u = bookingUrl();
  if (!u) { $('#view').innerHTML = '<p class="muted">The booking link in config.js is missing or is not a calendly.com address.</p>'; return; }
  const src = `${u}?embed_domain=${encodeURIComponent(location.hostname || 'localhost')}&embed_type=Inline&hide_gdpr_banner=1`;
  $('#view').innerHTML = `
    <div class="row" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:0 0 12px">
      <code id="bk_url" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(u)}</code>
      <button class="sm" id="bk_copy" type="button">Copy link</button>
      <a class="btn sm" href="${esc(u)}" target="_blank" rel="noopener noreferrer">Open in new tab</a>
    </div>
    <p class="muted" style="font-size:13px;margin:0 0 12px">Paste this link into an email template so people can book a time. Bookings are handled by Calendly, and appear in your Calendly account and calendar.</p>
    <iframe title="Book a call" src="${esc(src)}" style="width:100%;height:760px;border:1px solid var(--line);border-radius:14px;background:#fff" loading="lazy" referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
  $('#bk_copy').onclick = () => copy(u);
}

const ext = window.CRM_EXT;
ext.views.insights = viewInsights;  ext.titles.insights = 'Insights';
ext.views.booking = viewBooking;    ext.titles.booking = 'Book a call';

// ---- rail buttons ----
const nav = document.getElementById('railNav');
const add = (id, title, icon, after) => {
  if (!nav || nav.querySelector(`[data-v="${id}"]`)) return null;
  const b = document.createElement('button');
  b.type = 'button'; b.dataset.v = id; b.dataset.tip = title; b.setAttribute('aria-label', title); b.style.setProperty('--ri', '3');
  b.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icon}</svg><span>${title}</span>`;
  const ref = after && nav.querySelector(`[data-v="${after}"]`); if (ref) ref.after(b); else nav.append(b);
  return b;
};
add('insights', 'Insights', '<path d="M21 12A9 9 0 1 1 12 3"/><path d="M21 3v9h-9"/>', 'reports');
add('booking', 'Book a call', '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>', 'insights');
})();
