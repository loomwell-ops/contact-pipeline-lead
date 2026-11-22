# Module 5 spec: Insights (reporting) and Book a call

Files: `module5_insights.sql`, `mod-insights.js`, changes to `index.html` and `config.js`.
Needs Modules 1 to 4. It changes no existing table and sends nothing.

## Requirements
1. The database gets one function, `public.insights_summary(p_days integer)`, that returns all report numbers as one JSON document.
2. It runs as the logged-in user (SECURITY INVOKER), so Row Level Security still applies. `anon` and `public` cannot execute it. Only `authenticated` can.
3. `p_days` is clamped to 1 to 365. Null becomes 30.
4. Counting is done in the database, so the 1000-row API limit cannot cut numbers short.
5. Email numbers cover customer emails only (`kind <> 'internal'`). "Sent" counts exclude failed messages. "Sent today" uses the same rule as the sender: UTC day, failed excluded, internal included, compared with `email_settings.daily_cap`.
6. The Insights screen offers 7, 30 and 90 days. Up to 30 days it shows emails per day. For 90 days it groups by week.
7. The screen shows: emails sent, sent today against the cap, opt-outs, form leads, emails by origin (manual, auto-reply, automation, retry), email results by status, who can be emailed (by email status), new leads by source, a lead-forms table, and an automations table with the top skip reasons.
8. All text from the database is escaped before display.
9. Book a call screen: shows the link from `bookingUrl` in `config.js` (default `https://calendly.com/loomwellops/30min`), a Copy link button, an Open in new tab link, and the Calendly page in an iframe.
10. Only `https://calendly.com/...` links are ever framed. Anything else shows a message and no iframe.
11. `index.html` adds exactly one CSP change, `frame-src https://calendly.com`, plus the script line for `mod-insights.js`.
12. Two rail buttons (Insights, Book a call) are added by the module itself. Removing its script line removes them.
13. Bookings made in Calendly are not recorded in the CRM (that needs a Calendly webhook on a paid plan). The screen says so.

## Test plan
| # | Test | Expected |
|---|---|---|
| 1 | Call the function with the logged-in session | Returns JSON with `days`, `audience`, `forms` and the other keys |
| 2 | Call it with the anon key | Permission denied |
| 3 | Call it with `p_days` of 0, -5, 9999, null | Clamped to 1, 1, 365, 30 |
| 4 | Security advisor after applying | No new warnings for `insights_summary` |
| 5 | Insights screen, 30 days, current data | Shows 100 contacts as "Not opted in", 1 form submission, 0 emails |
| 6 | Send one email from a contact | Emails sent and "sent today" go up by 1 after Refresh |
| 7 | Mark a test contact subscribed, then unsubscribe through its link | Opt-outs goes up by 1 |
| 8 | Switch to 90 days | Weekly rows, no blank or NaN values |
| 9 | Contact source or form name containing `<b>x</b>` | Shown as text, not bold |
| 10 | Book a call screen | Calendly page loads inside the frame |
| 11 | Set `bookingUrl` to a non-Calendly address | Message shown, no frame |
| 12 | Light and dark theme on both screens | Readable in both |
| 13 | Remove the `mod-insights.js` script line | Both buttons disappear, rest of the CRM works |
| 14 | A failed email (for example no API key) | Counted under "Failed", not under "sent" totals |
