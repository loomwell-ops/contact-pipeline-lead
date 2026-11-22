# How the modules fit together

Your Contacts and Pipeline app (`app.js`, `index.html`, `style.css`) is Module 1 and stands on its own.
Add-on modules plug into it with a few small hooks (`window.CRM_EXT` in `app.js`) and never edit Module 1's code.

| Module | Files | Database file | Needs |
|---|---|---|---|
| 1. Contacts, pipeline, reports | `app.js`, `index.html`, `style.css`, `config.js`, `manifest.webmanifest`, icons, backgrounds | `sql/module1_contacts_pipeline.sql` | nothing |
| 2. Lead forms | `mod-forms.js`, `mod-forms.css`, `form.html` | `sql/module2_lead_forms.sql` | Module 1 tables |

Run the database files in order (module 1 first) in Supabase, SQL Editor.

## Leave a module out for a client
Delete its two lines in `index.html` (the `mod-forms.css` link and the `mod-forms.js` script), and delete its files. The nav button is added by the module itself, so it disappears too.

## What a new add-on module (email, automations, booking) does
- Loads after `app.js`, wraps itself in `(() => { ... })();`, and uses the hooks:
  `CRM_EXT.views.NAME = renderFunction`, `CRM_EXT.titles.NAME = 'Title'`, `CRM_EXT.cards.ACTIVITY_TYPE = cardFunction`, `CRM_EXT.onMerge.push(fn)`.
- Adds its own rail button (see the end of `mod-forms.js`).
- Brings its own `.sql` file and, if it needs a secret key, a Supabase Edge Function.
