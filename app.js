/* Module 1 CRM: contacts, pipeline, notes. Plain JS, no build step.
   All data goes through Supabase; Row Level Security enforces who may read/write. */
const C = window.CRM_CONFIG;
const sb = supabase.createClient(C.supabaseUrl, C.supabaseAnonKey);
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let fmt; try { fmt = new Intl.NumberFormat(C.locale || undefined, { style: 'currency', currency: C.currency || 'USD', minimumFractionDigits: 0, maximumFractionDigits: 2 }); } catch { fmt = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 2 }); }
const money = n => fmt.format(Number(n || 0));
const S = { contacts: [], stages: [], deals: [], pipeline: null, view: 'pipeline', q: '', tag: '', selectedContact: null, sort: { k: '', d: 1 }, lim: 100 };
let dirty = false, pending = 0, lastFocus = null, manualOut = false;
function resetState() { Object.assign(S, { contacts: [], stages: [], deals: [], pipeline: null, selectedContact: null, q: '', tag: '', sort: { k: '', d: 1 }, lim: 100 }); dirty = false; $('#view').innerHTML = ''; }

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
let pillPos = null;
function movePill(animate) {
  const a = $('#railNav button.on'), p = $('#railPill'); if (!a || !p) return;
  const x = a.offsetLeft, y = a.offsetTop, w = a.offsetWidth, h = a.offsetHeight, from = pillPos;
  pillPos = { x, y };
  p.getAnimations().forEach(n => n.cancel());
  p.style.width = w + 'px'; p.style.height = h + 'px'; p.style.transform = `translate(${x}px, ${y}px)`;
  if (animate !== true || !from || (from.x === x && from.y === y) || matchMedia('(prefers-reduced-motion:reduce)').matches) return;
  // leading edge races ahead (0.22s), trailing edge springs in (0.36s)
  const vert = Math.abs(y - from.y) >= Math.abs(x - from.x), sx = Math.min(x, from.x), sy = Math.min(y, from.y);
  const sw = vert ? w : w + Math.abs(x - from.x), sh = vert ? h + Math.abs(y - from.y) : h;
  p.animate([
    { transform: `translate(${from.x}px, ${from.y}px)`, width: w + 'px', height: h + 'px', easing: 'cubic-bezier(.2,.9,.3,1)' },
    { transform: `translate(${sx}px, ${sy}px)`, width: sw + 'px', height: sh + 'px', offset: .38, easing: 'cubic-bezier(.34,1.45,.64,1)' },
    { transform: `translate(${x}px, ${y}px)`, width: w + 'px', height: h + 'px' }
  ], { duration: 580 });
}
window.addEventListener('resize', movePill);

// ---------- helpers ----------
let tt;
function toast(msg, good) { // FR-12: every failure is visible
  const t = $('#toast'); t.textContent = msg; t.className = 'show' + (good ? ' good' : '');
  clearTimeout(tt); tt = setTimeout(() => t.className = '', 5000);
}
// Tracks in-flight requests: blocks double-clicks while saving and shows a progress cursor
function track(p) { pending++; document.body.classList.add('busy'); return Promise.resolve(p).finally(() => { if (!--pending) document.body.classList.remove('busy'); }); }
document.addEventListener('click', e => { if (pending && e.target.closest('button, .btn, .card, tbody tr')) { e.preventDefault(); e.stopPropagation(); } }, true);
window.addEventListener('unhandledrejection', e => { e.preventDefault(); if (!(e.reason && e.reason.shown)) toast('Something went wrong. Please try again.'); console.error(e.reason); });
async function ok(p) { const { data, error } = await track(p); if (error) { error.shown = true; toast(error.message); throw error; } return data; }
async function cnt(table, col, id) {
  const { count, error } = await track(sb.from(table).select('id', { count: 'exact', head: true }).eq(col, id));
  if (error) { error.shown = true; toast(error.message); throw error; } return count;
}
async function fetchAll(table, order) {
  let out = [], from = 0;
  for (;;) {
    const d = await ok(sb.from(table).select('*').order(order, { ascending: false }).order('id').range(from, from + 999));
    out = out.concat(d); if (d.length < 1000) return out; from += 1000;
  }
}
const cname = c => c ? ([c.first_name, c.last_name].filter(Boolean).join(' ') || c.email || c.phone || 'Unnamed') : 'Unknown';
const PAL = [['#c9c2ff', '#2b2570'], ['#ffc9b5', '#6b2a10'], ['#f3e0a6', '#5a4300'], ['#b7ecd2', '#0f4a31'], ['#c7e0ff', '#17406e']];
function avatar(c) {
  const n = cname(c), ini = (n.match(/[A-Za-z0-9]/g) && n.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase()) || '?';
  let h = 0; for (const ch of String((c && c.id) || n)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const [bg, fg] = PAL[h % PAL.length];
  return `<span class="av" style="background:${bg};color:${fg}" aria-hidden="true">${esc(ini)}</span>`;
}
const contactById = id => S.contacts.find(c => c.id === id);
const stageName = id => (S.stages.find(s => s.id === id) || {}).name || '';
const statusFor = n => { n = (n || '').trim().toLowerCase(); return n === 'won' || n === 'lost' ? n : 'open'; };
const isDesktopSplit = () => window.innerWidth > 1060;

// ---------- auth (FR-1) ----------
function show(on) { $('#login').hidden = on; $('#app').hidden = !on; if (on) requestAnimationFrame(movePill); }
$('#loginForm').onsubmit = async e => {
  e.preventDefault(); const b = $('#loginBtn'); b.disabled = true; b.textContent = 'Logging in…';
  const { error } = await sb.auth.signInWithPassword({ email: $('#email').value.trim(), password: $('#password').value });
  b.disabled = false; b.textContent = 'Log in';
  if (error) return toast(/invalid login/i.test(error.message) ? 'Incorrect email or password.' : error.message);
  start();
};
$('#forgot').onclick = async () => {
  const email = $('#email').value.trim(); if (!email) return toast('Enter your email above, then select Forgot password.');
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
  toast(error ? error.message : 'If that email has an account, a reset link is on its way.', !error);
};
function askNewPassword() {
  modal(`<h2>Set a new password</h2><form id="npForm"><label>New password<input id="np" type="password" minlength="8" autocomplete="new-password" required></label><div class="row" style="margin-top:14px"><button class="pri" type="submit">Save password</button></div></form>`);
  $('#npForm').onsubmit = async e => {
    e.preventDefault();
    const { error } = await sb.auth.updateUser({ password: $('#np').value });
    if (error) return toast(error.message);
    dirty = false; closeModal(); history.replaceState(null, '', location.pathname); toast('Password updated', true); start();
  };
}
$('#logout').onclick = async () => {
  if (dirty && !confirm('Discard unsaved changes and log out?')) return;
  manualOut = true; await sb.auth.signOut(); closeModal(); resetState(); show(false);
};
sb.auth.getSession().then(({ data }) => data.session ? start() : show(false));
sb.auth.onAuthStateChange(ev => {
  if (ev === 'PASSWORD_RECOVERY') return void setTimeout(askNewPassword, 0);
  if (ev !== 'SIGNED_OUT') return;
  const was = !$('#app').hidden; closeModal(); resetState(); show(false);
  if (was && !manualOut) toast('Your session expired. Please log in again.');
  manualOut = false;
});

async function start() {
  show(true);
  try { await setup(); await load(); render(); }
  catch (e) {
    $('#view').innerHTML = '<div class="pane-empty"><h3>Could not load your workspace</h3><p>Check your connection, then try again.</p><button class="pri" id="retry">Try again</button></div>';
    $('#retry').onclick = start;
  }
}

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

$$('#railNav button').forEach(b => b.onclick = () => { if (dirty && !confirm('Discard unsaved changes?')) return; dirty = false; S.view = b.dataset.v; render(true); });
let enterT;
function startEnter() { const v = $('#view'); clearTimeout(enterT); v.classList.remove('enter'); void v.offsetWidth; v.classList.add('enter'); enterT = setTimeout(() => v.classList.remove('enter'), 1000); }
function indexStagger() { ['.colw', '.card', '#rows tr'].forEach(s => $$(s, $('#view')).forEach((el, i) => el.style.setProperty('--i', Math.min(i, 12)))); }
function render(nav) {
  $$('#railNav button').forEach(b => { const on = b.dataset.v === S.view; b.classList.toggle('on', on); if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  movePill(nav === true);
  if (nav === true) startEnter();
  const titles = { pipeline: 'Pipeline', contacts: 'Contacts', settings: 'Stage Settings' };
  $('#viewTitle').textContent = titles[S.view] || '';
  $('#viewActions').innerHTML = '';
  ({ contacts: viewContacts, pipeline: viewBoard, settings: viewSettings })[S.view]();
  if (nav === true) indexStagger();
}

// ---------- modal & slide-over drawer ----------
function modal(html, cls = '') {
  const m = $('#modal');
  if (m.hidden) lastFocus = document.activeElement;
  dirty = false;
  m.innerHTML = `<div class="box ${cls}" role="dialog" aria-modal="true" aria-label="${cls === 'side' ? 'Contact details' : 'Dialog'}"><button class="x" id="mx" type="button" aria-label="Close">×</button>${html}</div>`;
  m.hidden = false;
  const h = $('h2', m); if (h) { h.id = 'mtitle'; $('.box', m).setAttribute('aria-labelledby', 'mtitle'); }
  $('#mx').onclick = requestClose; m.onclick = e => { if (e.target === m) requestClose(); };
  m.oninput = () => { dirty = $$('input,textarea', m).some(el => el.value !== el.defaultValue); };
  ($('input,select,textarea', m) || $('#mx')).focus();
}
function closeModal() { const m = $('#modal'); m.hidden = true; m.innerHTML = ''; m.oninput = null; if (lastFocus && document.contains(lastFocus)) lastFocus.focus(); lastFocus = null; }
function requestClose() { if (dirty && !confirm('Discard unsaved changes?')) return; dirty = false; closeModal(); }
document.addEventListener('keydown', e => {
  const m = $('#modal'); if (m.hidden) return;
  if (e.key === 'Escape') return requestClose();
  if (e.key !== 'Tab') return;
  const f = $$('button:not([disabled]),input:not([disabled]),select,textarea', m).filter(el => el.offsetParent !== null);
  if (!f.length) return;
  const a = f[0], z = f[f.length - 1], out = !m.contains(document.activeElement);
  if (e.shiftKey && (document.activeElement === a || out)) { e.preventDefault(); z.focus(); }
  else if (!e.shiftKey && (document.activeElement === z || out)) { e.preventDefault(); a.focus(); }
});

// ---------- shared contact inspector (works in split-pane OR modal drawer) ----------
function mountContactEditor(container, id, isInline) {
  const c = id ? contactById(id) : {};
  dirty = false;
  container.oninput = () => { dirty = $$('input,textarea', container).some(el => el.value !== el.defaultValue); };
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
      <textarea id="note" rows="2" placeholder="Write a note… (Ctrl+Enter to add)"></textarea>
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
    if (row.email && S.contacts.some(x => x.id !== id && (x.email || '').toLowerCase() === row.email.toLowerCase())) return toast('A contact with that email already exists.');
    try { const cf = JSON.parse($('#f_cf', container).value || '{}'); if (!cf || typeof cf !== 'object' || Array.isArray(cf)) throw 0; row.custom_fields = cf; }
    catch { return toast('Custom fields must be a JSON object, for example {"city":"Manila"}.'); }
    const saved = await ok(id ? sb.from('contacts').update(row).eq('id', id).select() : sb.from('contacts').insert(row).select());
    if (!saved.length) return toast('Could not save. You may not have permission.');
    dirty = false; S.selectedContact = saved[0].id;
    const draft = id ? ($('#note', container) || {}).value : '';
    const i = S.contacts.findIndex(x => x.id === saved[0].id);
    if (i >= 0) S.contacts[i] = saved[0]; else S.contacts.unshift(saved[0]);
    toast('Contact saved', true);
    if (!id) { if (!isInline) closeModal(); render(); if (!isInline) openContact(saved[0].id); return; }
    render(); // refreshes list, KPIs and tags (behind the drawer when in modal mode)
    if (isInline) { const n = $('#note', $('#contactPane')); if (n && draft) n.value = draft; }
    else { const h = $('h2', container); if (h) h.textContent = cname(saved[0]); }
  };
  if (!id) return;

  $('#quickDeal', container).onclick = () => openDeal(null, null, id);
  $('#del', container).onclick = async () => {
    const [d, n] = await Promise.all([cnt('deals', 'contact_id', id), cnt('activities', 'contact_id', id)]);
    if (!confirm(`Delete ${cname(c)}? This also removes ${d} deal(s) and ${n} note(s).`)) return;
    const gone = await ok(sb.from('contacts').delete().eq('id', id).select('id'));
    if (!gone.length) return toast('Could not delete. You may not have permission.');
    S.contacts = S.contacts.filter(x => x.id !== id); S.deals = S.deals.filter(x => x.contact_id !== id);
    if (S.selectedContact === id) S.selectedContact = null;
    dirty = false; closeModal(); render(); toast('Contact deleted', true);
  };
  $('#cdeals', container).innerHTML = S.deals.filter(d => d.contact_id === id).map(d =>
    `<div class="mini" data-d="${d.id}"><b>${esc(d.title)}</b> · ${money(d.value)} · ${esc(stageName(d.stage_id))} (${esc(d.status)})</div>`).join('') || '<p class="muted" style="font-size:13.5px;margin:4px 0">No deals linked yet.</p>';
  $$('#cdeals .mini', container).forEach(el => el.onclick = () => openDeal(el.dataset.d));
  $('#addnote', container).onclick = async () => {
    const body = $('#note', container).value.trim(); if (!body) return toast('Write something first.');
    await ok(sb.from('activities').insert({ contact_id: id, type: 'note', body }));
    $('#note', container).value = '';
    container.oninput();
    loadNotes(id, container);
  };
  $('#note', container).onkeydown = e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); $('#addnote', container).click(); } };
  loadNotes(id, container);
}

async function loadNotes(id, root = document) {
  const n = await ok(sb.from('activities').select('*').eq('contact_id', id).order('created_at', { ascending: false }));
  const el = $('#notes', root); if (!el) return;
  el.innerHTML = n.map(a => `<div class="note"><small>${new Date(a.created_at).toLocaleString()}</small><p>${esc(a.body)}</p></div>`).join('') || '<p class="muted" style="font-size:13.5px">No notes yet.</p>';
}

function openContact(id) {
  if (dirty && !confirm('Discard unsaved changes?')) return;
  dirty = false;
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
  if (S.tag && !tags.includes(S.tag)) S.tag = '';
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
        <div class="wrap"><table><thead><tr>${[['name', 'Name'], ['email', 'Email'], ['phone', 'Phone'], ['company', 'Company']].map(([k, l]) => `<th scope="col" data-k="${k}"><button type="button" class="th-sort" data-k="${k}">${l}<span aria-hidden="true"></span></button></th>`).join('')}<th scope="col">Tags</th></tr></thead><tbody id="rows"></tbody></table></div>
      </div>
      <aside class="contacts-pane" id="contactPane"></aside>
    </div>`;

  $('#q').oninput = e => { S.q = e.target.value; S.lim = 100; rows(); };
  $$('.th-sort').forEach(b => b.onclick = () => { const k = b.dataset.k; S.sort = S.sort.k !== k ? { k, d: 1 } : S.sort.d === 1 ? { k, d: -1 } : { k: '', d: 1 }; S.lim = 100; rows(); });
  $$('.tag-pill').forEach(b => b.onclick = () => { S.tag = b.dataset.tag; S.lim = 100; viewContacts(); });
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
  const q = S.q.toLowerCase(), ae = document.activeElement, hadFocus = ae && ae.matches && ae.matches('#rows tr[data-id]');
  const list = S.contacts.filter(c => (!S.tag || (c.tags || []).includes(S.tag)) &&
    (!q || [cname(c), c.email, c.phone, c.company].some(v => (v || '').toLowerCase().includes(q))));
  if (S.sort.k) {
    const g = c => S.sort.k === 'name' ? cname(c) : (c[S.sort.k] || '');
    list.sort((a, b) => g(a).localeCompare(g(b), undefined, { sensitivity: 'base', numeric: true }) * S.sort.d);
  }
  $$('#view th[data-k]').forEach(th => {
    const on = th.dataset.k === S.sort.k;
    th.setAttribute('aria-sort', on ? (S.sort.d > 0 ? 'ascending' : 'descending') : 'none');
    $('span', th).textContent = on ? (S.sort.d > 0 ? ' ▲' : ' ▼') : '';
  });
  const shown = list.slice(0, S.lim), left = list.length - shown.length;
  $('#rows').innerHTML = shown.map(c => `<tr data-id="${c.id}" tabindex="0" class="${c.id === S.selectedContact ? 'selected' : ''}"><td><span class="who">${avatar(c)}<b>${esc(cname(c))}</b></span></td><td>${esc(c.email)}</td><td>${esc(c.phone)}</td><td>${esc(c.company)}</td>
    <td>${(c.tags || []).map(t => `<span class="tag">${esc(t)}</span>`).join('')}</td></tr>`).join('')
    || '<tr><td colspan="5" class="muted">No contacts match. Add one or import a CSV.</td></tr>';
  if (left > 0) {
    $('#rows').insertAdjacentHTML('beforeend', `<tr class="more"><td colspan="5"><button type="button" id="moreRows">Show ${Math.min(100, left)} more (${left} not shown)</button></td></tr>`);
    $('#moreRows').onclick = () => { S.lim += 100; rows(); };
  }
  $$('#rows tr[data-id]').forEach(r => {
    r.onclick = () => openContact(r.dataset.id);
    r.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openContact(r.dataset.id); } };
  });
  if (hadFocus) { const t = $('#rows tr.selected'); if (t) t.focus(); }
}

// ---------- pipeline board (FR-6, FR-7, FR-8) ----------
function viewBoard() {
  const openDeals = S.deals.filter(d => d.status === 'open');
  const wonDeals = S.deals.filter(d => d.status === 'won');
  const closedCount = wonDeals.length + S.deals.filter(d => d.status === 'lost').length;
  const openVal = openDeals.reduce((a, d) => a + Number(d.value || 0), 0);
  const wonVal = wonDeals.reduce((a, d) => a + Number(d.value || 0), 0);
  const liveTotal = S.stages.filter(s => statusFor(s.name) !== 'lost').reduce((a, s) => a + S.deals.filter(d => d.stage_id === s.id).reduce((x, d) => x + Number(d.value || 0), 0), 0);
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
      const share = st === 'lost' || !liveTotal ? 0 : ds.reduce((a, d) => a + Number(d.value || 0), 0) / liveTotal;
      return `<div class="colw st-${st}">
        <div class="colh"><b>${esc(s.name)} <span class="cnt-badge">${ds.length}</span></b><span class="col-val">${money(ds.reduce((a, d) => a + Number(d.value), 0))}</span></div>
        <div class="share" aria-hidden="true"><i style="--share:${share.toFixed(3)}"></i></div>
        <div class="col" data-stage="${s.id}">${ds.map(d => `<div class="card ${esc(d.status)}" data-id="${d.id}" tabindex="0" role="button"><b>${esc(d.title)}${d.status !== 'open' ? `<span class="st-badge ${esc(d.status)}"><i></i>${d.status === 'won' ? 'Won' : 'Lost'}</span>` : ''}</b>
          <div class="c-meta"><span class="muted who">${avatar(contactById(d.contact_id))}${esc(cname(contactById(d.contact_id)))}</span><span class="val">${money(d.value)}</span></div></div>`).join('')}</div>
        <button type="button" class="col-add" data-stage-add="${s.id}">+ Add deal</button>
      </div>`;
    }).join('')}</div>`;
  $('#adddeal').onclick = () => openDeal(null);
  $$('.col-add').forEach(b => b.onclick = () => openDeal(null, b.dataset.stageAdd));
  $$('.card').forEach(el => { el.onclick = () => openDeal(el.dataset.id); el.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDeal(el.dataset.id); } }; });
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
  const failed = (await track(Promise.all(ups))).find(r => r.error);
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
    <label>Value (${esc(C.currency || 'USD')})<input id="d_v" type="number" min="0" step="any" value="${d.value}"></label>
    <label>Stage<select id="d_s">${opt(S.stages.map(s => [s.id, s.name]), d.stage_id)}</select></label>
    <label>Status<select id="d_st">${opt(['open', 'won', 'lost'].map(x => [x, x]), d.status)}</select></label>
    <div class="row" style="margin-top:14px"><button class="pri" id="dsave">Save deal</button>${id ? '<button class="danger" id="ddel">Delete deal</button>' : ''}</div>`);
  $('#d_s').onchange = () => $('#d_st').value = statusFor(stageName($('#d_s').value));
  $('#dsave').onclick = async () => {
    const title = $('#d_t').value.trim(); if (!title) return toast('Give the deal a title.');
    const sid = $('#d_s').value;
    const row = { contact_id: $('#d_c').value, title, value: Number($('#d_v').value) || 0, stage_id: sid, pipeline_id: S.pipeline.id, status: $('#d_st').value };
    if (!id || d.stage_id !== sid) row.position = Math.max(-1, ...S.deals.filter(x => x.stage_id === sid).map(x => x.position)) + 1;
    const saved = await ok(id ? sb.from('deals').update(row).eq('id', id).select() : sb.from('deals').insert(row).select());
    if (!saved.length) return toast('Could not save. You may not have permission.');
    const k = S.deals.findIndex(x => x.id === saved[0].id);
    if (k >= 0) S.deals[k] = saved[0]; else S.deals.push(saved[0]);
    S.deals.sort((a, b) => a.position - b.position);
    dirty = false; closeModal(); render(); toast('Deal saved', true);
  };
  if (id) $('#ddel').onclick = async () => {
    if (!confirm('Delete this deal?')) return;
    const gone = await ok(sb.from('deals').delete().eq('id', id).select('id'));
    if (!gone.length) return toast('Could not delete. You may not have permission.');
    S.deals = S.deals.filter(x => x.id !== id); dirty = false; closeModal(); render(); toast('Deal deleted', true);
  };
}

// ---------- stage settings (FR-9) ----------
function viewSettings() {
  $('#view').innerHTML = `
    <div class="flow-strip ${$('#view').classList.contains('enter') ? 'play' : ''}" role="img" aria-label="Stage order: ${esc(S.stages.map(s => s.name).join(', '))}">
      <div class="flow-track"><i class="flow-bead"></i></div>
      ${S.stages.map(s => `<span class="flow-chip"><span class="stage-dot ${statusFor(s.name)}"></span>${esc(s.name)}</span>`).join('')}
    </div>
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
        <h2>Workspace &amp; Backup</h2>
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
      const before = statusFor(s.name), after = statusFor(name);
      await ok(sb.from('stages').update({ name }).eq('id', s.id));
      let fixed = 0;
      if (before !== after) { // keep deal status in sync when a stage becomes (or stops being) Won/Lost
        const stale = S.deals.filter(d => d.stage_id === s.id && d.status !== after);
        if (stale.length) { await ok(sb.from('deals').update({ status: after }).eq('stage_id', s.id)); stale.forEach(d => d.status = after); fixed = stale.length; }
      }
      s.name = name; toast(fixed ? `Stage renamed. ${fixed} deal(s) set to ${after}.` : 'Stage renamed', true); viewSettings();
    };
    r.onclick = async e => {
      const a = e.target.dataset.a; if (!a) return;
      if (a === 'del') {
        const n = S.deals.filter(d => d.stage_id === s.id).length;
        if (n) return toast(`"${s.name}" still has ${n} deal(s). Move them to another stage first.`);
        if (!confirm(`Delete stage "${s.name}"?`)) return;
        await ok(sb.from('stages').delete().eq('id', s.id));
      } else {
        const k = i + (a === 'up' ? -1 : 1), arr = S.stages.slice();
        [arr[i], arr[k]] = [arr[k], arr[i]];
        await ok(sb.from('stages').upsert(arr.map((x, p) => ({ ...x, position: p })))); // one request, so the order can't half-update
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
  if (file.size > 5e6) return toast('That file is over 5 MB. Split it and import in parts.');
  const rows = parseCSV((await file.text()).replace(/^\uFEFF/, ''));
  if (rows.length < 2) return toast('That file has no data rows.');
  const map = {};
  rows[0].forEach((h, i) => { const k = h.toLowerCase().replace(/[^a-z0-9]/g, ''); for (const f in ALIAS) if (ALIAS[f].includes(k) && !(f in map)) map[f] = i; });
  if (!('email' in map) && !('phone' in map)) return toast('No email or phone column found in the header row.');
  const g = (r, f) => (f in map ? (r[map[f]] || '').trim().replace(/^'(?=[=+\-@\t\r])/, '') : '');
  const seen = new Set(S.contacts.map(c => (c.email || '').toLowerCase()).filter(Boolean));
  const seenP = new Set(S.contacts.filter(c => !c.email && c.phone).map(c => c.phone.replace(/\D/g, '')));
  const out = []; let dup = 0, empty = 0;
  for (const r of rows.slice(1)) {
    let first = g(r, 'first_name'), last = g(r, 'last_name'); const nm = g(r, 'name');
    if (!first && !last && nm) { const p = nm.split(/\s+/); first = p.shift(); last = p.join(' '); }
    const email = g(r, 'email'), phone = g(r, 'phone');
    if (!email && !phone) { empty++; continue; }
    if (email && seen.has(email.toLowerCase())) { dup++; continue; }
    if (email) seen.add(email.toLowerCase());
    else { const dp = phone.replace(/\D/g, ''); if (seenP.has(dp)) { dup++; continue; } seenP.add(dp); }
    let cf = {}; try { cf = JSON.parse(g(r, 'custom_fields') || '{}'); if (!cf || typeof cf !== 'object' || Array.isArray(cf)) cf = {}; } catch { cf = {}; }
    out.push({
      first_name: first || null, last_name: last || null, email: email || null, phone: phone || null,
      company: g(r, 'company') || null, source: g(r, 'source') || null,
      tags: g(r, 'tags').split(/[;,|]/).map(t => t.trim()).filter(Boolean), custom_fields: cf
    });
  }
  let done = 0;
  try { for (let i = 0; i < out.length; i += 500) { const part = out.slice(i, i + 500); await ok(sb.from('contacts').insert(part)); done += part.length; } }
  catch { await load(); render(); return toast(`Import stopped after ${done} of ${out.length} rows. The rest were not imported. Fix the file and import again; rows already added are skipped as duplicates.`); }
  await load(); render();
  toast(`Imported ${out.length}. Skipped ${dup} duplicates and ${empty} empty rows.`, true);
}
function exportCSV() {
  const cols = ['first_name', 'last_name', 'email', 'phone', 'company', 'source', 'tags', 'custom_fields'];
  const q = v => { let x = String(v ?? ''); if (/^[=+\-@\t\r]/.test(x) && !/^[+-]?[\d\s().-]+$/.test(x)) x = "'" + x; return '"' + x.replace(/"/g, '""') + '"'; }; // stops spreadsheet formula injection
  const val = (c, k) => k === 'tags' ? (c.tags || []).join(';') : k === 'custom_fields' ? JSON.stringify(c.custom_fields || {}) : c[k];
  const lines = [cols.join(',')].concat(S.contacts.map(c => cols.map(k => q(val(c, k))).join(',')));
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv' }));
  a.download = 'contacts-' + new Date().toISOString().slice(0, 10) + '.csv'; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
