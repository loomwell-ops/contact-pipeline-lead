/* Module 3a (phase A): send one email to one contact from the contact panel.
   Add-on only: no changes to app.js. It takes over the "Email" button (which was a plain mailto: link)
   and calls the send-email Edge Function with the logged-in operator's session.
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

  function compose(c) {
    const blocked = BLOCKED.includes(c.email_status || 'none');
    const canMarket = c.email_status === 'subscribed';
    modal(`
      <h2>Email ${esc(cname(c))}</h2>
      <label>To<input value="${esc(c.email)}" readonly aria-readonly="true"></label>
      <label>Type
        <select id="em_kind">
          <option value="transactional">One-to-one message</option>
          <option value="marketing" ${canMarket ? '' : 'disabled'}>Marketing${canMarket ? '' : ' (needs Subscribed status)'}</option>
        </select>
      </label>
      <label>Subject<input id="em_subject" maxlength="200" autocomplete="off"></label>
      <label>Message<textarea id="em_body" rows="9" maxlength="20000" style="resize:vertical"></textarea></label>
      <p class="muted" style="font-size:12.5px;margin:6px 0 12px">Your postal address and an unsubscribe link are added to the bottom automatically.</p>
      <p id="em_err" role="alert" style="color:var(--bad,#d64545);font-size:13.5px;margin:0 0 10px" ${blocked ? '' : 'hidden'}>${blocked ? 'This address has opted out or cannot be reached, so it cannot be emailed.' : ''}</p>
      <div class="row" style="display:flex;gap:8px">
        <button class="pri" id="em_send" type="button" ${blocked ? 'disabled' : ''}>Send email</button>
        <button id="em_cancel" type="button">Cancel</button>
      </div>`);
    const $s = $('#em_subject'), $b = $('#em_body'), $k = $('#em_kind'), $btn = $('#em_send'), $e = $('#em_err');
    $s.focus();
    $('#em_cancel').onclick = () => closeModal();

    const fail = msg => { $e.textContent = msg; $e.hidden = false; $btn.disabled = false; $btn.textContent = 'Send email'; };
    const send = async () => {
      if ($btn.disabled) return;
      const subject = $s.value.trim(), body = $b.value.trim();
      if (!subject) { $e.hidden = false; $e.textContent = 'Write a subject first.'; return $s.focus(); }
      if (!body) { $e.hidden = false; $e.textContent = 'Write a message first.'; return $b.focus(); }
      $e.hidden = true; $btn.disabled = true; $btn.textContent = SENDING;
      let res;
      try {
        const { data, error } = await sb.functions.invoke('send-email', { body: { contact_id: c.id, kind: $k.value, subject, body } });
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
