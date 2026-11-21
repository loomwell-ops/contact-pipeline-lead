/* Module 1 CRM: contacts, pipeline, notes. Plain JS, no build step.
   All data goes through Supabase; Row Level Security enforces who may read/write. */
const C = window.CRM_CONFIG;
const sb = supabase.createClient(C.supabaseUrl, C.supabaseAnonKey);
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => '$' + Number(n || 0).toLocaleString();
const S = { contacts: [], stages: [], deals: [], pipeline: null, view: 'pipeline', q: '', tag: '', selectedContact: null };

// Apply client branding from config.js
document.title = C.businessName;
document.documentElement.style.setProperty('--brand', C.accent);
$('#brand').textContent = $('#loginBrand').textContent = $('#loginBrandSide').textContent = C.businessName;
$('#brandMark').textContent = C.businessName.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();

// ---------- circular theme toggle (View Transitions API) ----------
function setThemeIcon(t) {
  $('#themeIcon').innerHTML = t === 'dark'
    ? '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>'
    : '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';
}
setThemeIcon(document.documentElement.getAttribute('data-theme'));
$('#themeBtn').onclick = e => {
  const r = document.documentElement;
  const next = r.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  const apply = () => {
    r.setAttribute('data-theme', next);
    setThemeIcon(next);
    try { localStorage.setItem('crm-theme', next); } catch {}
  };
  if (!document.startViewTransition || matchMedia('(prefers-reduced-motion:reduce)').matches) return apply();
  const rect = e.currentTarget.getBoundingClientRect();
  const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
  const end = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  const vt = document.startViewTransition(apply);
  vt.ready.then(() => {
    document.documentElement.animate(
      { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${end}px at ${x}px ${y}px)`] },
      { duration: 480, easing: 'cubic-bezier(.22,1,.36,1)', pseudoElement: '::view-transition-new(root)' }
    );
  });
};

// ---------- offset-safe rail pill ----------
function movePill() {
  const active = $('#railNav button.on'), pill = $('#railPill');
  if (!active || !pill) return;
  pill.style.width = active.offsetWidth + 'px';
  pill.style.height = active.offsetHeight + 'px';
  pill.style.transform = `translate(${active.offsetLeft}px, ${active.offsetTop}px)`;
}
window.addEventListener('resize', movePill);

// ---------- helpers ----------
let tt;
function toast(msg, good) { // FR-12: every failure is visible
  const t = $('#toast'); t.textContent = msg; t.className = 'show' + (good ? ' good' : '');
  clearTimeout(tt); tt = setTimeout(() => t.className = '', 5000);
}
async function ok(p) { const { data, error } = await p; if (error) { toast(error.message); throw error; } return data; }
async function cnt(table, col, id) {
  const { count, error } = await sb.from(table).select('id', { count: 'exact', head: true }).eq(col, id);
  if (error) { toast(error.message); throw error; } return count;
}
async function fetchAll(table, order) {
  let out = [], from = 0;
  for (;;) {
    const d = await ok(sb.from(table).select('*').order(order, { ascending: false }).order('id').range(from, from + 999));
    out = out.concat(d); if (d.length < 1000) return out; from += 1000;
  }
}
const cname = c => c ? ([c.first_name, c.last_name].filter(Boolean).join(' ') || c.email || c.phone || 'Unnamed') : 'Unknown';
const contactById = id => S.contacts.find(c => c.id === id);
const stageName = id => (S.stages.find(s => s.id === id) || {}).name || '';
const statusFor = n => { n = (n || '').trim().toLowerCase(); return n === 'won' || n === 'lost' ? n : 'open'; };
const isDesktopSplit = () => window.innerWidth > 1060;

// ---------- auth (FR-1) ----------
function show(on) { $('#login').hidden = on; $('#app').hidden = !on; if (on) requestAnimationFrame(movePill); }
$('#loginForm').onsubmit = async e => {
  e.preventDefault(); const b = $('#loginBtn'); b.disabled = true;
  const { error } = await sb.auth.signInWithPassword({ email: $('#email').value.trim(), password: $('#password').value });
  b.disabled = false;
  if (error) return toast(error.message);
  start();
};
$('#logout').onclick = async () => { await sb.auth.signOut(); closeModal(); show(false); };
sb.auth.getSession().then(({ data }) => data.session ? start() : show(false));

async function start() { show(true); try { await setup(); await load(); render(); } catch (e) { /* already toasted */ } }

// FR-2: first run creates the default pipeline and stages once
async function setup() {
  let p = await ok(sb.from('pipelines').select('*').order('created_at').limit(1));
  if (!p.length) {
    p = await ok(sb.from('pipelines').insert({ name: 'Sales Pipeline' }).select());
    await ok(sb.from('stages').insert(C.defaultStages.map((name, position) => ({ pipeline_id: p[0].id, name, position }))));
  }
  S.pipeline = p[0];
}
async function load() {
  [S.contacts, S.deals, S.stages] = await Promise.all([
    fetchAll('contacts', 'created_at'), fetchAll('deals', 'created_at'),
    ok(sb.from('stages').select('*').eq('pipeline_id', S.pipeline.id).order('position'))
  ]);
  S.deals.sort((a, b) => a.position - b.position);
  if (S.selectedContact && !contactById(S.selectedContact)) S.selectedContact = null;
}

$$('#railNav button').forEach(b => b.onclick = () => { S.view = b.dataset.v; render(); });
function render() {
  $$('#railNav button').forEach(b => b.classList.toggle('on', b.dataset.v === S.view));
  movePill();
  const titles = { pipeline: 'Pipeline', contacts: 'Contacts', settings: 'Stage Settings' };
  $('#viewTitle').textContent = titles[S.view] || '';
  $('#viewActions').innerHTML = '';
  ({ contacts: viewContacts, pipeline: viewBoard, settings: viewSettings })[S.view]();
}

// ---------- modal & slide-over drawer ----------
function modal(html, cls = '') {
  const m = $('#modal');
  m.innerHTML = `<div class="box ${cls}"><button class="x" id="mx" aria-label="Close">×</button>${html}</div>`;
  m.hidden = false; $('#mx').onclick = closeModal; m.onclick = e => { if (e.target === m) closeModal(); };
}
function closeModal() { $('#modal').hidden = true; $('#modal').innerHTML = ''; }
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

// ---------- shared contact inspector (works in split-pane OR modal drawer) ----------
function mountContactEditor(container, id, isInline) {
  const c = id ? contactById(id) : {};
  const f = (k, label) => `<label>${label}<input id="f_${k}" value="${esc(c[k])}"></label>`;
  container.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px">
      <h2 style="margin:0">${id ? esc(cname(c)) : 'New contact'}</h2>
      ${id ? `<button type="button" class="ghost" id="quickDeal">+ Deal</button>` : ''}
    </div>
    <div class="grid">${f('first_name', 'First name')}${f('last_name', 'Last name')}${f('email', 'Email')}${f('phone', 'Phone')}${f('company', 'Company')}${f('source', 'Source')}</div>
    <label>Tags (comma-separated)<input id="f_tags" value="${esc((c.tags || []).join(', '))}"></label>
    <label>Custom fields (JSON)<textarea id="f_cf" rows="2">${esc(JSON.stringify(c.custom_fields || {}))}</textarea></label>
    <div class="row" style="margin-top:12px">
      <button class="pri" id="save">Save contact</button>
      ${id ? '<button class="danger" id="del">Delete</button>' : ''}
    </div>
    ${id ? `<h3>Deals</h3><div id="cdeals"></div><h3>Notes timeline</h3>
      <textarea id="note" rows="2" placeholder="Write a note…"></textarea>
      <div class="row" style="margin-top:8px"><button id="addnote">Add note</button></div>
      <div id="notes"></div>` : ''}`;

  $('#save', container).onclick = async () => {
    const v = k => $('#f_' + k, container).value.trim() || null;
    const row = {
      first_name: v('first_name'), last_name: v('last_name'), email: v('email'), phone: v('phone'),
      company: v('company'), source: v('source'),
      tags: $('#f_tags', container).value.split(',').map(t => t.trim()).filter(Boolean)
    };
    if (!row.first_name && !row.last_name && !row.email && !row.phone) return toast('Enter at least a name, email or phone.');
    if (row.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(row.email)) return toast('That email address is not valid.');
    try { row.custom_fields = JSON.parse($('#f_cf', container).value || '{}'); } catch { return toast('Custom fields must be valid JSON.'); }
    const saved = await ok(id ? sb.from('contacts').update(row).eq('id', id).select() : sb.from('contacts').insert(row).select());
    S.selectedContact = saved[0].id;
    await load();
    if (!isInline) closeModal();
    render();
    toast('Contact saved', true);
    if (!isInline) openContact(saved[0].id);
  };
  if (!id) return;

  $('#quickDeal', container).onclick = () => openDeal(null, null, id);
  $('#del', container).onclick = async () => {
    const [d, n] = await Promise.all([cnt('deals', 'contact_id', id), cnt('activities', 'contact_id', id)]);
    if (!confirm(`Delete ${cname(c)}? This also removes ${d} deal(s) and ${n} note(s).`)) return;
    await ok(sb.from('contacts').delete().eq('id', id));
    if (S.selectedContact === id) S.selectedContact = null;
    closeModal(); await load(); render(); toast('Contact deleted', true);
  };
  $('#cdeals', container).innerHTML = S.deals.filter(d => d.contact_id === id).map(d =>
    `<div class="mini" data-d="${d.id}"><b>${esc(d.title)}</b> · ${money(d.value)} · ${esc(stageName(d.stage_id))} (${d.status})</div>`).join('') || '<p class="muted" style="font-size:13.5px;margin:4px 0">No deals linked yet.</p>';
  $$('#cdeals .mini', container).forEach(el => el.onclick = () => openDeal(el.dataset.d));
  $('#addnote', container).onclick = async () => {
    const body = $('#note', container).value.trim(); if (!body) return toast('Write something first.');
    await ok(sb.from('activities').insert({ contact_id: id, type: 'note', body }));
    $('#note', container).value = '';
    loadNotes(id, container);
  };
  loadNotes(id, container);
}

async function loadNotes(id, root = document) {
  const n = await ok(sb.from('activities').select('*').eq('contact_id', id).order('created_at', { ascending: false }));
  const el = $('#notes', root); if (!el) return;
  el.innerHTML = n.map(a => `<div class="note"><small>${new Date(a.created_at).toLocaleString()}</small><p>${esc(a.body)}</p></div>`).join('') || '<p class="muted" style="font-size:13.5px">No notes yet.</p>';
}

function openContact(id) {
  if (S.view === 'contacts' && isDesktopSplit() && id) {
    S.selectedContact = id;
    rows();
    const pane = $('#contactPane');
    if (pane) return mountContactEditor(pane, id, true);
  }
  modal('<div id="modalContactMount"></div>', 'side');
  mountContactEditor($('#modalContactMount'), id, false);
}

// ---------- contacts (FR-3, FR-4, FR-5) ----------
function viewContacts() {
  const tags = [...new Set(S.contacts.flatMap(c => c.tags || []))].sort();
  const withDeals = new Set(S.deals.map(d => d.contact_id)).size;
  const sources = new Set(S.contacts.map(c => c.source).filter(Boolean)).size;
  if (!S.selectedContact && S.contacts.length && isDesktopSplit()) S.selectedContact = S.contacts[0].id;

  $('#viewActions').innerHTML = `
    <label class="btn" style="margin:0">Import CSV<input type="file" id="imp" accept=".csv,text/csv" hidden></label>
    <button id="exp">Export CSV</button>
    <button class="pri" id="add">+ Add contact</button>`;

  $('#view').innerHTML = `
    <div class="summary-bar">
      <div class="kpi gold"><span>Total Contacts</span><b>${S.contacts.length}</b><small>Stored in Supabase</small></div>
      <div class="kpi won"><span>With Active/Past Deals</span><b>${withDeals}</b><small>${S.contacts.length ? Math.round((withDeals / S.contacts.length) * 100) : 0}% of database</small></div>
      <div class="kpi"><span>Unique Tags</span><b>${tags.length}</b><small>Click below to filter</small></div>
      <div class="kpi"><span>Lead Sources</span><b>${sources}</b><small>Tracked channels</small></div>
    </div>
    <div class="contacts-shell">
      <div class="contacts-main">
        <div class="bar"><input id="q" placeholder="Search name, email, phone, or company…" value="${esc(S.q)}"></div>
        ${tags.length ? `<div class="tag-bar">
          <button type="button" class="tag-pill ${!S.tag ? 'on' : ''}" data-tag="">All (${S.contacts.length})</button>
          ${tags.map(t => `<button type="button" class="tag-pill ${t === S.tag ? 'on' : ''}" data-tag="${esc(t)}">${esc(t)}</button>`).join('')}
        </div>` : ''}
        <div class="wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Company</th><th>Tags</th></tr></thead><tbody id="rows"></tbody></table></div>
      </div>
      <aside class="contacts-pane" id="contactPane"></aside>
    </div>`;

  $('#q').oninput = e => { S.q = e.target.value; rows(); };
  $$('.tag-pill').forEach(b => b.onclick = () => { S.tag = b.dataset.tag; viewContacts(); });
  $('#add').onclick = () => openContact(null);
  $('#imp').onchange = e => importCSV(e.target.files[0]).finally(() => e.target.value = '');
  $('#exp').onclick = exportCSV;
  rows();

  const pane = $('#contactPane');
  if (S.selectedContact && contactById(S.selectedContact)) {
    mountContactEditor(pane, S.selectedContact, true);
  } else {
    pane.innerHTML = `<div class="pane-empty">
      <div class="icon-circle"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></div>
      <h3>Select a contact</h3>
      <p>Click any row on the left to inspect their details, linked deals, and notes timeline here.</p>
      <button class="pri" id="paneAdd">+ Add your first contact</button>
    </div>`;
    $('#paneAdd', pane).onclick = () => openContact(null);
  }
}
function rows() {
  const q = S.q.toLowerCase();
  const list = S.contacts.filter(c => (!S.tag || (c.tags || []).includes(S.tag)) &&
    (!q || [cname(c), c.email, c.phone, c.company].some(v => (v || '').toLowerCase().includes(q))));
  $('#rows').innerHTML = list.map(c => `<tr data-id="${c.id}" class="${c.id === S.selectedContact ? 'selected' : ''}"><td><b>${esc(cname(c))}</b></td><td>${esc(c.email)}</td><td>${esc(c.phone)}</td><td>${esc(c.company)}</td>
    <td>${(c.tags || []).map(t => `<span class="tag">${esc(t)}</span>`).join('')}</td></tr>`).join('')
    || '<tr><td colspan="5" class="muted">No contacts match. Add one or import a CSV.</td></tr>';
  $$('#rows tr[data-id]').forEach(r => r.onclick = () => openContact(r.dataset.id));
}

// ---------- pipeline board (FR-6, FR-7, FR-8) ----------
function viewBoard() {
  const openDeals = S.deals.filter(d => d.status === 'open');
  const wonDeals = S.deals.filter(d => d.status === 'won');
  const closedCount = wonDeals.length + S.deals.filter(d => d.status === 'lost').length;
  const openVal = openDeals.reduce((a, d) => a + Number(d.value || 0), 0);
  const wonVal = wonDeals.reduce((a, d) => a + Number(d.value || 0), 0);
  const winRate = closedCount ? Math.round((wonDeals.length / closedCount) * 100) + '%' : '—';

  $('#viewActions').innerHTML = `<button class="pri" id="adddeal">+ Add deal</button>`;
  $('#view').innerHTML = `
    <div class="summary-bar">
      <div class="kpi gold"><span>Active Pipeline</span><b>${money(openVal)}</b><small>${openDeals.length} open deal(s)</small></div>
      <div class="kpi won"><span>Won Revenue</span><b>${money(wonVal)}</b><small>${wonDeals.length} closed won</small></div>
      <div class="kpi"><span>Win Rate</span><b>${winRate}</b><small>${closedCount} closed total</small></div>
      <div class="kpi"><span>Total Contacts</span><b>${S.contacts.length}</b><small>${S.stages.length} pipeline stages</small></div>
    </div>
    <div class="board">${S.stages.map(s => {
      const ds = S.deals.filter(d => d.stage_id === s.id);
      const st = statusFor(s.name);
      return `<div class="colw st-${st}">
        <div class="colh"><b>${esc(s.name)} <span class="cnt-badge">${ds.length}</span></b><span class="col-val">${money(ds.reduce((a, d) => a + Number(d.value), 0))}</span></div>
        <div class="col" data-stage="${s.id}">${ds.map(d => `<div class="card ${d.status}" data-id="${d.id}"><b>${esc(d.title)}</b>
          <div class="c-meta"><span class="muted">${esc(cname(contactById(d.contact_id)))}</span><span class="val">${money(d.value)}</span></div></div>`).join('')}</div>
        <button type="button" class="col-add" data-stage-add="${s.id}">+ Add deal</button>
      </div>`;
    }).join('')}</div>`;
  $('#adddeal').onclick = () => openDeal(null);
  $$('.col-add').forEach(b => b.onclick = () => openDeal(null, b.dataset.stageAdd));
  $$('.card').forEach(el => el.onclick = () => openDeal(el.dataset.id));
  $$('.col').forEach(el => new Sortable(el, {
    group: 'deals', animation: 180, delay: 150, delayOnTouchOnly: true,
    ghostClass: 'card-ghost', dragClass: 'card-drag', onEnd: onDrop
  }));
}
async function onDrop(evt) {
  const ups = [];
  for (const col of new Set([evt.from, evt.to])) {
    const st = S.stages.find(s => s.id === col.dataset.stage);
    [...col.children].forEach((el, i) => {
      const d = S.deals.find(x => x.id === el.dataset.id), p = {};
      if (d.stage_id !== st.id) p.stage_id = st.id;
      if (d.position !== i) p.position = i;
      if (el === evt.item && d.status !== statusFor(st.name)) p.status = statusFor(st.name);
      if (Object.keys(p).length) { Object.assign(d, p); ups.push(sb.from('deals').update(p).eq('id', d.id)); }
    });
  }
  const failed = (await Promise.all(ups)).find(r => r.error);
  if (failed) { toast(failed.error.message); await load(); }
  S.deals.sort((a, b) => a.position - b.position); viewBoard();
}
function openDeal(id, defaultStageId = null, defaultContactId = null) {
  if (!S.contacts.length) return toast('Add a contact first, then create a deal for them.');
  const initialStage = defaultStageId || (S.stages[0] || {}).id;
  const d = id ? S.deals.find(x => x.id === id) : { contact_id: defaultContactId || S.contacts[0].id, stage_id: initialStage, status: statusFor(stageName(initialStage)), value: 0 };
  const opt = (arr, sel) => arr.map(([v, l]) => `<option value="${v}" ${v === sel ? 'selected' : ''}>${esc(l)}</option>`).join('');
  modal(`<h2>${id ? 'Edit deal' : 'New deal'}</h2>
    <label>Contact<select id="d_c">${opt(S.contacts.map(c => [c.id, cname(c)]), d.contact_id)}</select></label>
    <label>Title<input id="d_t" placeholder="e.g. Monthly Retainer" value="${esc(d.title)}"></label>
    <label>Value ($)<input id="d_v" type="number" min="0" step="any" value="${d.value}"></label>
    <label>Stage<select id="d_s">${opt(S.stages.map(s => [s.id, s.name]), d.stage_id)}</select></label>
    <label>Status<select id="d_st">${opt(['open', 'won', 'lost'].map(x => [x, x]), d.status)}</select></label>
    <div class="row" style="margin-top:14px"><button class="pri" id="dsave">Save deal</button>${id ? '<button class="danger" id="ddel">Delete deal</button>' : ''}</div>`);
  $('#d_s').onchange = () => $('#d_st').value = statusFor(stageName($('#d_s').value));
  $('#dsave').onclick = async () => {
    const title = $('#d_t').value.trim(); if (!title) return toast('Give the deal a title.');
    const sid = $('#d_s').value;
    const row = { contact_id: $('#d_c').value, title, value: Number($('#d_v').value) || 0, stage_id: sid, pipeline_id: S.pipeline.id, status: $('#d_st').value };
    if (!id || d.stage_id !== sid) row.position = Math.max(-1, ...S.deals.filter(x => x.stage_id === sid).map(x => x.position)) + 1;
    await ok(id ? sb.from('deals').update(row).eq('id', id) : sb.from('deals').insert(row));
    closeModal(); await load(); render(); toast('Deal saved', true);
  };
  if (id) $('#ddel').onclick = async () => {
    if (!confirm('Delete this deal?')) return;
    await ok(sb.from('deals').delete().eq('id', id)); closeModal(); await load(); render(); toast('Deal deleted', true);
  };
}

// ---------- stage settings (FR-9) ----------
function viewSettings() {
  $('#view').innerHTML = `
    <div class="settings-grid">
      <div class="settings-card">
        <h2>Pipeline stages</h2>
        <p class="sub">Rename, reorder, or add columns. Stages named “Won” or “Lost” automatically update deal status.</p>
        <div id="stl">${S.stages.map((s, i) => {
          const count = S.deals.filter(d => d.stage_id === s.id).length;
          const st = statusFor(s.name);
          return `<div class="stage-row">
            <span class="stage-dot ${st}" aria-hidden="true"></span>
            <input value="${esc(s.name)}" aria-label="Stage name">
            <span class="stage-count">${count} deal${count === 1 ? '' : 's'}</span>
            <button data-a="up" ${i ? '' : 'disabled'}>Up</button>
            <button data-a="dn" ${i < S.stages.length - 1 ? '' : 'disabled'}>Down</button>
            <button class="danger" data-a="del">Delete</button>
          </div>`;
        }).join('')}</div>
        <div class="row" style="margin-top:16px"><input id="ns" placeholder="New stage name"><button class="pri" id="nsb">+ Add stage</button></div>
      </div>

      <div class="settings-card">
        <h2>Live stage flow</h2>
        <p class="sub">Current left-to-right order on your board.</p>
        <div class="flow-preview">
          ${S.stages.map(s => `<span class="flow-chip"><span class="stage-dot ${statusFor(s.name)}"></span>${esc(s.name)}</span>`).join('')}
        </div>
        <h3>Workspace &amp; Backup</h3>
        <div class="kv-list">
          <div class="kv-row"><span>Business Name</span><b>${esc(C.businessName)}</b></div>
          <div class="kv-row"><span>Pipeline</span><b>${esc(S.pipeline.name)}</b></div>
          <div class="kv-row"><span>Contacts / Deals</span><b>${S.contacts.length} contacts · ${S.deals.length} deals</b></div>
          <div class="kv-row"><span>Database</span><b>Supabase Postgres (RLS Active)</b></div>
        </div>
        <div class="row" style="margin-top:18px">
          <button id="setExp">Export Contacts CSV</button>
          <label class="btn" style="margin:0">Import CSV<input type="file" id="setImp" accept=".csv,text/csv" hidden></label>
        </div>
      </div>
    </div>`;

  $$('#stl .stage-row').forEach((r, i) => {
    const s = S.stages[i];
    r.querySelector('input').onchange = async e => {
      const name = e.target.value.trim();
      if (!name) { e.target.value = s.name; return toast('Stage name is required.'); }
      await ok(sb.from('stages').update({ name }).eq('id', s.id));
      s.name = name; toast('Stage renamed', true); viewSettings();
    };
    r.onclick = async e => {
      const a = e.target.dataset.a; if (!a) return;
      if (a === 'del') {
        const n = S.deals.filter(d => d.stage_id === s.id).length;
        if (n) return toast(`"${s.name}" still has ${n} deal(s). Move them to another stage first.`);
        if (!confirm(`Delete stage "${s.name}"?`)) return;
        await ok(sb.from('stages').delete().eq('id', s.id));
      } else {
        const o = S.stages[i + (a === 'up' ? -1 : 1)];
        await ok(sb.from('stages').update({ position: o.position }).eq('id', s.id));
        await ok(sb.from('stages').update({ position: s.position }).eq('id', o.id));
      }
      await load(); render();
    };
  });
  $('#nsb').onclick = async () => {
    const name = $('#ns').value.trim(); if (!name) return toast('Enter a stage name.');
    await ok(sb.from('stages').insert({ pipeline_id: S.pipeline.id, name, position: Math.max(-1, ...S.stages.map(s => s.position)) + 1 }));
    await load(); render();
  };
  $('#setExp').onclick = exportCSV;
  $('#setImp').onchange = e => importCSV(e.target.files[0]).finally(() => e.target.value = '');
}

// ---------- CSV (FR-10, FR-11) ----------
const ALIAS = {
  first_name: ['firstname', 'first', 'givenname'], last_name: ['lastname', 'last', 'surname', 'familyname'],
  name: ['name', 'fullname', 'contactname'], email: ['email', 'emailaddress'], phone: ['phone', 'phonenumber', 'mobile', 'mobilephone', 'cell'],
  company: ['company', 'companyname', 'businessname', 'organization'], source: ['source', 'leadsource'], tags: ['tags', 'tag'], custom_fields: ['customfields']
};
function parseCSV(t) {
  const rows = []; let r = [], f = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { r.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; r.push(f); f = ''; rows.push(r); r = []; }
    else f += c;
  }
  if (f !== '' || r.length) { r.push(f); rows.push(r); }
  return rows.filter(r => r.some(x => x.trim()));
}
async function importCSV(file) {
  if (!file) return;
  const rows = parseCSV((await file.text()).replace(/^\uFEFF/, ''));
  if (rows.length < 2) return toast('That file has no data rows.');
  const map = {};
  rows[0].forEach((h, i) => { const k = h.toLowerCase().replace(/[^a-z0-9]/g, ''); for (const f in ALIAS) if (ALIAS[f].includes(k) && !(f in map)) map[f] = i; });
  if (!('email' in map) && !('phone' in map)) return toast('No email or phone column found in the header row.');
  const g = (r, f) => (f in map ? (r[map[f]] || '').trim() : '');
  const seen = new Set(S.contacts.map(c => (c.email || '').toLowerCase()).filter(Boolean));
  const out = []; let dup = 0, empty = 0;
  for (const r of rows.slice(1)) {
    let first = g(r, 'first_name'), last = g(r, 'last_name'); const nm = g(r, 'name');
    if (!first && !last && nm) { const p = nm.split(/\s+/); first = p.shift(); last = p.join(' '); }
    const email = g(r, 'email'), phone = g(r, 'phone');
    if (!email && !phone) { empty++; continue; }
    if (email && seen.has(email.toLowerCase())) { dup++; continue; }
    if (email) seen.add(email.toLowerCase());
    let cf = {}; try { cf = JSON.parse(g(r, 'custom_fields') || '{}'); } catch { /* ignore bad JSON */ }
    out.push({
      first_name: first || null, last_name: last || null, email: email || null, phone: phone || null,
      company: g(r, 'company') || null, source: g(r, 'source') || null,
      tags: g(r, 'tags').split(/[;,|]/).map(t => t.trim()).filter(Boolean), custom_fields: cf
    });
  }
  for (let i = 0; i < out.length; i += 500) await ok(sb.from('contacts').insert(out.slice(i, i + 500)));
  await load(); render();
  toast(`Imported ${out.length}. Skipped ${dup} duplicates and ${empty} empty rows.`, true);
}
function exportCSV() {
  const cols = ['first_name', 'last_name', 'email', 'phone', 'company', 'source', 'tags', 'custom_fields'];
  const q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const val = (c, k) => k === 'tags' ? (c.tags || []).join(';') : k === 'custom_fields' ? JSON.stringify(c.custom_fields || {}) : c[k];
  const lines = [cols.join(',')].concat(S.contacts.map(c => cols.map(k => q(val(c, k))).join(',')));
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv' }));
  a.download = 'contacts-' + new Date().toISOString().slice(0, 10) + '.csv'; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
