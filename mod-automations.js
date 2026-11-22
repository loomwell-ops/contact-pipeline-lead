/* MODULE 4 (add-on): automations. Rules that act on events (a deal enters a stage, a lead arrives, no reply).
   Plugs into app.js through window.CRM_EXT and never edits Module 1's code.
   Database: module4_automations.sql. Worker: the automation-run Edge Function. Needs Modules 1 to 3.
   Also adds a "Mark as replied" button to the contact panel (it records a "reply" entry on the timeline,
   which stops a pending no-reply nudge). Everything is inside one function, so it adds no globals. */
(() => {
const AM = { rules: [], runs: [], templates: [], settings: { enabled: false, hourly_limit: 20 } };
const TRIGGERS = { stage_entered: 'A deal enters a stage', lead_created: 'A new lead arrives from a form', no_reply: 'No reply after an email' };
const ACTIONS = { send_template: 'Send an email template', add_tag: 'Add a tag', add_note: 'Add a note to the timeline' };
const stageLabel = id => (S.stages.find(s => s.id === id) || {}).name || '(deleted stage)';
const ago = d => new Date(d).toLocaleString();

function describe(r) {
  const when = r.trigger_type === 'stage_entered' ? `a deal enters <b>${esc(stageLabel(r.stage_id))}</b>`
    : r.trigger_type === 'no_reply' ? `a deal in <b>${esc(stageLabel(r.stage_id))}</b> has had no reply for <b>${r.wait_hours} h</b> after an email`
    : 'a new lead arrives from a form';
  const what = r.action_type === 'send_template' ? `send <b>${esc((AM.templates.find(t => t.id === r.template_id) || {}).name || 'a template')}</b>`
    : r.action_type === 'add_tag' ? `add the tag <b>${esc(r.tag)}</b>` : 'add a note';
  return `When ${when}, ${what}.`;
}

async function viewAutomations() {
  const [rules, runs, tpls, st] = await Promise.all([
    ok(sb.from('automation_rules').select('*').order('created_at')),
    ok(sb.from('automation_runs').select('*').order('created_at', { ascending: false }).limit(50)),
    ok(sb.from('email_templates').select('id,name,kind').order('name')),
    ok(sb.from('automation_settings').select('*').eq('id', true).maybeSingle()),
  ]);
  Object.assign(AM, { rules, runs, templates: tpls, settings: st || AM.settings });
  draw();
}

function draw() {
  const s = AM.settings;
  $('#view').innerHTML = `
    <div style="padding:16px;margin-bottom:16px;border:1px solid var(--line);border-radius:18px;background:color-mix(in srgb,var(--surface) 82%,transparent)">
      <label class="chk"><input type="checkbox" id="am_master" ${s.enabled ? 'checked' : ''}> <b>Automations are ${s.enabled ? 'ON' : 'OFF'}</b></label>
      <p class="muted" style="font-size:13px;margin:6px 0 10px">The master switch. While it is off, nothing is queued and nothing is sent, whatever the rules say.
        Automated emails only go to contacts who agreed to email, never to opted-out or suppressed addresses, and they count toward your daily sending limit.</p>
      <label style="max-width:260px">Most automated emails per hour<input type="number" id="am_hourly" min="1" max="1000" value="${s.hourly_limit}"></label>
    </div>
    <div class="row" style="display:flex;gap:8px;align-items:center;margin-bottom:10px"><h3 style="margin:0;flex:1">Rules</h3><button class="pri" id="am_new">New rule</button></div>
    <div id="am_rules">${AM.rules.map(r => `<div class="mini" style="display:flex;gap:12px;align-items:center;margin-bottom:8px">
      <label class="chk" title="Switch this rule on or off"><input type="checkbox" data-on="${r.id}" ${r.enabled ? 'checked' : ''}></label>
      <div style="flex:1;min-width:0"><b>${esc(r.name)}</b><br><small class="muted">${describe(r)}</small></div>
      <button class="sm" data-edit="${r.id}">Edit</button><button class="sm danger" data-del="${r.id}">Delete</button></div>`).join('')
      || '<p class="muted">No rules yet. New rules start switched off, so you can check them before they run.</p>'}</div>
    <div class="row" style="display:flex;gap:8px;align-items:center;margin:22px 0 10px"><h3 style="margin:0;flex:1">Recent activity</h3><button class="sm" id="am_refresh">Refresh</button></div>
    <div class="wrap"><table><thead><tr><th>When</th><th>Rule</th><th>Contact</th><th>Result</th><th>Details</th></tr></thead><tbody>${AM.runs.map(r => {
      const c = S.contacts.find(x => x.id === r.contact_id);
      const cls = r.status === 'done' ? 'accepted' : r.status === 'failed' ? 'spam' : '';
      return `<tr data-cid="${r.contact_id}"><td>${ago(r.created_at)}</td><td>${esc(r.rule_name)}</td><td>${esc(c ? cname(c) : 'Unknown')}</td><td><span class="pill ${cls}">${esc(r.status)}</span></td><td>${esc(r.reason || '')}</td></tr>`;
    }).join('') || '<tr><td colspan="5" class="muted">Nothing has run yet.</td></tr>'}</tbody></table></div>
    <p class="muted" style="font-size:13px">Showing the latest 50. Skipped means a safety rule stopped it on purpose, for example a reply, a cooldown or an opt-out.</p>`;

  $('#am_master').onchange = async e => {
    if (e.target.checked && !confirm('Switch automations ON? Enabled rules will start queuing and sending.')) { e.target.checked = false; return; }
    await ok(sb.from('automation_settings').update({ enabled: e.target.checked }).eq('id', true)); AM.settings.enabled = e.target.checked; draw();
  };
  $('#am_hourly').onchange = async e => {
    const v = Math.max(1, Math.min(1000, parseInt(e.target.value, 10) || 20));
    await ok(sb.from('automation_settings').update({ hourly_limit: v }).eq('id', true)); AM.settings.hourly_limit = v; e.target.value = v; toast('Saved.', true);
  };
  $('#am_new').onclick = () => editRule(null);
  $('#am_refresh').onclick = viewAutomations;
  $$('[data-on]').forEach(el => el.onchange = async () => {
    await ok(sb.from('automation_rules').update({ enabled: el.checked }).eq('id', el.dataset.on)); viewAutomations();
  });
  $$('[data-edit]').forEach(b => b.onclick = () => editRule(AM.rules.find(r => r.id === b.dataset.edit)));
  $$('[data-del]').forEach(b => b.onclick = async () => {
    if (!confirm('Delete this rule? Its past activity stays in the log.')) return;
    await ok(sb.from('automation_rules').delete().eq('id', b.dataset.del)); viewAutomations();
  });
  $$('tr[data-cid]').forEach(r => { r.style.cursor = 'pointer'; r.onclick = () => openContact(r.dataset.cid); });
}

function editRule(r) {
  const d = r || { name: '', trigger_type: 'stage_entered', stage_id: (S.stages[0] || {}).id, wait_hours: 48, action_type: 'send_template', template_id: '', tag: '', note_text: '', cooldown_hours: 24 };
  const opt = (o, sel) => Object.entries(o).map(([k, v]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${esc(v)}</option>`).join('');
  modal(`<h2>${r ? 'Edit rule' : 'New rule'}</h2>
    <label>Name<input id="ar_name" maxlength="100" value="${esc(d.name)}" placeholder="For example: Intro email when contacted"></label>
    <label>When<select id="ar_trig">${opt(TRIGGERS, d.trigger_type)}</select></label>
    <label id="ar_stage_w">Stage<select id="ar_stage">${S.stages.map(s => `<option value="${s.id}" ${s.id === d.stage_id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
    <label id="ar_wait_w">Hours without a reply<input type="number" id="ar_wait" min="1" max="720" value="${d.wait_hours || 48}"></label>
    <label>Then<select id="ar_act">${opt(ACTIONS, d.action_type)}</select></label>
    <label id="ar_tpl_w">Email template<select id="ar_tpl"><option value="">Choose a template</option>${AM.templates.map(t => `<option value="${t.id}" ${t.id === d.template_id ? 'selected' : ''}>${esc(t.name)} (${esc(t.kind)})</option>`).join('')}</select></label>
    <label id="ar_tag_w">Tag<input id="ar_tag" maxlength="40" value="${esc(d.tag)}"></label>
    <label id="ar_note_w">Note<textarea id="ar_note" rows="3" maxlength="500">${esc(d.note_text)}</textarea></label>
    <label id="ar_cd_w">Do not email the same person automatically more than once in (hours)<input type="number" id="ar_cd" min="0" max="720" value="${d.cooldown_hours}"></label>
    <p class="muted" style="font-size:12.5px">${r ? 'Saving a rule restarts its clock: a no-reply rule only counts emails sent after you save.' : 'New rules start switched off. Switch them on from the list when you are ready.'}</p>
    <p id="ar_err" role="alert" style="color:var(--bad,#d64545);font-size:13.5px" hidden></p>
    <div class="row" style="display:flex;gap:8px"><button class="pri" id="ar_save" type="button">Save rule</button><button id="ar_cancel" type="button">Cancel</button></div>`);
  const sync = () => {
    const t = $('#ar_trig').value, a = $('#ar_act').value;
    $('#ar_stage_w').hidden = t === 'lead_created'; $('#ar_wait_w').hidden = t !== 'no_reply';
    $('#ar_tpl_w').hidden = a !== 'send_template'; $('#ar_cd_w').hidden = a !== 'send_template';
    $('#ar_tag_w').hidden = a !== 'add_tag'; $('#ar_note_w').hidden = a !== 'add_note';
  };
  $('#ar_trig').onchange = sync; $('#ar_act').onchange = sync; sync();
  $('#ar_cancel').onclick = closeModal;
  $('#ar_save').onclick = async () => {
    const t = $('#ar_trig').value, a = $('#ar_act').value;
    const row = {
      name: $('#ar_name').value.trim(), trigger_type: t, action_type: a,
      stage_id: t === 'lead_created' ? null : $('#ar_stage').value || null,
      wait_hours: t === 'no_reply' ? parseInt($('#ar_wait').value, 10) || null : null,
      template_id: a === 'send_template' ? $('#ar_tpl').value || null : null,
      tag: a === 'add_tag' ? $('#ar_tag').value.trim() || null : null,
      note_text: a === 'add_note' ? $('#ar_note').value.trim() || null : null,
      cooldown_hours: Math.max(0, Math.min(720, parseInt($('#ar_cd').value, 10) || 0)),
    };
    const bad = !row.name ? 'Give the rule a name.' : (t !== 'lead_created' && !row.stage_id) ? 'Choose a stage.' : (t === 'no_reply' && !row.wait_hours) ? 'Enter how many hours to wait.'
      : (a === 'send_template' && !row.template_id) ? 'Choose an email template.' : (a === 'add_tag' && !row.tag) ? 'Enter a tag.' : (a === 'add_note' && !row.note_text) ? 'Write the note.' : '';
    const e = $('#ar_err'); e.hidden = !bad; e.textContent = bad; if (bad) return;
    await ok(r ? sb.from('automation_rules').update(row).eq('id', r.id) : sb.from('automation_rules').insert({ ...row, enabled: false }));
    closeModal(); viewAutomations();
  };
}

// ---- timeline cards ----
const ext = window.CRM_EXT;
ext.views.automations = viewAutomations;
ext.titles.automations = 'Automations';
ext.cards.automation = a => `<div class="note"><small>${ago(a.created_at)} · Automation${a.data && a.data.rule ? ' · ' + esc(a.data.rule) : ''}</small><p>${esc(a.body)}</p></div>`;
ext.cards.reply = a => `<div class="note"><small>${ago(a.created_at)} · Reply</small><p>${esc(a.body || 'Marked as replied')}</p></div>`;

// ---- "Mark as replied" button in the contact panel (wraps loadNotes; app.js stays untouched) ----
const baseLoadNotes = window.loadNotes;
if (typeof baseLoadNotes === 'function') {
  window.loadNotes = async function (id, root = document) {
    await baseLoadNotes(id, root);
    const el = $('#notes', root);
    if (!el || (el.parentNode && el.parentNode.querySelector('[data-replied]'))) return;
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'sm'; b.dataset.replied = '1'; b.textContent = 'Mark as replied'; b.style.margin = '0 0 10px';
    b.title = 'Records that this person replied. Stops any waiting no-reply nudge.';
    b.onclick = async () => {
      b.disabled = true;
      try { await ok(sb.from('activities').insert({ contact_id: id, type: 'reply', body: 'Marked as replied', data: { kind: 'reply' } })); toast('Marked as replied.', true); }
      finally { b.disabled = false; }
      window.loadNotes(id, root);
    };
    el.insertAdjacentElement('beforebegin', b);
  };
}

// ---- rail button ----
const nav = document.getElementById('railNav');
if (nav && !nav.querySelector('[data-v="automations"]')) {
  const b = document.createElement('button');
  b.type = 'button'; b.dataset.v = 'automations'; b.dataset.tip = 'Automations'; b.setAttribute('aria-label', 'Automations'); b.style.setProperty('--ri', '3');
  b.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 3 14h9l-1 8 10-12h-9z"/></svg><span>Automations</span>';
  const after = nav.querySelector('[data-v="forms"]') || nav.querySelector('[data-v="contacts"]'); if (after) after.after(b); else nav.append(b);
}
})();
