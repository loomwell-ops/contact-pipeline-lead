/* MODULE 2 (add-on): lead forms admin: builder, share/embed, submission log, timeline card.
   Plugs into app.js through window.CRM_EXT. Public page: form.html. Database: sql/module2_lead_forms.sql.
   Needs the Module 1 tables. Everything is inside one function, so it adds no globals. */
(() => {
const FT = ['text', 'email', 'tel', 'textarea', 'select', 'checkbox', 'consent'];
const FM = { forms: [], pipelines: [], stages: [], id: null, tab: 'builder' };
const firstStage = () => { const p = FM.pipelines[0]; return FM.stages.filter(s => p && s.pipeline_id === p.id).sort((a, b) => a.position - b.position)[0] || {}; };
const stageOptions = sel => FM.pipelines.map(p => { const o = FM.stages.filter(s => s.pipeline_id === p.id).sort((a, b) => a.position - b.position).map(s => `<option value="${s.id}" ${s.id === sel ? 'selected' : ''}>${esc(s.name)}</option>`).join(''); return FM.pipelines.length > 1 ? `<optgroup label="${esc(p.name)}">${o}</optgroup>` : o; }).join('');

async function viewForms() {
  [FM.forms, FM.pipelines, FM.stages] = await Promise.all([ok(sb.from('forms').select('*').order('created_at')), ok(sb.from('pipelines').select('*').order('created_at')), ok(sb.from('stages').select('*').order('position'))]);
  if (!FM.forms.some(f => f.id === FM.id)) FM.id = (FM.forms[0] || {}).id;
  drawForms();
}
function drawForms() {
  const f = FM.forms.find(x => x.id === FM.id);
  $('#view').innerHTML = `<div class="fshell"><div class="flist"><button class="pri" id="newform">New form</button>
    ${FM.forms.map(x => `<div class="fitem ${x.id === FM.id ? 'on' : ''}" data-id="${x.id}"><b>${esc(x.name)}</b><small>/${esc(x.slug)} · ${x.active ? 'live' : 'paused'}</small></div>`).join('')}</div>
    <div class="fdetail">${f ? `<div class="tabs">${['builder', 'share', 'log'].map(t => `<button class="${FM.tab === t ? 'on' : ''}" data-tab="${t}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}</div><div id="ftab"></div>`
      : '<p class="muted">No forms yet. Create one to start capturing leads.</p>'}</div></div>`;
  $('#newform').onclick = newForm;
  $$('.fitem').forEach(el => el.onclick = () => { FM.id = el.dataset.id; drawForms(); });
  $$('[data-tab]').forEach(b => b.onclick = () => { FM.tab = b.dataset.tab; drawForms(); });
  if (f) ({ builder: tabBuilder, share: tabShare, log: tabLog })[FM.tab](f);
}
async function newForm() {
  const name = (prompt('Form name, for example "Free consultation"') || '').trim(); if (!name) return;
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'form'; let slug = base, i = 2;
  while (FM.forms.some(f => f.slug === slug)) slug = base + '-' + i++;
  const first = firstStage();
  const fld = (key, label, type, required) => ({ key, label, type, required });
  const row = await ok(sb.from('forms').insert({ slug, name, title: name, pipeline_id: first.pipeline_id || null, stage_id: first.id || null,
    consent_text: 'I agree to be contacted about my enquiry.',
    fields: [fld('first_name', 'First name', 'text', true), fld('last_name', 'Last name', 'text', false), fld('email', 'Email', 'email', true),
      fld('phone', 'Phone', 'tel', false), fld('message', 'Message', 'textarea', false), fld('consent', 'Consent', 'consent', false)] }).select());
  FM.id = row[0].id; FM.tab = 'builder'; viewForms();
}

function readForm(d) {
  const o = { ...d };
  $$('#ftab [data-k]').forEach(el => { o[el.dataset.k] = el.type === 'checkbox' ? el.checked : el.value; });
  o.tags = String(o.tags || '').split(',').map(x => x.trim()).filter(Boolean);
  o.fields = $$('#frows .frow').map(r => {
    const g = k => { const e = r.querySelector(`[data-f="${k}"]`); return e ? (e.type === 'checkbox' ? e.checked : e.value) : ''; };
    const x = { key: g('key').trim(), label: g('label').trim(), type: g('type'), required: g('required') };
    if (x.type === 'select') x.options = g('options').split(',').map(s => s.trim()).filter(Boolean);
    return x;
  });
  return o;
}
function tabBuilder(f, d) {
  d = d || { ...f, fields: JSON.parse(JSON.stringify(f.fields || [])) };
  const t = (k, label, v) => `<label>${label}<input data-k="${k}" value="${esc(v)}"></label>`;
  $('#ftab').innerHTML = `<div class="grid">${t('name', 'Form name', d.name)}${t('slug', 'URL slug (a-z, 0-9, dashes)', d.slug)}${t('title', 'Page title', d.title)}${t('submit_label', 'Button text', d.submit_label)}</div>
    <label>Description<textarea data-k="description" rows="2">${esc(d.description)}</textarea></label>
    <label>Success message<input data-k="success_message" value="${esc(d.success_message)}"></label>
    <div class="grid"><label>Lead lands in stage<select data-k="stage_id">${stageOptions(d.stage_id)}</select></label>
    ${t('source', 'Fixed source (optional)', d.source)}${t('tags', 'Tags (comma-separated)', (d.tags || []).join(', '))}${t('redirect_url', 'Redirect after submit (optional, https://)', d.redirect_url)}</div>
    <label>Consent wording<input data-k="consent_text" value="${esc(d.consent_text)}"></label>
    <label class="chk"><input type="checkbox" data-k="active" ${d.active ? 'checked' : ''}> Form is live</label>
    <h3>Fields</h3><div id="frows">${d.fields.map((x, i) => `<div class="frow" data-i="${i}">
      <input data-f="key" value="${esc(x.key)}" placeholder="key"><input data-f="label" value="${esc(x.label)}" placeholder="Label">
      <select data-f="type">${FT.map(y => `<option ${y === x.type ? 'selected' : ''}>${y}</option>`).join('')}</select>
      <label class="chk"><input type="checkbox" data-f="required" ${x.required ? 'checked' : ''}>Required</label>
      ${x.type === 'select' ? `<input data-f="options" value="${esc((x.options || []).join(', '))}" placeholder="Options, comma-separated">` : ''}
      <span class="fb"><button class="sm" data-m="up">↑</button><button class="sm" data-m="dn">↓</button><button class="sm danger" data-m="rm">×</button></span></div>`).join('')}</div>
    <div class="row"><button id="addf">Add field</button><button class="pri" id="savef">Save form</button><button class="danger" id="delf">Delete form</button></div>`;
  const re = fn => { const nd = readForm(d); fn(nd); tabBuilder(f, nd); };
  $$('#frows select[data-f="type"]').forEach(s => s.onchange = () => re(() => {}));
  $$('#frows [data-m]').forEach(b => b.onclick = () => {
    const i = +b.closest('.frow').dataset.i, m = b.dataset.m;
    re(nd => { const a = nd.fields; if (m === 'rm') a.splice(i, 1); else { const j = m === 'up' ? i - 1 : i + 1; if (j >= 0 && j < a.length) [a[i], a[j]] = [a[j], a[i]]; } });
  });
  $('#addf').onclick = () => re(nd => nd.fields.push({ key: 'field_' + (nd.fields.length + 1), label: 'New field', type: 'text', required: false }));
  $('#savef').onclick = () => saveForm(f, readForm(d));
  $('#delf').onclick = async () => {
    if (!confirm(`Delete "${f.name}"? Leads already captured are kept, but its link stops working.`)) return;
    await ok(sb.from('forms').delete().eq('id', f.id)); FM.id = null; viewForms();
  };
}
async function saveForm(f, o) {
  const keys = o.fields.map(x => x.key);
  if (!o.name.trim()) return toast('Give the form a name.');
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(o.slug)) return toast('The slug may use lowercase letters, numbers and single dashes only.');
  if (o.redirect_url && !/^https?:\/\//i.test(o.redirect_url)) return toast('The redirect must start with http:// or https://');
  if (o.fields.some(x => !x.label || !/^[a-z][a-z0-9_]*$/.test(x.key))) return toast('Every field needs a label and a key (lowercase letters, numbers, underscores).');
  if (new Set(keys).size !== keys.length) return toast('Field keys must be unique.');
  if (!keys.includes('email') && !keys.includes('phone')) return toast('Add a field with the key email or phone so leads can be matched.');
  if (o.fields.some(x => x.type === 'select' && !x.options.length)) return toast('Select fields need at least one option.');
  await ok(sb.from('forms').update({ slug: o.slug, name: o.name.trim(), title: o.title || null, description: o.description || null,
    submit_label: o.submit_label || 'Send', success_message: o.success_message || 'Thanks, we will be in touch soon.', redirect_url: o.redirect_url || null,
    source: o.source || null, tags: o.tags, consent_text: o.consent_text || null, active: o.active, stage_id: o.stage_id || null,
    pipeline_id: (FM.stages.find(s => s.id === o.stage_id) || {}).pipeline_id || null, fields: o.fields }).eq('id', f.id));
  await viewForms(); toast('Form saved', true);
}

async function copy(t) {
  try { await navigator.clipboard.writeText(t); toast('Copied', true); }
  catch (e) {
    const a = document.createElement('textarea'); a.value = t; document.body.append(a); a.select();
    try { document.execCommand('copy'); toast('Copied', true); } catch (e2) { toast('Copy failed. Select the text and copy it by hand.'); }
    a.remove();
  }
}
function tabShare(f) {
  const url = new URL('form.html?f=' + encodeURIComponent(f.slug), location.href).href;
  const embed = `<iframe src="${url}&embed=1" style="width:100%;border:0;min-height:560px" title="${f.name.replace(/"/g, '')}"></iframe>`;
  $('#ftab').innerHTML = `${f.active ? '' : '<p class="warn">This form is paused. Visitors will see "not available".</p>'}
    <h3>Share link</h3><div class="code" id="u1">${esc(url)}</div>
    <div class="row"><button data-c="u1">Copy link</button><a class="btn" href="${esc(url)}" target="_blank" rel="noopener">Open form</a></div>
    <h3>Embed on your website</h3><div class="code" id="u2">${esc(embed)}</div><div class="row"><button data-c="u2">Copy embed code</button></div>
    <p class="muted">Track campaigns by adding <code>&amp;utm_source=facebook</code> to the link. UTM tags are saved on the lead and shown on their timeline.</p>`;
  $$('[data-c]').forEach(b => b.onclick = () => copy($('#' + b.dataset.c).textContent));
}

async function tabLog(f) {
  const rows = await ok(sb.from('form_submissions').select('*').eq('form_id', f.id).order('created_at', { ascending: false }).limit(100));
  $('#ftab').innerHTML = `<div class="wrap"><table><thead><tr><th>When</th><th>Outcome</th><th>Lead</th><th></th></tr></thead><tbody>${rows.map(r => {
    const c = contactById(r.contact_id), who = c ? cname(c) : ((r.payload || {}).email || 'unknown');
    return `<tr data-cid="${r.contact_id || ''}"><td>${new Date(r.created_at).toLocaleString()}</td><td><span class="pill ${r.outcome}">${r.outcome.replace('_', ' ')}</span></td><td>${esc(who)}</td><td><button class="sm danger" data-del="${r.id}">Delete</button></td></tr>`;
  }).join('') || '<tr><td colspan="4" class="muted">No submissions yet.</td></tr>'}</tbody></table></div><p class="muted">Showing the latest 100.</p>`;
  $$('[data-del]').forEach(b => b.onclick = async e => { e.stopPropagation(); await ok(sb.from('form_submissions').delete().eq('id', b.dataset.del)); tabLog(f); });
  $$('tr[data-cid]').forEach(r => { if (r.dataset.cid) { r.style.cursor = 'pointer'; r.onclick = () => openContact(r.dataset.cid); } });
}

function formCard(a) {
  const d = a.data || {};
  return `<div class="fcard"><div class="fh"><span class="badge">Form · ${esc(d.form_name)}</span><small>${new Date(a.created_at).toLocaleString()}</small></div>
    ${(d.answers || []).map(x => `<div class="qa"><span>${esc(x.label)}</span><div>${esc(x.value)}</div></div>`).join('')}
    <div class="pills">${d.consent_at ? `<span class="pill accepted" title="${esc(d.consent_text)}">✓ Consent ${new Date(d.consent_at).toLocaleString()}</span>` : ''}
    ${Object.entries(d.utm || {}).map(([k, v]) => `<span class="pill">${esc(k)}=${esc(v)}</span>`).join('')}</div></div>`;
}

const ext = window.CRM_EXT;
ext.views.forms = viewForms;
ext.titles.forms = 'Lead Forms';
ext.cards.form_submission = formCard;
ext.onMerge.push(async (keep, gone) => {
  const { error } = await sb.from('form_submissions').update({ contact_id: keep }).in('contact_id', gone);
  if (error && !/find the table|does not exist/i.test(error.message)) { toast(error.message); throw error; }
});
const nav = document.getElementById('railNav');
if (nav && !nav.querySelector('[data-v="forms"]')) {
  const b = document.createElement('button');
  b.type = 'button'; b.dataset.v = 'forms'; b.dataset.tip = 'Lead Forms'; b.setAttribute('aria-label', 'Lead Forms'); b.style.setProperty('--ri', '2');
  b.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8"/></svg><span>Lead Forms</span>';
  const after = nav.querySelector('[data-v="contacts"]'); if (after) after.after(b); else nav.append(b);
}
})();
