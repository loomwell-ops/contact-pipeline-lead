/* Module 3b (phase B): email templates and merge fields.
   Add-on only: no changes to app.js. Gives the compose panel (mod-email-send.js) a template picker,
   a template manager, a merge-field inserter and a live preview. Needs the email_templates table
   and the phase B version of the send-email function (it does the merging, so preview = what is sent).
   To leave it out, remove its <script> line from index.html. Compose then works as in phase A.
   Uses globals from app.js: sb, S, esc, $, $$, toast, modal, closeModal. */
(() => {
  const FIELDS = [
    ['first_name', 'First name', 'there'], ['last_name', 'Last name', ''], ['full_name', 'Full name', 'there'],
    ['company', 'Company', 'your company'], ['email', 'Email', null], ['phone', 'Phone', ''], ['sender_name', 'Your name (from settings)', null],
  ];
  const token = f => f[2] === null ? `{{${f[0]}}}` : `{{${f[0]}|${f[2]}}}`;
  const KINDS = { transactional: 'One-to-one', marketing: 'Marketing' };
  const HINT = 'Merge fields: {{first_name|there}} uses "there" when the contact has no first name. Without a fallback, a missing value blocks the send. ' +
    'Simple HTML works: <b> <i> <u> <a href="https://…"> <p> <ul> <ol> <li> <h2> <h3> <blockquote> <br>. Anything else is shown as plain text.';
  const OK_TAGS = new Set(['DIV', 'P', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'A', 'UL', 'OL', 'LI', 'H2', 'H3', 'BLOCKQUOTE', 'HR', 'SPAN']);
  const bad = 'color:var(--bad,#d64545);font-size:13.5px';
  const T = { list: [], loaded: false, error: '' };

  async function load(force) {
    if (T.loaded && !force) return T.list;
    const { data, error } = await sb.from('email_templates').select('*').order('name');
    if (error) {
      T.error = /find the table|does not exist/i.test(error.message) ? 'Email templates are not set up in the database yet.' : error.message;
      T.list = []; T.loaded = false;
    } else { T.error = ''; T.list = data || []; T.loaded = true; }
    return T.list;
  }

  const fieldOptions = () => '<option value="">Insert field…</option>' + FIELDS.map(f => `<option value="${esc(token(f))}">${esc(f[1])}</option>`).join('');

  function insertAtCursor(el, text) {
    const s = el.selectionStart ?? el.value.length, e = el.selectionEnd ?? s;
    el.value = el.value.slice(0, s) + text + el.value.slice(e);
    el.selectionStart = el.selectionEnd = s + text.length;
    el.focus();
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  async function preview(contactId, subject, body) {
    try {
      const { data, error } = await sb.functions.invoke('send-email', { body: { preview: true, contact_id: contactId, subject, body } });
      if (error) {
        let m = ''; try { const j = await error.context.json(); m = j && j.error; } catch {}
        return { ok: false, error: m || 'Could not reach the email service. Check your connection and try again.' };
      }
      return data;
    } catch { return { ok: false, error: 'Could not reach the email service. Check your connection and try again.' }; }
  }

  function showPreview(box, res) {
    box.hidden = false;
    if (!res || !res.ok) { box.innerHTML = `<p role="alert" style="margin:0;${bad}">${esc((res && res.error) || 'Could not build the preview.')}</p>`; return; }
    const tpl = document.createElement('template');
    tpl.innerHTML = res.html;
    tpl.content.querySelectorAll('*').forEach(n => {
      if (!OK_TAGS.has(n.tagName)) { n.remove(); return; }
      [...n.attributes].forEach(a => { if (!(a.name === 'style' || (n.tagName === 'A' && a.name === 'href'))) n.removeAttribute(a.name); });
    });
    box.innerHTML = `<div style="font-size:13px;margin:0 0 8px"><span class="muted">Subject:</span> <b>${esc(res.subject)}</b></div>` +
      '<div class="em-pv" style="background:#fff;color:#222;border:1px solid var(--line,#d9d9e3);border-radius:8px;padding:12px;max-height:260px;overflow:auto"></div>';
    const pv = $('.em-pv', box);
    pv.appendChild(tpl.content);
    $$('a', pv).forEach(a => { a.removeAttribute('target'); a.onclick = e => e.preventDefault(); });
  }

  function manage(opts = {}) {
    const done = () => { if (opts.onDone) opts.onDone(); else closeModal(); };
    const contacts = S.contacts.filter(c => c.email).slice(0, 200);

    async function showList() {
      await load(true);
      const rows = T.list.map(t => `<div class="row" style="display:flex;gap:8px;align-items:center">
          <div style="flex:1;min-width:0"><b>${esc(t.name)}</b> <small class="muted">· ${esc(KINDS[t.kind] || t.kind)}</small>
          <small class="muted" style="display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(t.subject)}</small></div>
          <button type="button" data-edit="${esc(t.id)}">Edit</button><button type="button" class="ghost" data-del="${esc(t.id)}">Delete</button></div>`).join('');
      modal(`<h2>Email templates</h2>
        ${T.error ? `<p role="alert" style="${bad}">${esc(T.error)}</p>` : ''}
        ${T.list.length ? `<div id="tp_list" style="display:grid;gap:10px;margin:0 0 14px">${rows}</div>`
          : (T.error ? '' : '<p class="muted">No templates yet. Create one to reuse a subject and message, with merge fields like {{first_name|there}}.</p>')}
        <div class="row" style="display:flex;gap:8px"><button class="pri" id="tp_new" type="button" ${T.error ? 'disabled' : ''}>New template</button><button id="tp_done" type="button">${esc(opts.doneLabel || 'Close')}</button></div>`);
      $('#mx').onclick = done;
      $('#tp_done').onclick = done;
      $('#tp_new').onclick = () => edit(null);
      $$('#tp_list [data-edit]').forEach(b => b.onclick = () => edit(T.list.find(t => t.id === b.dataset.edit)));
      $$('#tp_list [data-del]').forEach(b => b.onclick = async () => {
        const t = T.list.find(x => x.id === b.dataset.del);
        if (!t || !confirm(`Delete the template "${t.name}"? Emails already sent keep their history.`)) return;
        const { error } = await sb.from('email_templates').delete().eq('id', t.id);
        if (error) return toast(error.message);
        toast('Template deleted.', true); showList();
      });
    }

    function edit(t) {
      const isNew = !t;
      modal(`<h2>${isNew ? 'New template' : 'Edit template'}</h2>
        <label>Name<input id="tp_name" maxlength="100" value="${esc(t && t.name)}" autocomplete="off"></label>
        <label>Default type
          <select id="tp_kind"><option value="transactional">One-to-one message</option><option value="marketing">Marketing (subscribed contacts only)</option></select>
        </label>
        <label>Subject<input id="tp_subject" maxlength="400" value="${esc(t && t.subject)}" autocomplete="off"></label>
        <label>Message<textarea id="tp_body" rows="10" maxlength="20000" style="resize:vertical">${esc(t && t.body)}</textarea></label>
        <div class="row" style="display:flex;gap:8px;align-items:center;margin:6px 0">
          <select id="tp_fld" aria-label="Insert a merge field">${fieldOptions()}</select>
        </div>
        <p class="muted" style="font-size:12.5px;margin:0 0 12px">${esc(HINT)}</p>
        <div class="row" style="display:flex;gap:8px;align-items:center;margin:0 0 10px">
          <select id="tp_pc" aria-label="Preview with this contact" style="flex:1;min-width:0" ${contacts.length ? '' : 'disabled'}>
            ${contacts.length ? contacts.map(c => `<option value="${esc(c.id)}">${esc([c.first_name, c.last_name].filter(Boolean).join(' ') || c.email)} · ${esc(c.email)}</option>`).join('') : '<option>No contacts with an email yet</option>'}
          </select>
          <button type="button" id="tp_prev" ${contacts.length ? '' : 'disabled'}>Preview</button>
        </div>
        <div id="tp_pv" hidden style="margin:0 0 12px"></div>
        <p id="tp_err" role="alert" hidden style="${bad};margin:0 0 10px"></p>
        <div class="row" style="display:flex;gap:8px"><button class="pri" id="tp_save" type="button">Save template</button><button id="tp_back" type="button">Back</button></div>`);
      const $n = $('#tp_name'), $k = $('#tp_kind'), $s = $('#tp_subject'), $b = $('#tp_body'), $e = $('#tp_err'), $sv = $('#tp_save');
      $k.value = (t && t.kind) || 'transactional';
      const snap = () => [$n.value, $k.value, $s.value, $b.value].join('\u0001'), start = snap();
      let last = $b; $s.addEventListener('focus', () => last = $s); $b.addEventListener('focus', () => last = $b);
      $('#tp_fld').onchange = e => { if (e.target.value) insertAtCursor(last, e.target.value); e.target.value = ''; };
      $('#tp_prev').onclick = async e => {
        const btn = e.currentTarget; btn.disabled = true; btn.textContent = 'Building…';
        const res = await preview($('#tp_pc').value, $s.value, $b.value);
        btn.disabled = false; btn.textContent = 'Preview'; showPreview($('#tp_pv'), res);
      };
      const back = () => { if (snap() !== start && !confirm('Discard your changes to this template?')) return; showList(); };
      $('#mx').onclick = back; $('#tp_back').onclick = back;
      const fail = m => { $e.textContent = m; $e.hidden = false; $sv.disabled = false; $sv.textContent = 'Save template'; };
      $sv.onclick = async () => {
        const row = { name: $n.value.trim(), kind: $k.value, subject: $s.value.trim(), body: $b.value.trim() };
        if (!row.name) { fail('Give the template a name.'); return $n.focus(); }
        if (!row.subject) { fail('Write a subject.'); return $s.focus(); }
        if (!row.body) { fail('Write a message.'); return $b.focus(); }
        $e.hidden = true; $sv.disabled = true; $sv.textContent = 'Saving…';
        const res = isNew
          ? await sb.from('email_templates').insert(row).select()
          : await sb.from('email_templates').update({ ...row, updated_at: new Date().toISOString() }).eq('id', t.id).select();
        if (res.error) return fail(res.error.code === '23505' || /duplicate/i.test(res.error.message) ? 'A template with that name already exists.' : res.error.message);
        if (!res.data || !res.data.length) return fail('Could not save. You may not have permission.');
        toast('Template saved.', true); showList();
      };
    }
    showList();
  }

  window.CRM_EMAIL_TPL = { load, all: () => T.list, fieldOptions, insertAtCursor, preview, showPreview, manage, KINDS, HINT };
})();
