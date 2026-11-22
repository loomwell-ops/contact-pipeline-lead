/* MODULE 3a (email readiness): keeps sent-email history safe when contacts are merged and draws
   email entries on a contact's timeline. It sends nothing; sending comes later from an Edge Function.
   Database: module3a_email_readiness.sql. Needs Module 1. */
(() => {
const ext = window.CRM_EXT;
// When duplicate contacts are merged, keep their email log attached to the surviving contact
ext.onMerge.push(async (keep, gone) => {
  const { error } = await sb.from('email_messages').update({ contact_id: keep }).in('contact_id', gone);
  if (error && !/find the table|does not exist/i.test(error.message)) { toast(error.message); throw error; }
});
// Timeline card for activities of type "email" (written by the sending function: data = { subject, status })
ext.cards.email = a => {
  const d = a.data || {};
  return `<div class="fcard"><div class="fh"><span class="badge">Email · ${esc(d.status || 'sent')}</span><small>${new Date(a.created_at).toLocaleString()}</small></div>
    <div class="qa"><span>Subject</span><div>${esc(d.subject || a.body || '')}</div></div></div>`;
};
})();
