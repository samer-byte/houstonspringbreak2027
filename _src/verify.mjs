#!/usr/bin/env node
// Checks every published HTML page: each JSON-LD block parses; every Event's date and price
// equals the Eventbrite snapshot (_src/eventbrite.json); @id references resolve within the page;
// no "all ages" wording; titles <= 60 chars. Usage: node _src/verify.mjs [--base https://houstonspringbreak2027.com]
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EBD = JSON.parse(readFileSync(path.join(ROOT, '_src/eventbrite.json'), 'utf8'));
const base = (() => { const i = process.argv.indexOf('--base'); return i > 0 ? process.argv[i + 1] : null; })();
const money = v => (Number(v) % 1 ? Number(v).toFixed(2) : String(Number(v)));

const files = [];
(function walk(d) {
  for (const f of readdirSync(d)) {
    if (f.startsWith('_') || f.startsWith('.') || f === 'node_modules') continue;
    const p = path.join(d, f);
    if (statSync(p).isDirectory()) walk(p); else if (f === 'index.html') files.push(p);
  }
})(ROOT);

const errs = []; let blocks = 0, events = 0, visible = 0;
const normN = t => t.toLowerCase().replace(/\s*21\+\s*$/, '').replace(/[^a-z0-9]+/g, ' ').trim();
const byId = Object.fromEntries(EBD.ticket_classes.map(t => [t.id, t]));
for (const f of files) {
  const rel = '/' + path.relative(ROOT, path.dirname(f)).replace(/\\/g, '/') + (path.dirname(f) === ROOT ? '' : '/');
  const html = base ? await (await fetch(base + rel.replace(/^\/\//, '/'))).text() : readFileSync(f, 'utf8');
  const title = ((html.match(/<title>([^<]*)<\/title>/) || [])[1] || '').replace(/&amp;/g, '&');
  if (title.length > 60 && !rel.startsWith('/links')) errs.push(`${rel}: title ${title.length} chars`);
  if (/all[\s-]ages/i.test(html)) errs.push(`${rel}: contains "all ages"`);
  // --- visible HTML checks (added after the 9/25 "$1/$2" replacement bug corrupted home prices) ---
  if (rel === '/') for (const n of ['ld', 'lineup']) {
    const o = html.split(`<!-- BUILD:${n} -->`).length - 1, c = html.split(`<!-- /BUILD:${n} -->`).length - 1;
    if (o !== 1 || c !== 1) errs.push(`/: BUILD:${n} markers open ${o} close ${c} (want 1/1)`);
  }
  const idc = {}; for (const m of html.matchAll(/\sid="([^"]+)"/g)) idc[m[1]] = (idc[m[1]] || 0) + 1;
  for (const [k, v] of Object.entries(idc)) if (v > 1) errs.push(`${rel}: duplicate id="${k}" x${v}`);
  const visPrice = (date, name, shown) => {
    const tc = EBD.ticket_classes.find(t => t.date === date && normN(t.party) === normN(name));
    if (!tc) { errs.push(`${rel}: visible "${name}" on ${date} has no Eventbrite ticket`); return; }
    const want = tc.free ? 'Free' : '$' + money(tc.price);
    if (shown !== want) errs.push(`${rel}: visible price ${date} ${name}: "${shown}" vs Eventbrite ${want}`);
    visible++;
  };
  // compact lineup cards (home, school pages): <h4>Thursday, March 11</h4> ... <span>NAME <em>21+</em></span><span class="price">$80</span>
  for (const d of html.matchAll(/<div class="day"><h4>\w+, March (\d+)<\/h4><ul>([\s\S]*?)<\/ul><\/div>/g))
    for (const li of d[2].matchAll(/<li><span>([^<]+?)(?: <em>21\+<\/em>)?<\/span><span class="price">([^<]*)<\/span><\/li>/g))
      visPrice(`2027-03-${d[1].padStart(2, '0')}`, li[1].replace(/&amp;/g, '&'), li[2]);
  // week pages: <li id="03-11-slug"> ... <span class="pn">NAME ...</span><span class="price">$80</span>
  for (const li of html.matchAll(/<li id="03-(\d\d)-[^"]+">[\s\S]*?<span class="pn">([^<]+?)(?: <em>21\+<\/em>)?<\/span><span class="price">([^<]*)<\/span>/g))
    visPrice(`2027-03-${li[1]}`, li[2].replace(/&amp;/g, '&'), li[3]);
  // every "Week N ... Pack · $X" / "Week N Party Pack · $X" button or label
  for (const m of html.matchAll(/Week (\d) (?:Party )?Pack · \$?(\d+)/g)) {
    const tc = EBD.ticket_classes.find(t => t.name === `Week ${m[1]} Party Pack`);
    if (!tc || money(tc.price) !== m[2]) errs.push(`${rel}: "${m[0]}" vs Eventbrite ${tc && tc.price}`);
  }
  if (/Pack · (?!\$)\d/.test(html) || /class="price">\d/.test(html)) errs.push(`${rel}: a price lost its "$" (replacement bug?)`);
  const nodes = [];
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    blocks++;
    let j; try { j = JSON.parse(m[1]); } catch (e) { errs.push(`${rel}: JSON-LD parse error ${e.message}`); continue; }
    (j['@graph'] || [j]).forEach(n => nodes.push(n));
  }
  const ids = new Set(nodes.map(n => n['@id']).filter(Boolean));
  for (const n of nodes) {
    for (const k of ['subEvent', 'superEvent', 'about', 'breadcrumb', 'isPartOf', 'publisher', 'author']) {
      const refs = [].concat(n[k] || []).filter(r => r && r['@id'] && Object.keys(r).length === 1);
      for (const r of refs) if (!ids.has(r['@id']) && !/#website$|#org$|#series$|\/week-\d\/#event$/.test(r['@id'])) errs.push(`${rel}: ${n['@id']} ${k} -> ${r['@id']} not on page`);
    }
    if (n['@type'] !== 'Event' || !n.offers || Array.isArray(n.offers)) continue;   // party events have one Offer
    events++;
    const o = n.offers, tc = EBD.ticket_classes.find(t => t.name === o.name);
    if (!tc) { errs.push(`${rel}: ${n.name}: no Eventbrite ticket named "${o.name}"`); continue; }
    if (tc.date !== n.startDate) errs.push(`${rel}: ${n.name}: date ${n.startDate} vs Eventbrite ${tc.date}`);
    if ((tc.free ? '0' : money(tc.price)) !== o.price) errs.push(`${rel}: ${n.name}: price ${o.price} vs Eventbrite ${tc.free ? 0 : tc.price}`);
    if (!o.url.includes('?aff=')) errs.push(`${rel}: ${n.name}: offer url has no aff code`);
    if (/T\d\d:/.test(n.startDate)) errs.push(`${rel}: ${n.name}: has a start time Eventbrite does not provide`);
    for (const req of ['name', 'startDate', 'location', 'eventStatus', 'organizer', 'image', 'description']) if (!n[req]) errs.push(`${rel}: ${n.name}: missing ${req}`);
  }
  // week Events: pack price and date span
  for (const n of nodes.filter(n => n['@type'] === 'Event' && Array.isArray(n.offers))) {
    const pk = n.offers.find(o => o['@type'] === 'Offer'); const tc = EBD.ticket_classes.find(t => t.name === pk.name);
    if (!tc || money(tc.price) !== pk.price) errs.push(`${rel}: ${n.name}: pack price ${pk.price} vs Eventbrite ${tc && tc.price}`);
  }
}
console.log(`${files.length} pages · ${blocks} JSON-LD blocks parsed · ${events} party Event nodes + ${visible} visible prices checked against Eventbrite (${EBD.read_at})${base ? ' · LIVE ' + base : ''}`);
if (errs.length) { console.log(errs.join('\n')); process.exit(1); }
console.log('OK: 0 errors');
