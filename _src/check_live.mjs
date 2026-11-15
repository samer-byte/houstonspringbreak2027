#!/usr/bin/env node
// Post-deploy check for houstonspringbreak2027.com (read-only GET requests; changes nothing anywhere).
//   node _src/check_live.mjs                       -> checks the live site
//   node _src/check_live.mjs --base http://localhost:8927 --no-redirects --no-outbound   -> local preview
// Checks: every sitemap URL returns 200 with a matching canonical · key assets 200 · private paths 404 ·
// http/www redirect to the https apex · the Eventbrite, GroupMe and Posh links on the site still answer ·
// then runs verify.mjs against the same base (prices, dates, JSON-LD). Exit 1 on any FAIL.
// Run it after every push, and on a schedule if one is set up (it doubles as the link monitor, audit SB27-09).
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://houstonspringbreak2027.com';
const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const flag = k => process.argv.includes(k);
const BASE = (arg('--base') || SITE).replace(/\/$/, '');
const UA = { 'user-agent': 'Mozilla/5.0 (site-check)' };
const D = JSON.parse(readFileSync(path.join(ROOT, '_src/schools.json'), 'utf8'));

const rows = []; let fails = 0;
const log = (ok, what, detail = '') => { rows.push(`${ok === true ? 'PASS' : ok === 'warn' ? 'WARN' : 'FAIL'}  ${what}${detail ? '  ' + detail : ''}`); if (ok === false) fails++; };
const get = async (url, opts = {}) => {
  try { return await fetch(url, { headers: UA, ...opts }); } catch (e) { return { status: 0, error: e.message, headers: new Map(), text: async () => '' }; }
};

// 1. every page in the sitemap
const smRes = await get(BASE + '/sitemap.xml');
const sm = await smRes.text();
const locs = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]).filter(u => !/\.(jpg|png|webp)$/.test(u));
log(smRes.status === 200 && locs.length > 0, `/sitemap.xml ${smRes.status}`, `${locs.length} pages`);
for (const loc of locs) {
  const p = loc.replace(SITE, '');
  const r = await get(BASE + p);
  const html = r.status === 200 ? await r.text() : '';
  const canon = (html.match(/<link rel="canonical" href="([^"]+)"/) || [])[1];
  log(r.status === 200 && canon === loc, `${p} ${r.status}`, canon === loc ? '' : `canonical ${canon}`);
}

// 2. files that must be served
for (const p of ['/robots.txt', '/llms.txt', '/css/pages.css', '/js/finder.js', '/schools/schools.json',
  '/fonts/anton-latin.woff2', '/fonts/dmsans-latin.woff2', '/img/school-list-2027.jpg', '/img/school-list-week-1-800.webp', '/img/gal-1.webp']) {
  const r = await get(BASE + p); log(r.status === 200, `${p} ${r.status}`);
}

// 3. paths that must NOT be served (private source, moved files, true misses)
for (const p of ['/_src/build.mjs', '/_src/eventbrite.json', '/_unpublished_assets/hero-band.jpg', '/gal-1.jpg',
  '/.git/config', '/.env', '/no-such-page-xyz']) {
  const r = await get(BASE + p, { redirect: 'manual' });
  // a local static server does not hide '_' folders the way GitHub Pages does, so off-live this is only a warning
  log(r.status === 404 ? true : (BASE === SITE ? false : 'warn'), `${p} ${r.status}`, r.status === 404 ? '' : 'expected 404 on the live host');
}
// the 404 page lowercases mixed-case paths (/LINKS is printed on a flyer): it must carry that script
{ const r = await get(BASE + '/LINKS'); const t = await r.text(); log(r.status === 404 && /toLowerCase\(\)/.test(t) ? true : (BASE === SITE ? false : 'warn'), `/LINKS ${r.status}`, '404 page with lowercase redirect'); }

// 4. http and www go to the https apex (live only)
if (!flag('--no-redirects') && BASE === SITE) {
  for (const u of ['http://houstonspringbreak2027.com/', 'https://www.houstonspringbreak2027.com/', 'http://www.houstonspringbreak2027.com/']) {
    const r = await get(u, { redirect: 'manual' }); const loc = r.headers.get ? r.headers.get('location') : '';
    log([301, 302, 308].includes(r.status) && /^https:\/\/houstonspringbreak2027\.com\/?/.test(loc || ''), `${u} ${r.status}`, `-> ${loc}`);
  }
}

// 5. the outside links every page depends on (one Eventbrite event, one GroupMe link, one Posh event)
if (!flag('--no-outbound')) {
  for (const [name, u] of [['Eventbrite event', D.eventbrite], ['GroupMe join link', D.groupme], ['Posh event', D.posh], ['Instagram', D.profiles.instagram]]) {
    const r = await get(u, { redirect: 'follow' });
    // Instagram often refuses unsigned requests; a refusal there is a warning, not a broken link.
    const ok = r.status >= 200 && r.status < 400 ? true : (name === 'Instagram' ? 'warn' : false);
    log(ok, `${name} ${r.status}`, u);
  }
}

// 6. prices, dates and JSON-LD on the served pages
const v = spawnSync(process.execPath, [path.join(ROOT, '_src/verify.mjs'), '--base', BASE], { encoding: 'utf8' });
log(v.status === 0, 'verify.mjs against ' + BASE, (v.stdout + v.stderr).trim().split('\n').pop());

console.log(rows.join('\n'));
console.log(`\n${fails ? 'FAIL' : 'OK'}: ${rows.length} checks, ${fails} failed · ${BASE}`);
process.exit(fails ? 1 : 0);
