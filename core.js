/* CORE: login, shell, helpers and the module registry. Contains no CRM-specific code.
   Modules (mod-*.js) register themselves; config.js decides which ones are on. */
const C = window.CRM_CONFIG;
const sb = supabase.createClient(C.supabaseUrl, C.supabaseAnonKey);
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
// Escape user text before putting it into innerHTML
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => '$' + Number(n || 0).toLocaleString();
const S = { view: null };   // shared state; each module adds its own keys

document.title = C.businessName;
document.documentElement.style.setProperty('--accent', C.accent);
$('#brand').textContent = $('#loginBrand').textContent = C.businessName;

// ---------- helpers ----------
let tt;
function toast(msg, good) { // FR-12: every failure is visible
  const t = $('#toast'); t.textContent = msg; t.className = 'show' + (good ? ' good' : '');
  clearTimeout(tt); tt = setTimeout(() => t.className = '', 5000);
}
// Await a Supabase call; on error show a toast and throw so nothing fails silently
async function ok(p) { const { data, error } = await p; if (error) { toast(error.message); throw error; } return data; }
async function cnt(table, col, id) {
  const { count, error } = await sb.from(table).select('id', { count: 'exact', head: true }).eq(col, id);
  if (error) { toast(error.message); throw error; } return count;
}
// PostgREST returns at most 1000 rows per request, so page through
async function fetchAll(table, order) {
  let out = [], from = 0;
  for (;;) {
    const d = await ok(sb.from(table).select('*').order(order, { ascending: false }).order('id').range(from, from + 999));
    out = out.concat(d); if (d.length < 1000) return out; from += 1000;
  }
}

// ---------- auth (FR-1) ----------
function show(on) { $('#login').hidden = on; $('#app').hidden = !on; }
$('#loginForm').onsubmit = async e => {
  e.preventDefault(); const b = $('#loginBtn'); b.disabled = true;
  const { error } = await sb.auth.signInWithPassword({ email: $('#email').value.trim(), password: $('#password').value });
  b.disabled = false;
  if (error) return toast(error.message);
  start();
};
$('#logout').onclick = async () => { await sb.auth.signOut(); closeModal(); show(false); };
window.addEventListener('DOMContentLoaded', () => {   // wait until every module script has loaded
  sb.auth.getSession().then(({ data }) => data.session ? start() : show(false));
});

// ---------- module registry ----------
// A module calls CRM.register({ id, needs, views:[{id,title,icon,order,render}], setup, load }).
// CRM.cards lets a module draw its own timeline entries (by activity type) inside another module's panel.
const CRM = { all: [], on: [], views: [], cards: {}, register(m) { this.all.push(m); } };
function resolveModules() {
  const want = C.modules || ['crm', 'forms'];
  CRM.on = want.map(id => CRM.all.find(m => m.id === id)).filter(Boolean)
    .sort((a, b) => (a.needs || []).length - (b.needs || []).length);   // foundations first
  CRM.views = CRM.on.flatMap(m => m.views).sort((a, b) => (a.order || 5) - (b.order || 5));
  return [...want.filter(id => !CRM.all.some(m => m.id === id)).map(id => `Module "${id}" is switched on in config.js but its script file is not loaded in index.html.`),
    ...CRM.on.flatMap(m => (m.needs || []).filter(n => !want.includes(n)).map(n => `Module "${m.id}" needs module "${n}". Add "${n}" to modules in config.js.`))];
}
function buildNav() {
  $('#nav').innerHTML = CRM.views.map(v => `<button data-v="${v.id}" title="${esc(v.title)}" aria-label="${esc(v.title)}"><svg viewBox="0 0 24 24">${v.icon}</svg></button>`).join('');
  $$('#nav button').forEach(b => b.onclick = () => { S.view = b.dataset.v; render(); });
}
async function start() {
  show(true);
  const problems = resolveModules(); buildNav();
  if (problems.length) { $('#view').innerHTML = '<h2>Setup problem</h2>' + problems.map(p => `<p>${esc(p)}</p>`).join(''); return; }
  try {
    for (const m of CRM.on) if (m.setup) await m.setup();                       // e.g. create the default pipeline
    await Promise.all(CRM.on.filter(m => m.load).map(m => m.load()));
    render();
  } catch (e) { /* already shown as a toast */ }
}
function render() {
  const v = CRM.views.find(x => x.id === S.view) || CRM.views[0];
  if (!v) { $('#view').innerHTML = '<p class="muted">No modules are switched on. Check modules in config.js.</p>'; return; }
  S.view = v.id;
  $$('#nav button').forEach(b => b.classList.toggle('on', b.dataset.v === v.id));
  $('#viewTitle').textContent = v.title;
  v.render();
}

// ---------- modal ----------
function modal(html, cls = '') {
  const m = $('#modal');
  m.innerHTML = `<div class="box ${cls}"><button class="x" id="mx" aria-label="Close">×</button>${html}</div>`;
  m.hidden = false; $('#mx').onclick = closeModal; m.onclick = e => { if (e.target === m) closeModal(); };
}
function closeModal() { $('#modal').hidden = true; $('#modal').innerHTML = ''; }
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
