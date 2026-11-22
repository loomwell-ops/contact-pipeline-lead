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
// Hooks for add-on modules (mod-*.js): extra views, page titles, timeline cards by activity type, and a merge callback.
const EXT = window.CRM_EXT = { views: {}, titles: {}, cards: {}, onMerge: [] };
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

// ---------- collapsible rail (desktop) ----------
const reduced = () => matchMedia('(prefers-reduced-motion:reduce)').matches;
let tagPos = null;
function moveTagPill(animate) { // same leading/trailing-edge stretch as the rail pill
  const a = $('.tag-pill.on'), p = $('#tagPill'); if (!a || !p) return;
  const x = a.offsetLeft, y = a.offsetTop, w = a.offsetWidth, h = a.offsetHeight, from = tagPos;
  tagPos = { x, y, w };
  p.getAnimations().forEach(n => n.cancel());
  p.style.width = w + 'px'; p.style.height = h + 'px'; p.style.transform = `translate(${x}px, ${y}px)`;
  if (animate !== true || !from || (from.x === x && from.y === y) || reduced()) return;
  if (from.y !== y) return void p.animate([{ transform: `translate(${from.x}px, ${from.y}px)`, width: from.w + 'px' }, { transform: `translate(${x}px, ${y}px)`, width: w + 'px' }], { duration: 260, easing: 'cubic-bezier(.22,1,.36,1)' });
  const sx = Math.min(x, from.x), sw = Math.max(x + w, from.x + from.w) - sx;
  p.animate([
    { transform: `translate(${from.x}px, ${y}px)`, width: from.w + 'px', easing: 'cubic-bezier(.2,.9,.3,1)' },
    { transform: `translate(${sx}px, ${y}px)`, width: sw + 'px', offset: .38, easing: 'cubic-bezier(.34,1.45,.64,1)' },
    { transform: `translate(${x}px, ${y}px)`, width: w + 'px' }
  ], { duration: 440 });
}
window.addEventListener('resize', () => moveTagPill());
function setRail(open, persist) {
  const t = $('#railToggle');
  $('#app').classList.toggle('rail-open', open);
  t.setAttribute('aria-expanded', open); t.setAttribute('aria-label', open ? 'Collapse sidebar' : 'Expand sidebar'); t.dataset.tip = open ? 'Collapse' : 'Expand';
  if (!persist) return;
  try { localStorage.setItem('crm-rail', open ? '1' : '0'); } catch {}
  const t0 = performance.now(); // keep the pill wrapped around the button while the column animates
  (function f() { movePill(); moveTagPill(); if (performance.now() - t0 < 380) requestAnimationFrame(f); })();
}
try { if (localStorage.getItem('crm-rail') === '1') setRail(true, false); } catch {}
$('#railToggle').onclick = () => setRail(!$('#app').classList.contains('rail-open'), true);

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


// ---------- undo toast: the real delete only runs after 6s ----------
let undoT, undoFn = null;
async function flushUndo() { clearTimeout(undoT); const f = undoFn; undoFn = null; if (!f) return; $('#toast').className = ''; try { await f(); } catch { await load(); render(); } }
function undoable(msg, commit, revert) {
  flushUndo();
  const t = $('#toast'); clearTimeout(tt); t.innerHTML = `${esc(msg)} <button type="button" id="undoBtn">Undo</button>`; t.className = 'show good';
  undoFn = commit;
  $('#undoBtn').onclick = () => { clearTimeout(undoT); undoFn = null; t.className = ''; revert(); };
  undoT = setTimeout(flushUndo, 6000);
}
window.addEventListener('pagehide', () => { if (undoFn) undoFn(); });
function download(name, text, type) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['\uFEFF' + text], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const csvQ = v => { let x = String(v ?? ''); if (/^[=+\-@\t\r]/.test(x) && !/^[+-]?[\d\s().-]+$/.test(x)) x = "'" + x; return '"' + x.replace(/"/g, '""') + '"'; };
function exportDeals() {
  const L = [['title', 'contact', 'email', 'value', 'stage', 'status', 'created'].join(',')].concat(S.deals.map(d => { const c = contactById(d.contact_id) || {}; return [d.title, cname(c), c.email, d.value, stageName(d.stage_id), d.status, d.created_at].map(csvQ).join(','); }));
  download('deals-' + new Date().toISOString().slice(0, 10) + '.csv', L.join('\r\n'), 'text/csv');
}
function exportBackup() { download('crm-backup-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify({ exported: new Date().toISOString(), pipeline: S.pipeline, stages: S.stages, contacts: S.contacts, deals: S.deals }, null, 2), 'application/json'); }

// ---------- command palette (Ctrl/Cmd+K) + N for new contact ----------
function openPalette() {
  if ($('#app').hidden || (dirty && !confirm('Discard unsaved changes?'))) return;
  modal('<h2 style="display:none">Search</h2><input id="pq" class="pal-q" placeholder="Jump to a contact, deal or screen…" autocomplete="off"><div id="pr" class="pal-list" role="listbox"></div>', 'pal');
  let items = [], at = 0;
  const go = it => { dirty = false; closeModal(); it.run(); };
  const draw = () => {
    const q = $('#pq').value.trim().toLowerCase(), has = v => (v || '').toLowerCase().includes(q);
    const acts = [['New contact', () => openContact(null)], ['New deal', () => openDeal(null)], ['Go to Pipeline', () => { S.view = 'pipeline'; render(true); }], ['Go to Contacts', () => { S.view = 'contacts'; render(true); }], ['Go to Reports', () => { S.view = 'reports'; render(true); }], ['Go to Settings', () => { S.view = 'settings'; render(true); }]]
      .filter(x => !q || has(x[0])).map(([l, run]) => ({ l, k: 'Action', run }));
    const cs = !q ? [] : S.contacts.filter(c => [cname(c), c.email, c.phone, c.company].some(has)).slice(0, 6)
      .map(c => ({ l: cname(c), k: 'Contact', s: c.company || c.email || '', run: () => { S.q = ''; S.tag = ''; S.view = 'contacts'; S.selectedContact = c.id; render(true); if (!isDesktopSplit()) openContact(c.id); } }));
    const ds = !q ? [] : S.deals.filter(d => has(d.title)).slice(0, 6).map(d => ({ l: d.title, k: 'Deal', s: money(d.value), run: () => { S.view = 'pipeline'; render(true); openDeal(d.id); } }));
    items = [...cs, ...ds, ...acts]; at = Math.min(at, Math.max(0, items.length - 1));
    $('#pr').innerHTML = items.map((it, i) => `<div class="pal-it ${i === at ? 'on' : ''}" role="option" data-i="${i}"><span>${esc(it.l)}${it.s ? ` <small>${esc(it.s)}</small>` : ''}</span><em>${it.k}</em></div>`).join('') || '<p class="muted" style="padding:10px">No matches.</p>';
    $$('.pal-it').forEach(el => el.onclick = () => go(items[+el.dataset.i]));
  };
  $('#pq').oninput = () => { at = 0; draw(); };
  $('#pq').onkeydown = e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); at = (at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % (items.length || 1); draw(); const on = $('.pal-it.on'); if (on) on.scrollIntoView({ block: 'nearest' }); }
    else if (e.key === 'Enter' && items[at]) { e.preventDefault(); go(items[at]); }
  };
  draw();
}
document.addEventListener('keydown', e => {
  if ($('#app').hidden) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); return openPalette(); }
  if (e.key.toLowerCase() === 'n' && !e.ctrlKey && !e.metaKey && !e.altKey && $('#modal').hidden && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) { e.preventDefault(); openContact(null); }
});

// ---------- reports (computed from data already loaded) ----------
function viewReports() {
  $('#viewActions').innerHTML = '<button id="rprint">Print / Save PDF</button>';
  const sum = a => a.reduce((x, d) => x + Number(d.value || 0), 0);
  const won = S.deals.filter(d => d.status === 'won'), lost = S.deals.filter(d => d.status === 'lost'), open = S.deals.filter(d => d.status === 'open');
  const closed = won.length + lost.length, rate = closed ? Math.round(won.length / closed * 100) : 0;
  const bars = items => { const mx = Math.max(1, ...items.map(i => i.v)); return items.length ? `<div class="rp-bars">${items.map(i => `<div class="rp-row"><span class="rp-l">${esc(i.l)}</span><span class="rp-t"><i style="width:${(i.v / mx * 100).toFixed(1)}%"></i></span><b>${esc(i.t)}</b></div>`).join('')}</div>` : '<p class="muted">No data yet.</p>'; };
  const wk = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - (x.getDay() + 6) % 7); return +x; };
  const weeks = Array.from({ length: 8 }, (_, i) => { const d = new Date(wk(Date.now())); d.setDate(d.getDate() - 7 * (7 - i)); return d; });
  const perWeek = weeks.map(d => { const v = S.contacts.filter(c => wk(c.created_at) === +d).length; return { l: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), v, t: String(v) }; });
  const src = {}, bump = k => src[k] || (src[k] = { n: 0, w: 0, c: 0 });
  S.contacts.forEach(c => bump(c.source || 'Unknown').n++);
  S.deals.forEach(d => { const c = contactById(d.contact_id), s = bump((c && c.source) || 'Unknown'); if (d.status === 'won') { s.w++; s.c++; } else if (d.status === 'lost') s.c++; });
  const bySrc = Object.entries(src).sort((x, y) => y[1].n - x[1].n).slice(0, 8).map(([k, s]) => ({ l: k, v: s.c ? s.w / s.c * 100 : 0, t: (s.c ? `${s.w}/${s.c} won (${Math.round(s.w / s.c * 100)}%)` : 'no closed deals') + ` · ${s.n} lead${s.n === 1 ? '' : 's'}` }));
  const withDeals = new Set(S.deals.map(d => d.contact_id)).size, wonC = new Set(won.map(d => d.contact_id)).size;
  const kpi = (l, v, s) => `<div class="kpi"><span>${l}</span><b>${v}</b><small>${s}</small></div>`;
  $('#view').innerHTML = `<div class="summary-bar">${kpi('Open Pipeline', money(sum(open)), open.length + ' open deal(s)')}${kpi('Won Revenue', money(sum(won)), won.length + ' closed won')}${kpi('Win Rate', closed ? rate + '%' : '—', closed + ' closed total')}${kpi('New Leads (7 days)', S.contacts.filter(c => Date.now() - new Date(c.created_at) < 6048e5).length, S.contacts.length + ' contacts total')}</div>
    <div class="rp-grid">
      <section class="settings-card"><h2>Pipeline value by stage</h2>${bars(S.stages.map(s => { const v = sum(S.deals.filter(d => d.stage_id === s.id)); return { l: s.name, v, t: money(v) }; }))}</section>
      <section class="settings-card"><h2>Lead-to-won funnel</h2>${bars([{ l: 'Contacts', v: S.contacts.length, t: String(S.contacts.length) }, { l: 'With a deal', v: withDeals, t: String(withDeals) }, { l: 'Won', v: wonC, t: String(wonC) }])}</section>
      <section class="settings-card"><h2>Win rate by lead source</h2>${bars(bySrc)}</section>
      <section class="settings-card"><h2>New leads per week</h2>${bars(perWeek)}</section>
    </div>`;
  $('#rprint').onclick = () => print();
}

// ---------- pipeline filters, pipeline switching ----------
const PF = { q: '', st: '', min: '' };
function applyPF() { const q = PF.q.toLowerCase(), min = Number(PF.min) || 0; $$('#view .card').forEach(el => { el.hidden = !!((q && !el.dataset.t.includes(q)) || (PF.st && el.dataset.s !== PF.st) || Number(el.dataset.v) < min); }); }
async function switchPipeline(id) {
  const p = S.pipelines.find(x => x.id === id); if (!p || p.id === S.pipeline.id) return;
  S.pipeline = p; try { localStorage.setItem('crm-pipeline', id); } catch {}
  await load(); render();
}

// ---------- bulk actions ----------
const SEL = new Set();
function bulkBar() {
  const b = $('#bulk'); if (!b) return;
  SEL.forEach(id => { if (!contactById(id)) SEL.delete(id); });
  const n = SEL.size, all = $('#selAll'), vis = S.vis || [];
  if (all) { all.checked = !!vis.length && vis.every(id => SEL.has(id)); all.indeterminate = !all.checked && vis.some(id => SEL.has(id)); }
  b.hidden = !n; if (!n) return;
  b.innerHTML = `<b>${n} selected</b><button type="button" data-b="tag">Add tag</button><button type="button" data-b="untag">Remove tag</button><button type="button" data-b="exp">Export</button><button type="button" class="danger" data-b="del">Delete</button><button type="button" class="ghost" data-b="clr">Clear</button>`;
  b.onclick = async e => {
    const a = e.target.dataset.b; if (!a) return;
    const ids = [...SEL], list = ids.map(contactById).filter(Boolean);
    if (a === 'exp') return exportCSV(list);
    if (a === 'tag' || a === 'untag') {
      const t = (prompt(a === 'tag' ? 'Tag to add to the selected contacts:' : 'Tag to remove from the selected contacts:') || '').trim(); if (!t) return;
      const res = await track(Promise.all(list.map(c => sb.from('contacts').update({ tags: a === 'tag' ? [...new Set([...(c.tags || []), t])] : (c.tags || []).filter(x => x !== t) }).eq('id', c.id).select().then(r => { if (!r.error && r.data[0]) Object.assign(c, r.data[0]); return r; }))));
      const bad = res.find(r => r.error); toast(bad ? bad.error.message : `Tag ${a === 'tag' ? 'added to' : 'removed from'} ${list.length} contact(s)`, !bad);
    } else if (a === 'del') {
      const keepC = S.contacts, keepD = S.deals;
      S.contacts = S.contacts.filter(c => !SEL.has(c.id)); S.deals = S.deals.filter(d => !SEL.has(d.contact_id));
      if (SEL.has(S.selectedContact)) S.selectedContact = null;
      SEL.clear(); render();
      return undoable(`Deleted ${ids.length} contact(s) and their deals and notes.`,
        async () => { for (let i = 0; i < ids.length; i += 100) await ok(sb.from('contacts').delete().in('id', ids.slice(i, i + 100))); },
        () => { S.contacts = keepC; S.deals = keepD; render(); });
    } else SEL.clear();
    render();
  };
}

// ---------- duplicate finder + merge ----------
function openDupes() {
  const groups = new Map(), add = (k, c) => { if (!groups.has(k)) groups.set(k, []); groups.get(k).push(c); };
  S.contacts.forEach(c => { if (c.email) add('e:' + c.email.toLowerCase(), c); const p = (c.phone || '').replace(/\D/g, ''); if (p.length >= 7) add('p:' + p.slice(-9), c); });
  const seen = new Set(), gl = [];
  for (const [k, g] of groups) { if (g.length < 2) continue; const key = g.map(c => c.id).sort().join(); if (seen.has(key)) continue; seen.add(key); gl.push([k[0] === 'e' ? 'email' : 'phone', g]); }
  modal(`<h2>Duplicate contacts</h2>${gl.length ? gl.map(([why, g], i) => `<fieldset class="dupe"><legend>Same ${why}</legend>${g.map((c, j) => `<label class="dupe-r"><input type="radio" name="p${i}" value="${c.id}" ${j ? '' : 'checked'}><b>${esc(cname(c))}</b><small>${esc([c.email, c.phone, c.company].filter(Boolean).join(' · '))}</small></label>`).join('')}<button type="button" class="pri" data-m="${i}">Merge into selected</button></fieldset>`).join('') : '<p class="muted">No duplicates found by email or phone.</p>'}`);
  $$('[data-m]', $('#modal')).forEach(btn => btn.onclick = async () => {
    const g = gl[+btn.dataset.m][1], pid = $(`input[name="p${btn.dataset.m}"]:checked`).value, p = g.find(c => c.id === pid), others = g.filter(c => c.id !== pid), oids = others.map(c => c.id);
    if (!confirm(`Merge ${others.length} contact(s) into ${cname(p)}? Their deals and notes move to ${cname(p)}.`)) return;
    const row = {}; for (const k of ['first_name', 'last_name', 'email', 'phone', 'company', 'source']) if (!p[k]) { const o = others.find(x => x[k]); if (o) row[k] = o[k]; }
    row.tags = [...new Set([p, ...others].flatMap(c => c.tags || []))];
    row.custom_fields = Object.assign({}, ...others.map(c => c.custom_fields || {}).reverse(), p.custom_fields || {});
    try {
      await ok(sb.from('deals').update({ contact_id: pid }).in('contact_id', oids));
      await ok(sb.from('activities').update({ contact_id: pid }).in('contact_id', oids));
      for (const h of EXT.onMerge) await h(pid, oids);
      await ok(sb.from('contacts').delete().in('id', oids));
      await ok(sb.from('contacts').update(row).eq('id', pid));
    } catch { await load(); render(); return; }
    await load(); render(); toast('Contacts merged', true); openDupes();
  });
}

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
  await flushUndo(); manualOut = true; await sb.auth.signOut(); closeModal(); resetState(); show(false);
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
  let p = await ok(sb.from('pipelines').select('*').order('created_at'));
  if (!p.length) {
    p = await ok(sb.from('pipelines').insert({ name: 'Sales Pipeline' }).select());
    await ok(sb.from('stages').insert(C.defaultStages.map((name, position) => ({ pipeline_id: p[0].id, name, position }))));
  }
  S.pipelines = p; let sv = null; try { sv = localStorage.getItem('crm-pipeline'); } catch {}
  S.pipeline = p.find(x => x.id === sv) || p[0];
}
async function load() {
  [S.contacts, S.deals, S.stages] = await Promise.all([
    fetchAll('contacts', 'created_at'), fetchAll('deals', 'created_at'),
    ok(sb.from('stages').select('*').eq('pipeline_id', S.pipeline.id).order('position'))
  ]);
  S.deals = S.deals.filter(d => !d.pipeline_id || d.pipeline_id === S.pipeline.id);
  S.deals.sort((a, b) => a.position - b.position);
  if (S.selectedContact && !contactById(S.selectedContact)) S.selectedContact = null;
}

$('#railNav').addEventListener('click', e => { const b = e.target.closest('button[data-v]'); if (!b) return; if (dirty && !confirm('Discard unsaved changes?')) return; dirty = false; S.view = b.dataset.v; render(true); });   // delegated, so add-on modules can add nav buttons
let enterT;
function startEnter() { const v = $('#view'); clearTimeout(enterT); v.classList.remove('enter'); void v.offsetWidth; v.classList.add('enter'); enterT = setTimeout(() => v.classList.remove('enter'), 1000); }
function indexStagger() { ['.colw', '.card', '#rows tr', '.rp-row'].forEach(s => $$(s, $('#view')).forEach((el, i) => el.style.setProperty('--i', Math.min(i, 12)))); }
function render(nav) {
  $$('#railNav button').forEach(b => { const on = b.dataset.v === S.view; b.classList.toggle('on', on); if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  movePill(nav === true);
  if (nav === true) { startEnter(); SEL.clear(); }
  const titles = { pipeline: 'Pipeline', contacts: 'Contacts', reports: 'Reports', settings: 'Stage Settings', ...EXT.titles };
  $('#viewTitle').textContent = titles[S.view] || '';
  $('#viewActions').innerHTML = '';
  ({ contacts: viewContacts, pipeline: viewBoard, reports: viewReports, settings: viewSettings, ...EXT.views })[S.view]();
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
const cfv = v => typeof v === 'string' ? v : JSON.stringify(v);
const cfRow = (k = '', v = '') => `<div class="cf-row"><input class="cf-k" placeholder="Field" aria-label="Field name" value="${esc(k)}"><input class="cf-v" placeholder="Value" aria-label="Field value" value="${esc(v)}"><button type="button" class="ghost cf-x" aria-label="Remove field">×</button></div>`;
function contactLinks(c) {
  const out = [];
  if (c.email) out.push(`<a class="btn" href="mailto:${esc(c.email)}">Email</a>`);
  if (c.phone) {
    let n = c.phone.replace(/\D/g, ''); if (n.startsWith('0') && /-PH$/i.test(C.locale || '')) n = '63' + n.slice(1);
    out.push(`<a class="btn" href="tel:${esc(c.phone.replace(/[^\d+]/g, ''))}">Call</a>`, `<a class="btn" href="https://wa.me/${n}" target="_blank" rel="noopener">WhatsApp</a>`);
  }
  return out.length ? `<div class="row c-links">${out.join('')}</div>` : '';
}
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
    ${id ? contactLinks(c) : ''}
    <div class="grid">${f('first_name', 'First name')}${f('last_name', 'Last name')}${f('email', 'Email')}${f('phone', 'Phone')}${f('company', 'Company')}${f('source', 'Source')}</div>
    <label>Tags (comma-separated)<input id="f_tags" value="${esc((c.tags || []).join(', '))}"></label>
    <div class="cf"><span class="cf-h">Custom fields</span><div id="cfRows">${Object.entries(c.custom_fields || {}).map(([k, v]) => cfRow(k, cfv(v))).join('')}</div><button type="button" class="ghost" id="cfAdd">+ Add field</button></div>
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
    const cf = {}, orig = c.custom_fields || {};
    for (const r of $$('.cf-row', container)) {
      const k = $('.cf-k', r).value.trim(), v = $('.cf-v', r).value.trim(); if (!k) continue;
      if (k in cf) return toast(`Custom field "${k}" is listed twice.`);
      cf[k] = (k in orig && typeof orig[k] !== 'string' && v === cfv(orig[k])) ? orig[k] : v;
    }
    row.custom_fields = cf;
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
  $('#cfAdd', container).onclick = () => { $('#cfRows', container).insertAdjacentHTML('beforeend', cfRow()); dirty = true; $$('.cf-k', container).pop().focus(); };
  $('#cfRows', container).onclick = e => { const x = e.target.closest('.cf-x'); if (x) { x.parentElement.remove(); dirty = true; } };
  if (!id) return;

  $('#quickDeal', container).onclick = () => openDeal(null, null, id);
  $('#del', container).onclick = async () => {
    const keepC = S.contacts, keepD = S.deals, keepSel = S.selectedContact;
    S.contacts = S.contacts.filter(x => x.id !== id); S.deals = S.deals.filter(x => x.contact_id !== id);
    if (S.selectedContact === id) S.selectedContact = null;
    dirty = false; closeModal(); render();
    undoable(`Deleted ${cname(c)} and their deals and notes.`,
      async () => { const gone = await ok(sb.from('contacts').delete().eq('id', id).select('id')); if (!gone.length) { toast('Could not delete. You may not have permission.'); await load(); render(); } },
      () => { S.contacts = keepC; S.deals = keepD; S.selectedContact = keepSel; render(); });
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
  el.innerHTML = n.map(a => (EXT.cards[a.type] && a.data) ? EXT.cards[a.type](a) : `<div class="note"><small>${new Date(a.created_at).toLocaleString()}</small><p>${esc(a.body)}</p></div>`).join('') || '<p class="muted" style="font-size:13.5px">No notes yet.</p>';
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
    <button id="dupes">Find duplicates</button>
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
        ${tags.length ? `<div class="tag-bar"><div id="tagPill" aria-hidden="true"></div>
          <button type="button" class="tag-pill ${!S.tag ? 'on' : ''}" data-tag="">All (${S.contacts.length})</button>
          ${tags.map(t => `<button type="button" class="tag-pill ${t === S.tag ? 'on' : ''}" data-tag="${esc(t)}">${esc(t)}</button>`).join('')}
        </div>` : ''}
        <div id="bulk" class="bulk" hidden></div>
        <div class="wrap"><table><thead><tr><th scope="col" class="selcol"><input type="checkbox" id="selAll" aria-label="Select all"></th>${[['name', 'Name'], ['email', 'Email'], ['phone', 'Phone'], ['company', 'Company']].map(([k, l]) => `<th scope="col" data-k="${k}"><button type="button" class="th-sort" data-k="${k}">${l}<span aria-hidden="true"></span></button></th>`).join('')}<th scope="col">Tags</th></tr></thead><tbody id="rows"></tbody></table></div>
      </div>
      <aside class="contacts-pane" id="contactPane"></aside>
    </div>`;

  $('#q').oninput = e => { S.q = e.target.value; S.lim = 100; rows(); };
  $$('.th-sort').forEach(b => b.onclick = () => { const k = b.dataset.k; S.sort = S.sort.k !== k ? { k, d: 1 } : S.sort.d === 1 ? { k, d: -1 } : { k: '', d: 1 }; S.lim = 100; rows(); });
  $$('.tag-pill').forEach(b => b.onclick = () => { S.tag = b.dataset.tag; S.lim = 100; $$('.tag-pill').forEach(x => x.classList.toggle('on', x === b)); moveTagPill(true); rows(); });
  tagPos = null; moveTagPill(false);
  $('#add').onclick = () => openContact(null);
  $('#imp').onchange = e => importCSV(e.target.files[0]).finally(() => e.target.value = '');
  $('#exp').onclick = exportCSV; $('#dupes').onclick = openDupes;
  $('#selAll').onchange = e => { (S.vis || []).forEach(id => e.target.checked ? SEL.add(id) : SEL.delete(id)); $$('.rsel').forEach(x => x.checked = e.target.checked); bulkBar(); };
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
  S.vis = list.map(c => c.id); const shown = list.slice(0, S.lim), left = list.length - shown.length;
  $('#rows').innerHTML = shown.map(c => `<tr data-id="${c.id}" tabindex="0" class="${c.id === S.selectedContact ? 'selected' : ''}"><td class="selcol"><input type="checkbox" class="rsel" aria-label="Select contact" ${SEL.has(c.id) ? 'checked' : ''}></td><td><span class="who">${avatar(c)}<b>${esc(cname(c))}</b></span></td><td>${esc(c.email)}</td><td>${esc(c.phone)}</td><td>${esc(c.company)}</td>
    <td>${(c.tags || []).map(t => `<span class="tag">${esc(t)}</span>`).join('')}</td></tr>`).join('')
    || '<tr><td colspan="6" class="muted">No contacts match. Add one or import a CSV.</td></tr>';
  if (left > 0) {
    $('#rows').insertAdjacentHTML('beforeend', `<tr class="more"><td colspan="6"><button type="button" id="moreRows">Show ${Math.min(100, left)} more (${left} not shown)</button></td></tr>`);
    $('#moreRows').onclick = () => { S.lim += 100; rows(); };
  }
  $$('#rows .rsel').forEach(x => { x.onclick = e => e.stopPropagation(); x.onchange = () => { const id = x.closest('tr').dataset.id; if (x.checked) SEL.add(id); else SEL.delete(id); bulkBar(); }; });
  $$('#rows tr[data-id]').forEach(r => {
    r.onclick = () => openContact(r.dataset.id);
    r.onkeydown = e => { if (e.target !== r) return; if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openContact(r.dataset.id); } };
  });
  if (hadFocus) { const t = $('#rows tr.selected'); if (t) t.focus(); }
  bulkBar();
}

// ---------- pipeline board (FR-6, FR-7, FR-8) ----------
function viewBoard() {
  const openDeals = S.deals.filter(d => d.status === 'open');
  const wonDeals = S.deals.filter(d => d.status === 'won');
  const closedCount = wonDeals.length + S.deals.filter(d => d.status === 'lost').length;
  const openVal = openDeals.reduce((a, d) => a + Number(d.value || 0), 0);
  const wonVal = wonDeals.reduce((a, d) => a + Number(d.value || 0), 0);
  const liveTotal = S.stages.filter(s => statusFor(s.name) !== 'lost').reduce((a, s) => a + S.deals.filter(d => d.stage_id === s.id).reduce((x, d) => x + Number(d.value || 0), 0), 0);
  const valued = openDeals.filter(d => Number(d.value) > 0), topId = valued.length > 1 ? valued.reduce((m, d) => Number(d.value) > Number(m.value) ? d : m).id : null;
  const winRate = closedCount ? Math.round((wonDeals.length / closedCount) * 100) + '%' : '—';

  $('#viewActions').innerHTML = `${S.pipelines.length > 1 ? `<select id="pipeSel" aria-label="Pipeline">${S.pipelines.map(p => `<option value="${p.id}" ${p.id === S.pipeline.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>` : ''}<button class="pri" id="adddeal">+ Add deal</button>`;
  $('#view').innerHTML = `
    <div class="summary-bar">
      <div class="kpi gold"><span>Active Pipeline</span><b>${money(openVal)}</b><small>${openDeals.length} open deal(s)</small></div>
      <div class="kpi won"><span>Won Revenue</span><b>${money(wonVal)}</b><small>${wonDeals.length} closed won</small></div>
      <div class="kpi"><span>Win Rate</span><b>${winRate}</b><small>${closedCount} closed total</small></div>
      <div class="kpi"><span>Total Contacts</span><b>${S.contacts.length}</b><small>${S.stages.length} pipeline stages</small></div>
    </div>
    <div class="pf"><input id="pfq" type="search" placeholder="Filter deals by title or contact…" aria-label="Filter deals" value="${esc(PF.q)}"><select id="pfs" aria-label="Status"><option value="">All statuses</option>${['open', 'won', 'lost'].map(x => `<option value="${x}" ${PF.st === x ? 'selected' : ''}>${x[0].toUpperCase() + x.slice(1)}</option>`).join('')}</select><input id="pfm" type="number" min="0" placeholder="Min value" aria-label="Minimum value" value="${esc(PF.min)}"></div>
    <div class="board">${S.stages.map(s => {
      const ds = S.deals.filter(d => d.stage_id === s.id);
      const st = statusFor(s.name);
      const share = st === 'lost' || !liveTotal ? 0 : ds.reduce((a, d) => a + Number(d.value || 0), 0) / liveTotal;
      return `<div class="colw st-${st}">
        <div class="colh"><b>${esc(s.name)} <span class="cnt-badge">${ds.length}</span></b><span class="col-val">${money(ds.reduce((a, d) => a + Number(d.value), 0))}</span></div>
        <div class="share" aria-hidden="true"><i style="--share:${share.toFixed(3)}"></i></div>
        <div class="col" data-stage="${s.id}">${ds.map(d => `<div class="card ${esc(d.status)}${d.id === topId ? ' top-deal' : ''}" data-id="${d.id}" data-s="${esc(d.status)}" data-v="${Number(d.value || 0)}" data-t="${esc((d.title + ' ' + cname(contactById(d.contact_id))).toLowerCase())}" tabindex="0" role="button"><b>${esc(d.title)}${d.id === topId ? '<span class="top-badge">Top</span>' : ''}${d.status !== 'open' ? `<span class="st-badge ${esc(d.status)}"><i></i>${d.status === 'won' ? 'Won' : 'Lost'}</span>` : ''}</b>
          <div class="c-meta"><span class="muted who">${avatar(contactById(d.contact_id))}${esc(cname(contactById(d.contact_id)))}</span><span class="val">${money(d.value)}</span></div></div>`).join('')}</div>
        <button type="button" class="col-add" data-stage-add="${s.id}">+ Add deal</button>
      </div>`;
    }).join('')}</div>`;
  $('#adddeal').onclick = () => openDeal(null);
  if ($('#pipeSel')) $('#pipeSel').onchange = e => switchPipeline(e.target.value);
  $('#pfq').oninput = e => { PF.q = e.target.value; applyPF(); }; $('#pfs').onchange = e => { PF.st = e.target.value; applyPF(); }; $('#pfm').oninput = e => { PF.min = e.target.value; applyPF(); };
  applyPF();
  $$('.col-add').forEach(b => b.onclick = () => openDeal(null, b.dataset.stageAdd));
  $$('.card').forEach(el => { el.onclick = () => openDeal(el.dataset.id); el.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDeal(el.dataset.id); } }; });
  $$('.col').forEach(el => new Sortable(el, {
    group: 'deals', animation: 180, delay: 150, delayOnTouchOnly: true,
    ghostClass: 'card-ghost', dragClass: 'card-drag',
    onMove: evt => { $$('.colw.drop-hover').forEach(x => x.classList.remove('drop-hover')); const w = evt.to.closest('.colw'); if (w) w.classList.add('drop-hover'); },
    onEnd: evt => { $$('.colw.drop-hover').forEach(x => x.classList.remove('drop-hover')); onDrop(evt); }
  }));
  if (lastDroppedId) { const el = $(`.card[data-id="${lastDroppedId}"]`); lastDroppedId = null; if (el) el.classList.add('landed'); }
}
let lastDroppedId = null;
async function onDrop(evt) {
  lastDroppedId = evt.item.dataset.id;
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
    const keep = S.deals;
    S.deals = S.deals.filter(x => x.id !== id); dirty = false; closeModal(); render();
    undoable('Deal deleted.',
      async () => { const gone = await ok(sb.from('deals').delete().eq('id', id).select('id')); if (!gone.length) { toast('Could not delete. You may not have permission.'); await load(); render(); } },
      () => { S.deals = keep; render(); });
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
            <span class="grip" title="Drag to reorder" aria-hidden="true">⠿</span>
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

      <div class="settings-col">
      <div class="settings-card">
        <h2>Pipelines</h2>
        <p class="sub">Rename pipelines or switch which one the board and stages show.</p>
        <div id="pl">${S.pipelines.map(p => `<div class="stage-row"><input value="${esc(p.name)}" aria-label="Pipeline name">${p.id === S.pipeline.id ? '<span class="stage-count">Current</span>' : '<button type="button">Switch</button>'}</div>`).join('')}</div>
        <div class="row" style="margin-top:16px"><input id="npn" placeholder="New pipeline name"><button class="pri" id="npl">+ Add pipeline</button></div>
      </div>

      <div class="settings-card">
        <h2>Workspace &amp; Backup</h2>
        <div class="kv-list">
          <div class="kv-row"><span>Business Name</span><b>${esc(C.businessName)}</b></div>
          <div class="kv-row"><span>Pipeline</span><b>${esc(S.pipeline.name)}</b></div>
          <div class="kv-row"><span>Contacts / Deals</span><b>${S.contacts.length} contacts · ${S.deals.length} deals</b></div>
          <div class="kv-row"><span>Database</span><b><i class="rls-dot" aria-hidden="true"></i>Supabase Postgres (RLS Active)</b></div>
        </div>
        <div class="row" style="margin-top:18px">
          <button id="setExp">Export Contacts CSV</button>
          <label class="btn" style="margin:0">Import CSV<input type="file" id="setImp" accept=".csv,text/csv" hidden></label>
          <button id="setDeals">Export Deals CSV</button>
          <button id="setBak">Full JSON Backup</button>
        </div>
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
  new Sortable($('#stl'), {
    animation: 180, handle: '.grip', ghostClass: 'card-ghost', dragClass: 'card-drag',
    onEnd: async evt => {
      if (evt.oldIndex === evt.newIndex) return;
      const arr = S.stages.slice(); arr.splice(evt.newIndex, 0, arr.splice(evt.oldIndex, 1)[0]);
      S.stages = arr.map((x, p) => ({ ...x, position: p })); viewSettings();
      try { await ok(sb.from('stages').upsert(S.stages)); toast('Stage order saved', true); } catch { await load(); render(); }
    }
  });
  $('#nsb').onclick = async () => {
    const name = $('#ns').value.trim(); if (!name) return toast('Enter a stage name.');
    await ok(sb.from('stages').insert({ pipeline_id: S.pipeline.id, name, position: Math.max(-1, ...S.stages.map(s => s.position)) + 1 }));
    await load(); render();
  };
  $('#setExp').onclick = exportCSV; $('#setDeals').onclick = exportDeals; $('#setBak').onclick = exportBackup;
  $$('#pl .stage-row').forEach((r, i) => {
    const p = S.pipelines[i];
    $('input', r).onchange = async e => { const name = e.target.value.trim(); if (!name) { e.target.value = p.name; return toast('Pipeline name is required.'); } await ok(sb.from('pipelines').update({ name }).eq('id', p.id)); p.name = name; toast('Pipeline renamed', true); };
    const b = $('button', r); if (b) b.onclick = () => switchPipeline(p.id);
  });
  $('#npl').onclick = async () => {
    const name = $('#npn').value.trim(); if (!name) return toast('Enter a pipeline name.');
    const p = await ok(sb.from('pipelines').insert({ name }).select());
    await ok(sb.from('stages').insert(C.defaultStages.map((n, position) => ({ pipeline_id: p[0].id, name: n, position }))));
    S.pipelines.push(p[0]); await switchPipeline(p[0].id); toast('Pipeline created', true);
  };
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
const IMP_FIELDS = [['first_name', 'First name'], ['last_name', 'Last name'], ['name', 'Full name'], ['email', 'Email'], ['phone', 'Phone'], ['company', 'Company'], ['source', 'Source'], ['tags', 'Tags'], ['custom_fields', 'Custom fields (JSON)']];
function mapRow(r, m) {
  const g = f => (f in m ? (r[m[f]] || '').trim().replace(/^'(?=[=+\-@\t\r])/, '') : '');
  let first = g('first_name'), last = g('last_name'); const nm = g('name');
  if (!first && !last && nm) { const p = nm.split(/\s+/); first = p.shift(); last = p.join(' '); }
  let cf = {}; try { cf = JSON.parse(g('custom_fields') || '{}'); if (!cf || typeof cf !== 'object' || Array.isArray(cf)) cf = {}; } catch { cf = {}; }
  return { first_name: first || null, last_name: last || null, email: g('email') || null, phone: g('phone') || null, company: g('company') || null, source: g('source') || null, tags: g('tags').split(/[;,|]/).map(t => t.trim()).filter(Boolean), custom_fields: cf };
}
async function importCSV(file) {
  if (!file) return;
  if (file.size > 5e6) return toast('That file is over 5 MB. Split it and import in parts.');
  const rows = parseCSV((await file.text()).replace(/^\uFEFF/, ''));
  if (rows.length < 2) return toast('That file has no data rows.');
  const map = {};
  rows[0].forEach((h, i) => { const k = h.toLowerCase().replace(/[^a-z0-9]/g, ''); for (const f in ALIAS) if (ALIAS[f].includes(k) && !(f in map)) map[f] = i; });
  const sel = f => `<select data-f="${f}"><option value="">— skip —</option>${rows[0].map((h, i) => `<option value="${i}" ${map[f] === i ? 'selected' : ''}>${esc(h || 'Column ' + (i + 1))}</option>`).join('')}</select>`;
  modal(`<h2>Import ${rows.length - 1} rows</h2><p class="muted" style="font-size:13.5px">Check how each column maps. At least Email or Phone is needed.</p>
    <div class="imp-map">${IMP_FIELDS.map(([f, l]) => `<label>${l}${sel(f)}</label>`).join('')}</div>
    <div class="imp-prev" id="impPrev"></div>
    <label class="chk"><input type="checkbox" id="impUpd"> Update existing contacts with the same email (blank cells never overwrite)</label>
    <div class="row" style="margin-top:14px"><button class="pri" id="impGo">Import</button></div>`);
  const cur = () => { const m = {}; $$('.imp-map select').forEach(s => { if (s.value !== '') m[s.dataset.f] = +s.value; }); return m; };
  const prev = () => { const m = cur(); $('#impPrev').innerHTML = '<b>Preview</b><br>' + rows.slice(1, 4).map(r => { const c = mapRow(r, m); return esc([cname(c), c.email, c.phone, c.company].filter(Boolean).join(' · ')); }).join('<br>'); };
  $$('.imp-map select').forEach(s => s.onchange = prev); prev();
  $('#impGo').onclick = async () => {
    const m = cur(); if (!('email' in m) && !('phone' in m)) return toast('Map an Email or Phone column first.');
    const upd = $('#impUpd').checked; closeModal(); await runImport(rows.slice(1), m, upd);
  };
}
async function runImport(rows, m, upd) {
  const byEmail = new Map(S.contacts.filter(c => c.email).map(c => [c.email.toLowerCase(), c]));
  const seenP = new Set(S.contacts.filter(c => !c.email && c.phone).map(c => c.phone.replace(/\D/g, ''))), fileSeen = new Set();
  const out = [], ups = []; let dup = 0, empty = 0;
  for (const r of rows) {
    const c = mapRow(r, m);
    if (!c.email && !c.phone) { empty++; continue; }
    if (c.email) {
      const em = c.email.toLowerCase(); if (fileSeen.has(em)) { dup++; continue; } fileSeen.add(em);
      const ex = byEmail.get(em);
      if (ex) {
        if (!upd) { dup++; continue; }
        const p = {}; for (const k of ['first_name', 'last_name', 'phone', 'company', 'source']) if (c[k] && c[k] !== ex[k]) p[k] = c[k];
        const tags = [...new Set([...(ex.tags || []), ...c.tags])]; if (tags.length !== (ex.tags || []).length) p.tags = tags;
        const cf = { ...(ex.custom_fields || {}), ...c.custom_fields }; if (JSON.stringify(cf) !== JSON.stringify(ex.custom_fields || {})) p.custom_fields = cf;
        if (Object.keys(p).length) ups.push([ex.id, p]); continue;
      }
    } else { const dp = c.phone.replace(/\D/g, ''); if (seenP.has(dp)) { dup++; continue; } seenP.add(dp); }
    out.push(c);
  }
  let done = 0;
  try {
    for (let i = 0; i < out.length; i += 500) { const part = out.slice(i, i + 500); await ok(sb.from('contacts').insert(part)); done += part.length; }
    for (let i = 0; i < ups.length; i += 20) await Promise.all(ups.slice(i, i + 20).map(([id, p]) => ok(sb.from('contacts').update(p).eq('id', id))));
  } catch { await load(); render(); return toast(`Import stopped after adding ${done} of ${out.length} rows. Fix the file and import again; rows already added are skipped as duplicates.`); }
  await load(); render();
  toast(`Imported ${out.length}${upd ? `, updated ${ups.length}` : ''}. Skipped ${dup} duplicates and ${empty} empty rows.`, true);
}
function exportCSV(list) {
  list = Array.isArray(list) ? list : S.contacts;
  const cols = ['first_name', 'last_name', 'email', 'phone', 'company', 'source', 'tags', 'custom_fields'];
  const q = v => { let x = String(v ?? ''); if (/^[=+\-@\t\r]/.test(x) && !/^[+-]?[\d\s().-]+$/.test(x)) x = "'" + x; return '"' + x.replace(/"/g, '""') + '"'; }; // stops spreadsheet formula injection
  const val = (c, k) => k === 'tags' ? (c.tags || []).join(';') : k === 'custom_fields' ? JSON.stringify(c.custom_fields || {}) : c[k];
  const lines = [cols.join(',')].concat(list.map(c => cols.map(k => q(val(c, k))).join(',')));
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv' }));
  a.download = 'contacts-' + new Date().toISOString().slice(0, 10) + '.csv'; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
