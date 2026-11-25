/* LoomwellOps CRM: demo stand-in for Supabase.
   Loaded INSTEAD of config.js and the Supabase script by crm-demo.html. It holds sample data in memory,
   so the real CRM screens work, but nothing is saved, nothing is sent, and no real account is ever reached. */
(() => {
const now = Date.now(), H = 3600e3, D = 24 * H;
const ago = (days, hours = 0) => new Date(now - days * D - hours * H).toISOString();
let seq = 0;
const uid = () => '00000000-0000-4000-8000-' + String(++seq).padStart(12, '0');

window.CRM_CONFIG = {
  businessName: 'Loomwell Ops', accent: '#4b3fd6', bookingUrl: 'https://calendly.com/loomwellops/30min',
  currency: 'USD', locale: 'en-US', supabaseUrl: 'https://demo.invalid', supabaseAnonKey: 'demo',
  defaultStages: ['New Lead', 'Contacted', 'Qualified', 'Proposal', 'Won', 'Lost'],
};

// ---------------- sample data ----------------
const db = {};
const pipe = { id: uid(), created_at: ago(40), name: 'Sales Pipeline' };
db.pipelines = [pipe];
const st = {};
db.stages = window.CRM_CONFIG.defaultStages.map((name, position) => (st[name] = { id: uid(), created_at: ago(40), pipeline_id: pipe.id, name, position }));

const P = [ // first, last, company, source, email status, days since created, tags
  ['Maria', 'Santos', 'Santos Fitness Studio', 'Website form', 'subscribed', 21, ['gym']],
  ['James', 'Carter', 'Carter Plumbing', 'Facebook ad', 'subscribed', 18, ['trades']],
  ['Aisha', 'Rahman', 'Bright Smile Dental', 'Referral', 'subscribed', 16, ['clinic']],
  ['Daniel', 'Kim', "Kim's Auto Repair", 'Website form', 'subscribed', 2, ['trades']],
  ['Sofia', 'Reyes', 'Reyes Wellness Clinic', 'Instagram', 'subscribed', 27, ['clinic', 'vip']],
  ['Liam', "O'Connor", "O'Connor Roofing", 'Google search', 'subscribed', 25, ['trades']],
  ['Hannah', 'Brooks', 'Brooks Yoga Collective', 'Referral', 'subscribed', 12, ['studio']],
  ['Marcus', 'Johnson', 'Johnson HVAC', 'Facebook ad', 'subscribed', 3, ['trades']],
  ['Priya', 'Nair', 'Nair Physiotherapy', 'Website form', 'subscribed', 9, ['clinic']],
  ['Tomas', 'Alvarez', 'Alvarez Landscaping', 'Instagram', 'subscribed', 14, ['trades']],
  ['Chloe', 'Bennett', 'Bennett Pilates', 'Website form', 'subscribed', 24, ['studio', 'vip']],
  ['Ethan', 'Walker', 'Walker Electric', 'Referral', 'subscribed', 7, ['trades']],
  ['Grace', 'Lim', 'Lim Beauty Lounge', 'Website form', 'unsubscribed', 19, ['salon']],
  ['Noah', 'Fischer', 'Fischer Cleaning Co', 'Facebook ad', 'bounced', 11, []],
  ['Olivia', 'Turner', 'Turner Physio', 'Google search', 'none', 5, ['clinic']],
];
db.contacts = P.map((p, i) => {
  const slug = (p[2].toLowerCase().replace(/[^a-z]+/g, '').slice(0, 14));
  const sub = p[4] === 'subscribed';
  return { id: uid(), created_at: ago(p[5]), updated_at: ago(p[5]), first_name: p[0], last_name: p[1],
    email: `${p[0].toLowerCase()}@${slug}.example`, phone: `+1 555 01${String(10 + i).padStart(2, '0')}`, company: p[2], source: p[3],
    tags: p[6], custom_fields: i === 0 ? { 'Preferred contact time': 'Mornings', 'Members': '120' } : {},
    email_status: p[4], consented_at: sub ? ago(p[5]) : null, consent_source: sub ? 'form' : null,
    unsubscribed_at: p[4] === 'unsubscribed' ? ago(4) : null, unsub_token: uid() };
});
const C = i => db.contacts[i];

const D_ = [ // contact index, title, value, stage, days ago
  [0, 'Studio membership system', 1800, 'Qualified', 20], [1, 'Website and lead follow-up', 2400, 'Proposal', 17],
  [2, 'Appointment reminders setup', 3200, 'Contacted', 15], [3, 'Missed-call text-back', 900, 'New Lead', 2],
  [4, 'Full clinic automation', 4500, 'Won', 26], [5, 'Quote follow-up sequence', 1500, 'Lost', 24],
  [6, 'Class booking funnel', 2100, 'Qualified', 11], [7, 'Instant lead reply', 1200, 'New Lead', 3],
  [8, 'Patient reminder flow', 2700, 'Contacted', 8], [9, 'Seasonal campaign setup', 1950, 'Proposal', 13],
  [10, 'Studio onboarding flow', 2800, 'Won', 23], [11, 'Estimate follow-up', 3600, 'Qualified', 6],
];
const posCount = {};
db.deals = D_.map(d => {
  const s = st[d[3]]; posCount[s.id] = (posCount[s.id] ?? -1) + 1;
  return { id: uid(), created_at: ago(d[4]), contact_id: C(d[0]).id, pipeline_id: pipe.id, stage_id: s.id, title: d[1], value: d[2],
    status: d[3] === 'Won' ? 'won' : d[3] === 'Lost' ? 'lost' : 'open', position: posCount[s.id] };
});

const FORM_ID1 = uid(), FORM_ID2 = uid();
const fld = (key, label, type, required, options) => ({ key, label, type, required, ...(options ? { options } : {}) });
db.forms = [
  { id: FORM_ID1, created_at: ago(35), slug: 'free-consultation', name: 'Free consultation', title: 'Book a free consultation', description: 'Tell us a little about your business.',
    submit_label: 'Request my consultation', success_message: 'Thanks, we will be in touch within one business day.', redirect_url: null, source: 'Website form', tags: ['website'],
    consent_text: 'I agree to be contacted about my enquiry.', active: true, stage_id: st['New Lead'].id, pipeline_id: pipe.id,
    fields: [fld('first_name', 'First name', 'text', true), fld('last_name', 'Last name', 'text', false), fld('email', 'Email', 'email', true), fld('phone', 'Phone', 'tel', false),
      fld('business_type', 'Type of business', 'select', false, ['Gym or studio', 'Clinic', 'Local service', 'Other']), fld('message', 'How can we help?', 'textarea', false), fld('consent', 'Consent', 'consent', false)] },
  { id: FORM_ID2, created_at: ago(20), slug: 'quote-request', name: 'Quote request', title: 'Request a quote', description: '',
    submit_label: 'Send', success_message: 'Thanks, we will be in touch soon.', redirect_url: null, source: 'Quote form', tags: [],
    consent_text: 'I agree to be contacted about my enquiry.', active: true, stage_id: st['New Lead'].id, pipeline_id: pipe.id,
    fields: [fld('first_name', 'First name', 'text', true), fld('email', 'Email', 'email', true), fld('message', 'Project details', 'textarea', false), fld('consent', 'Consent', 'consent', false)] },
];
const sub = (form, ci, outcome, days, payload) => ({ id: uid(), created_at: ago(days), form_id: form, contact_id: ci == null ? null : C(ci).id, deal_id: null, outcome, payload });
db.form_submissions = [
  sub(FORM_ID1, 0, 'accepted', 21, { email: C(0).email }), sub(FORM_ID1, 3, 'accepted', 2, { email: C(3).email }), sub(FORM_ID1, 8, 'accepted', 9, { email: C(8).email }),
  sub(FORM_ID1, 10, 'accepted', 24, { email: C(10).email }), sub(FORM_ID1, null, 'spam', 6, { email: 'cheap-seo@spam.example' }), sub(FORM_ID1, null, 'invalid', 5, { email: 'not-an-email' }),
  sub(FORM_ID2, 12, 'accepted', 19, { email: C(12).email }), sub(FORM_ID2, null, 'rate_limited', 1, { email: 'tester@example.com' }),
];

db.email_templates = [
  { id: uid(), created_at: ago(30), updated_at: ago(30), name: 'Welcome', kind: 'transactional', subject: 'Thanks for getting in touch, {{first_name|there}}',
    body: 'Hi {{first_name|there}},\n\nThanks for reaching out. I will review what you sent and reply within one business day.\n\nYou can also book a time that suits you: https://calendly.com/loomwellops/30min\n\n{{sender_name}}' },
  { id: uid(), created_at: ago(28), updated_at: ago(28), name: 'Follow-up (no reply)', kind: 'transactional', subject: 'Just checking in, {{first_name|there}}',
    body: '<p>Hi {{first_name|there}},</p><p>I wanted to follow up on my last message about <b>{{company|your business}}</b>. Is now a good time to talk?</p><p>{{sender_name}}</p>' },
  { id: uid(), created_at: ago(25), updated_at: ago(25), name: 'Monthly tips', kind: 'marketing', subject: '3 quick follow-up wins for {{company|your business}}',
    body: 'Hi {{first_name|there}},\n\n1. Reply to new leads within minutes.\n2. Text back missed calls.\n3. Send reminders before every appointment.\n\n{{sender_name}}' },
];
db.email_settings = [{ id: true, daily_cap: 90, sender_name: 'Japhette at Loomwell Ops', reply_to: '', postal_address: '123 Sample Street, Quezon City, Philippines', site_url: 'https://example.com' }];

const msg = (ci, subject, status, source, days, hours = 0, kind = 'transactional') => ({ id: uid(), created_at: ago(days, hours), contact_id: C(ci).id, to_email: C(ci).email,
  subject, body: subject, status, kind, source, provider: 'resend', provider_message_id: null, error: status === 'failed' ? '422: Sample failure shown in the demo' : null, sent_at: status === 'failed' ? null : ago(days, hours) });
db.email_messages = [
  msg(0, 'Thanks for getting in touch, Maria', 'delivered', 'automation', 21), msg(1, 'Thanks for getting in touch, James', 'delivered', 'automation', 18),
  msg(2, 'Just checking in, Aisha', 'sent', 'manual', 14, 3), msg(4, 'Your clinic automation proposal', 'delivered', 'manual', 25), msg(6, 'Class booking funnel next steps', 'sent', 'manual', 10),
  msg(8, 'Thanks for getting in touch, Priya', 'delivered', 'automation', 9), msg(9, 'Just checking in, Tomas', 'sent', 'automation', 5), msg(3, 'Thanks for getting in touch, Daniel', 'sent', 'auto_reply', 2),
  msg(11, 'Estimate details', 'failed', 'manual', 1, 2), msg(10, 'Monthly tips for your studio', 'delivered', 'manual', 3, 0, 'marketing'),
  msg(1, 'Just checking in, James', 'sent', 'automation', 1), msg(7, 'Thanks for getting in touch, Marcus', 'sent', 'auto_reply', 3),
];

const act = (ci, type, body, data, days, hours = 0) => ({ id: uid(), created_at: ago(days, hours), contact_id: C(ci).id, deal_id: null, type, body, data: data || null });
db.activities = [
  act(0, 'note', 'Runs two studios. Wants class booking and reminders in one place. Follow up Friday.', null, 20),
  act(0, 'form_submission', null, { form_name: 'Free consultation', consent_at: ago(21), consent_text: 'I agree to be contacted about my enquiry.', utm: { utm_source: 'google' },
    answers: [{ label: 'Type of business', value: 'Gym or studio' }, { label: 'How can we help?', value: 'We lose leads between Instagram and our front desk.' }] }, 21),
  act(0, 'email', 'Thanks for getting in touch, Maria', { subject: 'Thanks for getting in touch, Maria', status: 'delivered' }, 21),
  act(1, 'note', 'Called back. Wants quotes sent same day. Sent proposal.', null, 16), act(1, 'automation', 'Automation "Intro email when contacted": sent Welcome', { rule: 'Intro email when contacted' }, 17),
  act(2, 'note', 'Referred by Dr. Patel. Needs reminders to cut no-shows.', null, 15), act(2, 'email', 'Just checking in, Aisha', { subject: 'Just checking in, Aisha', status: 'sent' }, 14, 3),
  act(3, 'form_submission', null, { form_name: 'Free consultation', consent_at: ago(2), consent_text: 'I agree to be contacted about my enquiry.', utm: { utm_source: 'facebook', utm_campaign: 'spring' },
    answers: [{ label: 'Type of business', value: 'Local service' }, { label: 'How can we help?', value: 'We miss calls while we are under cars.' }] }, 2),
  act(4, 'note', 'Signed. Kickoff call booked for Monday.', null, 24), act(4, 'reply', 'Marked as replied', { kind: 'reply' }, 24, 2),
  act(5, 'note', 'Went with a cheaper local provider. Revisit in 6 months.', null, 22),
  act(10, 'note', 'Loved the demo. Signed after one call.', null, 22),
  act(12, 'email_unsubscribe', 'Unsubscribed from emails via the unsubscribe link', null, 4),
].sort((a, b) => b.created_at.localeCompare(a.created_at));

db.automation_settings = [{ id: true, enabled: true, hourly_limit: 20, updated_at: ago(10) }];
const R = [uid(), uid(), uid()];
db.automation_rules = [
  { id: R[0], created_at: ago(30), updated_at: ago(30), name: 'Intro email when contacted', enabled: true, trigger_type: 'stage_entered', stage_id: st['Contacted'].id, wait_hours: null, action_type: 'send_template', template_id: db.email_templates[0].id, tag: null, note_text: null, cooldown_hours: 24 },
  { id: R[1], created_at: ago(30), updated_at: ago(30), name: 'Nudge after proposal', enabled: true, trigger_type: 'no_reply', stage_id: st['Proposal'].id, wait_hours: 72, action_type: 'send_template', template_id: db.email_templates[1].id, tag: null, note_text: null, cooldown_hours: 48 },
  { id: R[2], created_at: ago(29), updated_at: ago(29), name: 'Tag Facebook leads', enabled: true, trigger_type: 'lead_created', stage_id: null, wait_hours: null, action_type: 'add_tag', template_id: null, tag: 'facebook-lead', note_text: null, cooldown_hours: 0 },
];
const run = (r, ci, status, reason, days, hours = 0) => ({ id: uid(), created_at: ago(days, hours), processed_at: ago(days, hours), rule_id: R[r], rule_name: db.automation_rules[r].name,
  trigger_type: db.automation_rules[r].trigger_type, action_type: db.automation_rules[r].action_type, contact_id: C(ci).id, deal_id: null, stage_id: null, status, reason, email_message_id: null });
db.automation_runs = [
  run(0, 8, 'done', null, 9), run(0, 2, 'done', null, 14), run(1, 1, 'done', null, 1), run(1, 9, 'done', null, 5), run(1, 11, 'skipped', 'Contact replied', 4),
  run(0, 12, 'skipped', 'Contact has opted out or cannot be reached', 3), run(2, 3, 'done', null, 2), run(0, 13, 'skipped', 'Contact has opted out or cannot be reached', 6),
  run(1, 6, 'skipped', 'Cooldown: already emailed automatically in the last 48 hours', 2), run(0, 11, 'failed', 'Template problem: {{company}} is empty for this contact', 1),
].sort((a, b) => b.created_at.localeCompare(a.created_at));

// ---------------- tiny Supabase-style query builder ----------------
const clone = x => JSON.parse(JSON.stringify(x));
const cmp = (a, b) => (a == null ? -1 : b == null ? 1 : a < b ? -1 : a > b ? 1 : 0);
const defaults = {
  contacts: () => ({ tags: [], custom_fields: {}, email_status: 'none', consented_at: null, consent_source: null, unsubscribed_at: null, unsub_token: uid() }),
  deals: () => ({ status: 'open', value: 0, position: 0 }),
};
const cascade = { contacts: ['deals', 'activities', 'email_messages', 'form_submissions', 'automation_runs'] };

class Q {
  constructor(t) { this.t = t; this.op = 'select'; this.f = []; this.ord = []; this.ret = false; this.opts = {}; this.pl = null; this.lim = null; this.rng = null; this.one = null; }
  select(_c, opts) { if (this.op !== 'select') this.ret = true; if (opts) this.opts = opts; return this; }
  insert(p) { this.op = 'insert'; this.pl = p; return this; }
  update(p) { this.op = 'update'; this.pl = p; return this; }
  upsert(p) { this.op = 'upsert'; this.pl = p; return this; }
  delete() { this.op = 'delete'; return this; }
  eq(c, v) { this.f.push(['eq', c, v]); return this; }
  neq(c, v) { this.f.push(['neq', c, v]); return this; }
  in(c, v) { this.f.push(['in', c, v]); return this; }
  gte(c, v) { this.f.push(['gte', c, v]); return this; }
  order(c, o) { this.ord.push([c, !(o && o.ascending === false)]); return this; }
  limit(n) { this.lim = n; return this; }
  range(a, b) { this.rng = [a, b]; return this; }
  maybeSingle() { this.one = 'maybe'; return this; }
  single() { this.one = 'single'; return this; }
  then(res, rej) { return Promise.resolve().then(() => this.run()).then(res, rej); }
  run() {
    const T = db[this.t];
    if (!T) return { data: null, error: { message: `The demo has no "${this.t}" table.` } };
    const match = r => this.f.every(([op, c, v]) => op === 'eq' ? r[c] === v : op === 'neq' ? r[c] !== v : op === 'in' ? v.includes(r[c]) : r[c] >= v);
    let rows;
    if (this.op === 'insert' || this.op === 'upsert') {
      rows = [];
      for (const item of [].concat(this.pl)) {
        const ex = this.op === 'upsert' && item.id ? T.find(r => r.id === item.id) : null;
        if (ex) { Object.assign(ex, clone(item)); rows.push(ex); continue; }
        const row = { id: uid(), created_at: new Date().toISOString(), ...(defaults[this.t] ? defaults[this.t]() : {}), ...clone(item) };
        T.push(row); rows.push(row);
      }
    } else if (this.op === 'update') {
      rows = T.filter(match); rows.forEach(r => { Object.assign(r, clone(this.pl)); if ('updated_at' in r) r.updated_at = new Date().toISOString(); });
    } else if (this.op === 'delete') {
      rows = T.filter(match); const ids = new Set(rows.map(r => r.id));
      db[this.t] = T.filter(r => !ids.has(r.id));
      for (const child of cascade[this.t] || []) db[child] = db[child].filter(r => !ids.has(r.contact_id));
    } else {
      rows = T.filter(match);
      for (const [c, asc] of [...this.ord].reverse()) rows = [...rows].sort((a, b) => (asc ? 1 : -1) * cmp(a[c], b[c]));
      const total = rows.length;
      if (this.rng) rows = rows.slice(this.rng[0], this.rng[1] + 1); else if (this.lim != null) rows = rows.slice(0, this.lim);
      if (this.opts.head) return { data: null, count: total, error: null };
    }
    const out = (this.op === 'select' || this.ret) ? clone(rows) : null;
    if (this.one) {
      if (this.one === 'single' && (!out || out.length !== 1)) return { data: null, error: { message: 'No single row found.' } };
      return { data: out ? out[0] || null : null, error: null };
    }
    return { data: out, error: null };
  }
}

// ---------------- email preview (the real one runs on the server) ----------------
const escH = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const FIELDS = ['first_name', 'last_name', 'full_name', 'company', 'email', 'phone', 'sender_name'];
function renderPreview(b) {
  const c = db.contacts.find(x => x.id === b.contact_id); if (!c) return { ok: false, error: 'Contact not found.' };
  const s = db.email_settings[0];
  const vars = { first_name: c.first_name || '', last_name: c.last_name || '', full_name: [c.first_name, c.last_name].filter(Boolean).join(' '), company: c.company || '', email: c.email || '', phone: c.phone || '', sender_name: s.sender_name };
  let problem = '';
  const merge = (src, esc) => String(src).replace(/\{\{\s*([A-Za-z_]\w*)\s*(?:\|([^{}]*))?\}\}/g, (_m, name, fb) => {
    const k = name.toLowerCase(); if (!FIELDS.includes(k)) { problem ||= `Unknown merge field {{${name}}}.`; return ''; }
    let v = (vars[k] || '').trim(); if (!v && fb !== undefined) v = fb.trim(); else if (!v) { problem ||= `{{${k}}} is empty for this contact. Add a fallback, for example {{${k}|there}}.`; return ''; }
    return esc ? escH(v) : v;
  });
  const subject = merge(b.subject || '(no subject yet)', false).replace(/[\r\n]+/g, ' ').trim();
  const src = b.body || '(no message yet)';
  const isHtml = /<\/?(p|br|b|strong|i|em|u|a|ul|ol|li|h2|h3|blockquote)\b/i.test(src);
  const body = isHtml ? merge(src, true) : merge(escH(src), true).replace(/\n/g, '<br>');
  if (problem) return { ok: false, error: problem };
  const text = body.replace(/<br>/g, '\n').replace(/<[^>]+>/g, '');
  const html = `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5">${body}</div><hr style="border:0;border-top:1px solid #ddd;margin:24px 0 12px"><p style="font-size:12px;color:#666">${escH(s.postal_address)}<br><a href="#">Unsubscribe</a></p>`;
  return { ok: true, preview: true, subject, html, text };
}

// ---------------- insights_summary (same shape the real database function returns) ----------------
function insights(days) {
  days = Math.max(1, Math.min(Number(days) || 30, 365));
  const since = Date.now() - days * D, inP = r => new Date(r.created_at).getTime() >= since;
  const count = (arr, key) => arr.reduce((o, r) => ((o[r[key]] = (o[r[key]] || 0) + 1), o), {});
  const em = db.email_messages.filter(m => inP(m) && m.kind !== 'internal');
  const daily = []; const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) {
    const d0 = new Date(today.getTime() - i * D), key = d0.toISOString().slice(0, 10);
    daily.push({ day: key, n: em.filter(m => m.status !== 'failed' && m.created_at.slice(0, 10) === key).length });
  }
  const src = {}; db.contacts.filter(inP).forEach(c => { const k = (c.source || '').trim() || 'Unknown'; src[k] = (src[k] || 0) + 1; });
  const forms = db.forms.map(f => { const s = db.form_submissions.filter(x => x.form_id === f.id && inP(x));
    return { name: f.name, total: s.length, accepted: s.filter(x => x.outcome === 'accepted').length, spam: s.filter(x => x.outcome === 'spam').length, invalid: s.filter(x => x.outcome === 'invalid').length, rate_limited: s.filter(x => x.outcome === 'rate_limited').length }; })
    .sort((a, b) => b.total - a.total);
  const runs = db.automation_runs.filter(inP), names = [...new Set(runs.map(r => r.rule_name))];
  const reasons = count(runs.filter(r => r.status === 'skipped' && r.reason), 'reason');
  return {
    days, audience: count(db.contacts, 'email_status'), new_contacts: db.contacts.filter(inP).length,
    leads_by_source: Object.entries(src).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([source, n]) => ({ source, n })),
    email_by_status: count(em, 'status'), email_by_source: count(em.filter(m => m.status !== 'failed'), 'source'), email_daily: daily,
    unsubscribed: db.activities.filter(a => a.type === 'email_unsubscribe' && inP(a)).length,
    sent_today: db.email_messages.filter(m => m.status !== 'failed' && m.created_at.slice(0, 10) === today.toISOString().slice(0, 10)).length, daily_cap: db.email_settings[0].daily_cap,
    forms,
    automation_rules: names.map(n => { const r = runs.filter(x => x.rule_name === n); return { rule_name: n, total: r.length, done: r.filter(x => x.status === 'done').length, skipped: r.filter(x => x.status === 'skipped').length, failed: r.filter(x => x.status === 'failed').length, waiting: r.filter(x => ['queued', 'processing'].includes(x.status)).length }; }).sort((a, b) => b.total - a.total),
    automation_skip_reasons: Object.entries(reasons).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([reason, n]) => ({ reason, n })),
  };
}

// ---------------- the fake client ----------------
let signedIn = true, listener = null;
const client = {
  from: t => new Q(t),
  rpc: async (name, args) => name === 'insights_summary' ? { data: insights(args && args.p_days), error: null } : { data: null, error: { message: 'Not available in the demo.' } },
  functions: { invoke: async (name, { body } = {}) => {
    if (name !== 'send-email') return { data: null, error: { context: { json: async () => ({ error: 'Not available in the demo.' }) } } };
    if (body && body.preview) return { data: renderPreview(body), error: null };
    return { data: { ok: false, error: 'Sending is turned off in this demo, so no email was sent. Previews work.' }, error: null };
  } },
  auth: {
    getSession: () => new Promise(r => setTimeout(() => r({ data: { session: signedIn ? { user: { id: 'demo', email: 'demo@example.com' } } : null } }), 60)),
    onAuthStateChange: cb => { listener = cb; return { data: { subscription: { unsubscribe() {} } } }; },
    signInWithPassword: async () => { signedIn = true; return { data: { session: {} }, error: null }; },
    signOut: async () => { signedIn = false; if (listener) listener('SIGNED_OUT'); return { error: null }; },
    resetPasswordForEmail: async () => ({ error: null }), updateUser: async () => ({ error: null }),
  },
};
window.supabase = { createClient: () => client };
})();
