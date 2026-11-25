// Rebuilds crm-demo.html from index.html.
// Run:  node build-crm-demo.mjs        (needs Node 18+)
// crm-demo.html loads crm-demo.js (sample data held in memory) INSTEAD of config.js and the Supabase script,
// so it can never reach your real database, and nothing is saved or sent.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

const OUT = 'crm-demo.html';
const fail = m => { console.error('\n[X] Demo build failed: ' + m + '\n'); process.exit(1); };
const must = (src, re, rep, label) => {
  if (!re.test(src)) fail(`${label} was not found in index.html. The code changed, so update that pattern in build-crm-demo.mjs (or ask Claude).`);
  return src.replace(re, () => rep);
};
const maybe = (src, re, rep, label) => (re.test(src) ? src.replace(re, () => rep) : (console.warn('  note: optional part not found: ' + label), src));

if (!existsSync('crm-demo.js')) fail('crm-demo.js (the sample data file) is missing from this folder.');
let html = readFileSync('index.html', 'utf8');
const mock = readFileSync('crm-demo.js', 'utf8');

// Real values we must never ship in the demo
const secrets = [];
if (existsSync('config.js')) {
  const cfg = readFileSync('config.js', 'utf8');
  for (const k of ['supabaseUrl', 'supabaseAnonKey']) { const m = cfg.match(new RegExp(k + '\\s*:\\s*["\']([^"\']{8,})["\']')); if (m) secrets.push(m[1]); }
}
const ver = createHash('sha1').update(mock).digest('hex').slice(0, 8);

html = must(html, /<script src="config\.js"><\/script>/, `<script src="crm-demo.js?v=${ver}"></script>`, 'The config.js script tag');
html = must(html, /\s*<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase[^>]*><\/script>/, '', 'The Supabase script tag');
html = must(html, /\s*<link rel="manifest" href="manifest\.webmanifest">/, '\n<meta name="robots" content="noindex">', 'The manifest link');
html = maybe(html, /<title>[^<]*<\/title>/, '<title>CRM (Live Demo)</title>', 'title');
html = maybe(html, /placeholder="you@company\.com"/, 'value="demo@example.com" placeholder="you@company.com"', 'login email field');
html = maybe(html, /placeholder="••••••••"/, 'value="demo1234" placeholder="••••••••"', 'login password field');
html = must(html, /<body>/, '<body>\n<div style="position:fixed;left:50%;bottom:12px;transform:translateX(-50%);z-index:99999;background:rgba(20,18,50,.92);color:#fff;font:13px system-ui,sans-serif;padding:7px 14px;border-radius:999px;box-shadow:0 6px 20px rgba(0,0,0,.35)" role="status">Live demo: sample data only. Nothing is saved or sent. <a href="" style="color:#b8b2ff;margin-left:6px">Reset</a></div>', 'The <body> tag');

for (const s of secrets) for (const [n, t] of [[OUT, html], ['crm-demo.js', mock]]) if (t.includes(s)) fail(`${n} contains a private config value (${s.slice(0, 18)}...).`);
if (/<script[^>]+(supabase|config\.js)/i.test(html)) fail(`${OUT} still loads the real Supabase library or config.js.`);

writeFileSync(OUT, html);
console.log(`OK: ${OUT} rebuilt. Safety check passed (${secrets.length} private value${secrets.length === 1 ? '' : 's'} checked).`);
