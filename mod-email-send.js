/* Module 3a (phase A + B): send one email to one contact from the contact panel.
   Add-on only: no changes to app.js. It takes over the "Email" button (which was a plain mailto: link)
   and calls the send-email Edge Function with the logged-in operator's session.
   Phase B adds a template picker, merge-field inserter and preview when mod-email-templates.js is loaded
   (it must come BEFORE this file in index.html). Without it, this works exactly as in phase A.
   To leave it out, remove its <script> line from index.html. The Email button goes back to mailto:.
   Uses globals from app.js: sb, S, EXT, esc, $, cname, toast, modal, closeModal, loadNotes, BLOCKED. */
(() => {
  const SENDING = 'Sending…';

  // Timeline card for sent emails (only if another module has not already defined one)
  if (!EXT.cards.email) {
    EXT.cards.email = a => {
      const d = a.data || {}, bad = d.status === 'failed';
      return `<div class="note"><small>${new Date(a.created_at).toLocaleString()} · Email ${bad ? 'failed' : 'sent'}</small>` +
        `<p><b>${esc(d.subject || a.body)}</b>${bad && d.error ? `<br><span class="muted">${esc(d.error)}</span>` : ''}</p></div>`;
    };
  }

  // Find which contact the clicked Email button belongs to
  function contactFor(a) {
    const mail = decodeURIComponent(a.getAttribute('href').replace(/^mailto:/i, '')).trim().toLowerCase();
    const sel = S.contacts.find(c => c.id === S.selectedContact);
    if (sel && (sel.email || '').trim().toLowerCase() === mail) return sel;
    return S.contacts.find(c => (c.email || '').trim().toLowerCase() === mail) || null;
  }

  // The function usually answers 200 with {ok:false,error}; a 401 comes back as an HTTP error, so read both
  async function errorText(error) {
    try { const j = await error.context.json(); if (j && j.error) return j.error; } catch {}
    return 'Could not reach the email service. Check your connection and try again.';
  }

  // draft = { subject, body, kind, tplId } so the panel can be reopened after managing templates
  function compose(c, draft = {}) {
    const TPL = window.CRM_EMAIL_TPL;
    const blocked = BLOCKED.includes(c.email_status || 'none');
    const canMarket = c.email_status === 'subscribed';
    modal(`
      <h2>Email ${esc(cname(c))}</h2>
      <label>To<input value="${esc(c.email)}" readonly aria-readonly="true"></label>
      ${TPL ? `<div class="row" style="display:flex;gap:8px;align-items:flex-end">
        <label style="flex:1;min-width:0">Template<select id="em_tpl"><option value="">No template</option></select></label>
        <button id="em_mng" type="button">Manage</button></div>` : ''}
      <label>Type
        <select id="em_kind">
          <option value="transactional">One-to-one message</option>
          <option value="marketing" ${canMarket ? '' : 'disabled'}>Marketing${canMarket ? '' : ' (needs Subscribed status)'}</option>
        </select>
      </label>
      <label>Subject<input id="em_subject" maxlength="200" autocomplete="off"></label>
      <label>Message<textarea id="em_body" rows="9" maxlength="20000" style="resize:vertical"></textarea></label>
      ${TPL ? `<div class="row" style="display:flex;gap:8px;align-items:center;margin:6px 0">
        <select id="em_fld" aria-label="Insert a merge field">${TPL.fieldOptions()}</select>
        <button id="em_prev" type="button">Preview</button></div>
        <div id="em_pv" hidden style="margin:0 0 10px"></div>` : ''}
      <p class="muted" style="font-size:12.5px;margin:6px 0 12px">Your postal address and an unsubscribe link are added to the bottom automatically.${TPL ? ' Merge fields like {{first_name|there}} and simple HTML (&lt;b&gt;, &lt;a href&gt;, &lt;p&gt;, &lt;ul&gt;&lt;li&gt;) work. Use Preview to check.' : ''}</p>
      <p id="em_err" role="alert" style="color:var(--bad,#d64545);font-size:13.5px;margin:0 0 10px" ${blocked ? '' : 'hidden'}>${blocked ? 'This address has opted out or cannot be reached, so it cannot be emailed.' : ''}</p>
      <div class="row" style="display:flex;gap:8px">
        <button class="pri" id="em_send" type="button" ${blocked ? 'disabled' : ''}>Send email</button>
        <button id="em_cancel" type="button">Cancel</button>
      </div>`);
    const $s = $('#em_subject'), $b = $('#em_body'), $k = $('#em_kind'), $btn = $('#em_send'), $e = $('#em_err');
    $s.value = draft.subject || ''; $b.value = draft.body || '';
    $k.value = draft.kind === 'marketing' && canMarket ? 'marketing' : 'transactional';
    $s.focus();
    $('#em_cancel').onclick = () => closeModal();

    // ---- phase B: templates, merge fields, preview ----
    let tpls = [], tplId = draft.tplId || '', last = $b, guardOn = false;
    if (TPL) {
      const $tpl = $('#em_tpl'), $pv = $('#em_pv'), $pb = $('#em_prev');
      $s.addEventListener('focus', () => last = $s); $b.addEventListener('focus', () => last = $b);

      // A marketing template cannot go to someone who has not subscribed
      const guard = () => {
        if (blocked) return;
        const t = tpls.find(x => x.id === tplId);
        if (t && t.kind === 'marketing' && !canMarket) {
          $e.textContent = 'This is a marketing template and this contact has not subscribed, so it cannot be sent to them.';
          $e.hidden = false; $btn.disabled = true; guardOn = true;
        } else if (guardOn) { guardOn = false; $e.hidden = true; $btn.disabled = false; }
      };
      const doPreview = async () => {
        if (!$s.value.trim() && !$b.value.trim()) return TPL.showPreview($pv, { ok: false, error: 'Write a subject or a message to preview it.' });
        $pb.disabled = true; $pb.textContent = 'Building…';
        const res = await TPL.preview(c.id, $s.value, $b.value);
        $pb.disabled = false; $pb.textContent = 'Preview';
        TPL.showPreview($pv, res);
      };
      $pb.onclick = doPreview;
      $('#em_fld').onchange = e => { if (e.target.value) TPL.insertAtCursor(last, e.target.value); e.target.value = ''; };
      $('#em_mng').onclick = () => {
        const keep = { subject: $s.value, body: $b.value, kind: $k.value, tplId };
        TPL.manage({ contact: c, doneLabel: 'Back to email', onDone: () => compose(c, keep) });
      };
      $tpl.onchange = () => {
        const t = tpls.find(x => x.id === $tpl.value);
        if (t && ($s.value.trim() || $b.value.trim()) && !confirm('Replace what you have written with this template?')) { $tpl.value = tplId; return; }
        tplId = t ? t.id : '';
        if (t) {
          $s.value = t.subject; $b.value = t.body;
          $k.value = t.kind === 'marketing' && canMarket ? 'marketing' : 'transactional';
        }
        guard();
        if (t) doPreview();
      };
      TPL.load().then(list => {
        tpls = list;
        $tpl.innerHTML = '<option value="">No template</option>' +
          tpls.map(t => `<option value="${esc(t.id)}">${esc(t.name)}${t.kind === 'marketing' ? ' (marketing)' : ''}</option>`).join('');
        if (tplId && !tpls.some(t => t.id === tplId)) tplId = '';
        $tpl.value = tplId;
        guard();
      });
    }

    const fail = msg => { $e.textContent = msg; $e.hidden = false; $btn.disabled = false; $btn.textContent = 'Send email'; };
    const send = async () => {
      if ($btn.disabled) return;
      const subject = $s.value.trim(), body = $b.value.trim();
      if (!subject) { $e.hidden = false; $e.textContent = 'Write a subject first.'; return $s.focus(); }
      if (!body) { $e.hidden = false; $e.textContent = 'Write a message first.'; return $b.focus(); }
      $e.hidden = true; $btn.disabled = true; $btn.textContent = SENDING;
      let res;
      try {
        const { data, error } = await sb.functions.invoke('send-email', { body: { contact_id: c.id, kind: $k.value, subject, body, template_id: tplId || undefined } });
        res = error ? { ok: false, error: await errorText(error) } : data;
      } catch { res = { ok: false, error: 'Could not reach the email service. Check your connection and try again.' }; }
      if (res && res.ok) {
        closeModal(); toast('Email sent.', true);
        try { await loadNotes(c.id); } catch {}
      } else fail((res && res.error) || 'Something went wrong. The email was not sent.');
    };
    $btn.onclick = send;
    $b.onkeydown = e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); send(); } };
  }

  // Capture phase so we run before the browser follows the mailto: link
  document.addEventListener('click', e => {
    const a = e.target.closest && e.target.closest('.c-links a[href^="mailto:"]');
    if (!a) return;
    let c; try { c = contactFor(a); } catch { c = null; }
    if (!c || !c.email) return; // unknown contact: let the normal mailto: link work
    e.preventDefault(); e.stopPropagation();
    compose(c);
  }, true);
})();
