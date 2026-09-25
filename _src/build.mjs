#!/usr/bin/env node
// Houston Spring Break 2027 static generator.
//   node _src/build.mjs            (refresh prices first: see _src/eventbrite_sync.py)
// Inputs  (never published; Jekyll skips "_" folders): _src/schools.json · _src/eventbrite.json · _src/lastmod.json
// Writes: schools/ (index, 42 school pages, schools.json for the finder) · week-1/ week-2/ week-3/ ·
//         houston-spring-break-guide/ · the BUILD regions inside index.html (JSON-LD graph, lineup) · sitemap.xml
// Rules: never state a school's academic-calendar dates · never invent venues, times, hosts or numbers ·
//        every party price/date must equal Eventbrite or the build stops.
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://houstonspringbreak2027.com';
const TODAY = process.env.LASTMOD || new Date().toISOString().slice(0, 10);
const D = JSON.parse(readFileSync(path.join(ROOT, '_src/schools.json'), 'utf8'));
const EBD = JSON.parse(readFileSync(path.join(ROOT, '_src/eventbrite.json'), 'utf8'));
const EB = D.eventbrite, GM = D.groupme, POSH = D.posh, P = D.profiles;
const GUIDE = '/houston-spring-break-guide/';

const esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const slug = n => n.toLowerCase().replace(/&/g, '').replace(/\+/g, ' ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const tint = w => ({ 1: 'c-sun', 2: 'c-rose', 3: 'c-aqua' })[w];
const S = D.schools.map(s => ({ ...s, slug: slug(s.name) }));
const slugs = new Set(S.map(s => s.slug)); if (slugs.size !== S.length) throw new Error('duplicate slug');
const HBCU_N = S.filter(s => s.hbcu).length, TX_N = S.filter(s => s.texas).length;
const WEEKS = ['1', '2', '3'];
const stateName = s => D.states[s.state];
const listAnd = a => a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`;
const money = v => (Number(v) % 1 ? Number(v).toFixed(2) : String(Number(v)));

// ---------- parties, checked against the Eventbrite snapshot ----------
const MONTHS = { March: '03' };
const isoOf = dayLabel => { const m = dayLabel.match(/(\w+) (\d+)$/); return `2027-${MONTHS[m[1]]}-${String(m[2]).padStart(2, '0')}`; };
const norm = t => t.toLowerCase().replace(/\s*21\+\s*$/, '').replace(/[^a-z0-9]+/g, ' ').trim();
const EBC = EBD.ticket_classes;
const used = new Set();
const PARTIES = {};           // week -> [{...}]
for (const w of WEEKS) {
  const W = D.weeks[w];
  PARTIES[w] = [];
  W.days.forEach(([day, items]) => items.forEach(([name, adult, priceTxt]) => {
    const date = isoOf(day);
    const c = EBC.filter(x => x.date === date && norm(x.party) === norm(name));
    if (c.length !== 1) throw new Error(`Eventbrite match for ${date} ${name}: ${c.length}`);
    const tc = c[0]; used.add(tc.id);
    const ebAdult = /21\+\s*$/.test(tc.party);
    if (ebAdult !== adult) throw new Error(`21+ flag differs from Eventbrite: ${date} ${name}`);
    const sitePrice = priceTxt === 'Free' ? null : priceTxt.replace('$', '');
    if ((tc.free ? null : money(tc.price)) !== (sitePrice === null ? null : money(sitePrice))) throw new Error(`price differs from Eventbrite: ${date} ${name} site ${priceTxt} eb ${tc.price}`);
    if (tc.on_sale_status !== 'AVAILABLE' || tc.hidden) console.warn(`NOTE ${date} ${name}: Eventbrite status ${tc.on_sale_status}${tc.hidden ? ' (hidden)' : ''}`);
    if (!D.parties[name]) throw new Error('no description for ' + name);
    PARTIES[w].push({ w, day, date, name, adult, free: tc.free, price: tc.free ? '0' : money(tc.price), priceTxt,
      tc, anchor: `${date.slice(5)}-${slug(name)}`, desc: D.parties[name] });
  }));
  const pack = EBC.find(x => x.name === `Week ${w} Party Pack`);
  if (!pack || money(pack.price) !== String(W.pack)) throw new Error(`Week ${w} pack differs from Eventbrite`);
  used.add(pack.id); W.packClass = pack;
  const paid = PARTIES[w].filter(p => !p.free).map(p => +p.price);
  if (paid.reduce((a, b) => a + b, 0) !== W.separately) throw new Error(`Week ${w} "separately" ${W.separately} != sum of singles ${paid.reduce((a, b) => a + b, 0)}`);
  W.singlesFrom = Math.min(...paid); W.singlesTo = Math.max(...paid);
  W.first = PARTIES[w][0].date; W.last = PARTIES[w][PARTIES[w].length - 1].date;
  W.url = `${SITE}/week-${w}/`; W.path = `/week-${w}/`;
}
const leftover = EBC.filter(x => x.date && !used.has(x.id));
if (leftover.length) throw new Error('Eventbrite has dated tickets the site does not list: ' + leftover.map(x => x.name).join('; '));
const ALL_PARTIES = WEEKS.flatMap(w => PARTIES[w]);
const REFUND_DAYS = EBD.refund_policy.validity_days;
if (!EBD.refund_policy.is_refund_request_allowed || !REFUND_DAYS) throw new Error('refund policy changed on Eventbrite: update the copy');
const PACK_MIN = Math.min(...WEEKS.map(w => D.weeks[w].pack));
const SINGLES_MIN = Math.min(...WEEKS.map(w => D.weeks[w].singlesFrom));
const adultKey = w => PARTIES[w].filter(p => p.adult).map(p => `${p.day.split(',')[0]} ${p.name}`).join('|');
if (new Set(WEEKS.map(adultKey)).size !== 1) throw new Error('21+ events differ between weeks: update the guide copy');
const ADULT_NAMES = [...new Set(ALL_PARTIES.filter(p => p.adult).map(p => `${p.day.split(',')[0]} ${p.name}`))];

// ---------- shared scene (static SVG) ----------
const SKYLINE = `<svg viewBox="0 0 1200 200" preserveAspectRatio="none"><g fill="#2a1436"><rect x="40" y="120" width="34" height="80"/><rect x="82" y="86" width="26" height="114"/><rect x="118" y="140" width="40" height="60"/><rect x="168" y="60" width="30" height="140"/><polygon points="168,60 183,34 198,60"/><rect x="212" y="110" width="44" height="90"/><rect x="266" y="70" width="24" height="130"/><rect x="300" y="128" width="52" height="72"/><rect x="360" y="44" width="34" height="156"/><polygon points="360,44 377,16 394,44"/><rect x="404" y="100" width="28" height="100"/><rect x="442" y="132" width="46" height="68"/><rect x="498" y="78" width="30" height="122"/><rect x="536" y="116" width="38" height="84"/><rect x="584" y="54" width="36" height="146"/><rect x="630" y="124" width="30" height="76"/><rect x="672" y="92" width="42" height="108"/><rect x="722" y="138" width="34" height="62"/><rect x="766" y="66" width="28" height="134"/><polygon points="766,66 780,40 794,66"/><rect x="806" y="118" width="48" height="82"/><rect x="866" y="88" width="26" height="112"/><rect x="902" y="134" width="40" height="66"/><rect x="952" y="74" width="32" height="126"/><rect x="994" y="126" width="44" height="74"/><rect x="1048" y="98" width="28" height="102"/><rect x="1086" y="140" width="52" height="60"/><rect x="1148" y="110" width="30" height="90"/></g></svg>`;
const PALM_L = `<svg class="p-l" viewBox="-10 240 270 460" preserveAspectRatio="xMinYMax meet"><g fill="#150a24"><path d="M112 700 C108 560 104 470 84 392 l24 -6 c20 84 26 180 28 314 z"/><path d="M100 392 C60 350 22 336 -8 344 c34 -28 84 -22 116 18 z"/><path d="M104 388 C82 330 44 296 6 286 c48 -6 92 26 112 92 z"/><path d="M110 384 C118 320 154 276 200 258 c-30 40 -58 74 -70 130 z"/><path d="M116 390 C160 356 214 350 254 368 c-48 -4 -92 6 -126 36 z"/><path d="M108 386 C96 338 96 288 116 246 c10 46 8 94 6 142 z"/><circle cx="106" cy="392" r="9"/><circle cx="122" cy="398" r="7"/></g></svg>`;
const PALM_R = `<svg class="p-r" viewBox="950 250 275 450" preserveAspectRatio="xMaxYMax meet"><g fill="#150a24"><path d="M1088 700 C1094 574 1102 486 1124 414 l-24 -8 c-22 78 -30 168 -34 294 z"/><path d="M1108 410 C1150 366 1192 352 1222 362 c-36 -28 -88 -20 -118 20 z"/><path d="M1104 406 C1128 348 1166 314 1204 304 c-48 -8 -94 24 -114 90 z"/><path d="M1098 402 C1088 338 1052 294 1006 276 c30 40 58 74 70 130 z"/><path d="M1092 408 C1048 374 994 368 954 386 c48 -4 92 6 126 36 z"/><circle cx="1102" cy="410" r="9"/><circle cx="1086" cy="416" r="7"/></g></svg>`;
const SCENE = `<div class="scene" aria-hidden="true"><div class="s-glow"></div><div class="s-sun"></div><div class="s-skyline">${SKYLINE}</div><div class="s-water"></div><div class="s-palms">${PALM_L}${PALM_R}</div><div class="s-grain"></div></div>`;

// ---------- JSON-LD ----------
const PLACE = { '@type': 'Place', name: 'Houston, TX', address: { '@type': 'PostalAddress', addressLocality: 'Houston', addressRegion: 'TX', addressCountry: 'US' } };
const ORG_REF = { '@type': 'Organization', '@id': `${SITE}/#org`, name: 'Houston Spring Break', url: `${SITE}/` };
const orgNode = () => ({ '@type': 'Organization', '@id': `${SITE}/#org`, name: 'Houston Spring Break', alternateName: 'Houston Spring Break 2027',
  url: `${SITE}/`, sameAs: [P.instagram, P.eventbrite_organizer, P.posh_group] });
const siteNode = () => ({ '@type': 'WebSite', '@id': `${SITE}/#website`, url: `${SITE}/`, name: 'Houston Spring Break 2027', inLanguage: 'en-US', publisher: { '@id': `${SITE}/#org` } });
const avail = tc => tc.on_sale_status === 'SOLD_OUT' ? 'https://schema.org/SoldOut' : 'https://schema.org/InStock';
const partyId = p => `${SITE}/week-${p.w}/#${p.anchor}`;
const weekId = w => `${SITE}/week-${w}/#event`;
const partyNode = p => ({
  '@type': 'Event', '@id': partyId(p),
  name: `${p.name}${p.adult ? ' (21+)' : ''} · Houston Spring Break 2027 Week ${p.w}`,
  description: `${p.desc} ${p.adult ? '21+ only, valid ID required.' : '18+.'} Part of Week ${p.w} of Houston Spring Break 2027. The venue is announced the week of the event and sent to ticket holders and the official GroupMe.`,
  startDate: p.date,
  eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
  eventStatus: 'https://schema.org/EventScheduled',
  location: PLACE,
  image: [`${SITE}/img/school-list-week-${p.w}.jpg`, `${SITE}/img/school-list-2027.jpg`],
  organizer: ORG_REF,
  typicalAgeRange: p.adult ? '21-' : '18-',
  ...(p.free ? { isAccessibleForFree: true } : {}),
  offers: { '@type': 'Offer', name: p.tc.name, url: `${EB}?aff=site_ld_w${p.w}`, price: p.price, priceCurrency: 'USD',
    availability: avail(p.tc), validFrom: p.tc.sales_start, validThrough: p.tc.sales_end },
  url: partyId(p),
  superEvent: { '@id': weekId(p.w) },
});
const weekNode = w => {
  const W = D.weeks[w];
  return {
    '@type': 'Event', '@id': weekId(w), name: `Houston Spring Break 2027 Week ${w} (${W.label.replace(' – ', '–')})`,
    description: `Week ${w} of Houston Spring Break 2027: ${PARTIES[w].length} parties in Houston, Texas, ${W.nights}, 2027. ${listAnd(PARTIES[w].map(p => p.name + (p.adult ? ' (21+)' : '')))}. Party Pack $${W.pack}.`,
    startDate: W.first, endDate: W.last,
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode', eventStatus: 'https://schema.org/EventScheduled',
    location: PLACE, image: [`${SITE}/img/school-list-week-${w}.jpg`, `${SITE}/img/school-list-2027.jpg`], organizer: ORG_REF,
    url: W.url, superEvent: { '@id': `${SITE}/#series` },
    offers: [
      { '@type': 'Offer', name: `Week ${w} Party Pack`, url: `${EB}?aff=site_ld_w${w}`, price: String(W.pack), priceCurrency: 'USD',
        availability: avail(W.packClass), validFrom: W.packClass.sales_start, validThrough: W.packClass.sales_end },
      { '@type': 'AggregateOffer', name: `Week ${w} single party tickets`, url: `${EB}?aff=site_ld_w${w}`, lowPrice: String(W.singlesFrom), highPrice: String(W.singlesTo),
        offerCount: PARTIES[w].filter(p => !p.free).length, priceCurrency: 'USD', availability: 'https://schema.org/InStock' },
    ],
    subEvent: PARTIES[w].map(p => ({ '@id': partyId(p) })),
  };
};
const seriesNode = () => ({
  '@type': 'EventSeries', '@id': `${SITE}/#series`, name: 'Houston Spring Break 2027',
  description: `Three weeks of mansion parties, pool parties, a booze boat party, day parties and club events in Houston, Texas for college students from 200+ schools, March 10–28, 2027. Party nights run Thursday to Sunday of each week.`,
  startDate: '2027-03-10', endDate: '2027-03-28',
  eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode', eventStatus: 'https://schema.org/EventScheduled',
  location: PLACE, image: [`${SITE}/img/school-list-2027.jpg`], organizer: { '@id': `${SITE}/#org` }, url: `${SITE}/`,
  subEvent: WEEKS.map(w => ({ '@id': weekId(w) })),
});
const crumbsLd = (url, items) => ({ '@type': 'BreadcrumbList', '@id': `${url}#breadcrumb`,
  itemListElement: items.map(([name, item], i) => ({ '@type': 'ListItem', position: i + 1, name, item })) });
const faqLd = (id, qs) => ({ '@type': 'FAQPage', '@id': id, mainEntity: qs.map(([q, a]) => ({ '@type': 'Question', name: q,
  acceptedAnswer: { '@type': 'Answer', text: a.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"') } })) });

const head = ({ title, desc, canonical, jsonld, image = `${SITE}/img/school-list-2027.jpg` }) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${canonical}">
<meta name="robots" content="index,follow,max-image-preview:large">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Houston Spring Break 2027">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="${image}">
<meta property="og:image:width" content="1600">
<meta property="og:image:height" content="1236">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#140b26">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🌴</text></svg>">
<link rel="preload" href="/fonts/anton-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/css/pages.css">
<script type="application/ld+json">
${JSON.stringify(jsonld, null, 1)}
</script>
</head>`;

const bar = aff => `<header class="bar">
  <a class="mark" href="/">Houston <span>Spring Break 27</span></a>
  <div class="bar-cta">
    <a class="btn btn-sun" href="${EB}?aff=${aff}">Tickets</a>
    <a class="btn btn-aqua" href="${GM}">GroupMe</a>
  </div>
</header>`;

const footer = `<footer>
  <div class="wrap">
    <ul class="foot-links">
      <li><a href="/">Houston Spring Break 2027</a></li>
      <li><a href="${GUIDE}">Houston spring break guide</a></li>
      <li><a href="/week-1/">Week 1</a></li>
      <li><a href="/week-2/">Week 2</a></li>
      <li><a href="/week-3/">Week 3</a></li>
      <li><a href="/schools/">Find your school</a></li>
      <li><a href="/#school-list">2027 School List flyers</a></li>
      <li><a href="/#faq">FAQ</a></li>
      <li><a href="/links/">All links</a></li>
      <li><a href="${P.instagram}">Instagram</a></li>
    </ul>
    <p class="foot-base">Presented by @houston_springbreak · Houston Spring Break 2027 · Houston, TX<br>An independent event. Not affiliated with or endorsed by any college or university.</p>
  </div>
</footer>`;

// Plain HTML links (no JS needed) so crawlers and no-JS visitors reach every hub from every page.
const planLinks = (here = '') => {
  const items = [['/', 'Houston Spring Break 2027 home'], [GUIDE, 'Houston spring break guide'],
    ...WEEKS.map(w => [`/week-${w}/`, `Week ${w}: ${D.weeks[w].label.replace(' – ', '–')}`]), ['/schools/', 'Find your school']]
    .filter(([h]) => h !== here);
  return `<nav class="plan" aria-label="Plan your Houston spring break">
      <h2 class="plan-h">Plan your Houston spring break</h2>
      <ul>${items.map(([h, t]) => `<li><a href="${h}">${esc(t)}</a></li>`).join('')}</ul>
    </nav>`;
};

const finderForm = () => `<form class="finder" data-finder action="/schools/" method="get" role="search">
      <label for="find">Find your school</label>
      <input id="find" name="q" type="search" autocomplete="off" spellcheck="false" placeholder="Your school, e.g. Howard or UH" aria-describedby="find-status">
      <p id="find-status" class="sr" data-finder-status role="status" aria-live="polite"></p>
      <div id="find-out" data-finder-out></div>
    </form>`;

const flyer = (w, sizes = '(max-width:980px) 100vw, 560px') => `<figure class="flyer">
          <a href="/img/school-list-week-${w}.jpg"><picture><source type="image/webp" srcset="/img/school-list-week-${w}-800.webp 800w, /img/school-list-week-${w}.webp 1600w" sizes="${sizes}"><img src="/img/school-list-week-${w}.jpg" width="1600" height="1236" loading="lazy" decoding="async" alt="Official Houston Spring Break 2027 Week ${w} school list flyer"></picture></a>
          <figcaption>Week ${w} school list · flyer dates are school spring-break weeks · tap for full size</figcaption>
        </figure>`;

// compact lineup card (school pages + home)
const lineupCard = (w, { h = 'h3', link = true, btn = false, aff = '' } = {}) => {
  const W = D.weeks[w];
  const days = W.days.map(([day, items]) => `<div class="day"><h4>${day}</h4><ul>${items.map(([n, adult, p]) => `<li><span>${esc(n)}${adult ? ' <em>21+</em>' : ''}</span><span class="price">${p}</span></li>`).join('')}</ul></div>`).join('');
  return `<article class="card lw ${tint(+w)}${+w === 2 ? ' hot' : ''}" id="week-${w}"><${h}>Week ${w} <span>${W.label}</span></${h}><p class="lw-note">${W.note} Parties run ${W.nights.replace(' to ', ' through ')}.</p>${days}${btn ? `<a class="btn btn-sun" href="${EB}?aff=${aff}">Week ${w} Party Pack · $${W.pack}</a>` : ''}${link ? `<a class="pk-link" href="/week-${w}/">Week ${w} page: schools, lineup, FAQ</a>` : ''}</article>`;
};
const adultList = w => PARTIES[w].filter(p => p.adult).map(p => `${p.day.split(',')[0]} ${p.name}`);
const refundA = aff => `Refunds are available up to ${REFUND_DAYS} days before the event, under the refund policy on the <a href="${EB}?aff=${aff}">Eventbrite listing</a>. Request a refund from your Eventbrite order; it goes back to your original payment method.`;
const faqBlock = qs => `<div class="faq-list">${qs.map(([q, a], i) => `<details class="faq-q"${i === 0 ? ' open' : ''}><summary><h3>${esc(q)}</h3></summary><p>${a}</p></details>`).join('')}</div>`;
const page = ({ title, desc, canonical, jsonld, aff, body, scripts = '' }) => `${head({ title, desc, canonical, jsonld })}
<body>
<a class="skip" href="#main">Skip to content</a>
${SCENE}
${bar(aff)}
<main id="main">
${body}
</main>
${footer}
${scripts}</body>
</html>
`;
const crumbsNav = items => `<div class="wrap">
    <nav class="crumbs" aria-label="Breadcrumb"><ol>${items.map(([t, h], i) => i === items.length - 1 ? `<li aria-current="page">${esc(t)}</li>` : `<li><a href="${h}">${esc(t)}</a></li>`).join('')}</ol></nav>
  </div>`;
const pill = w => ({ 1: 'Opening week', 2: 'Biggest week', 3: 'Closing week' })[w];

// ---------- school page ----------
function titleFor(s) {
  const c = [`${s.name} Spring Break 2027 in Houston | Week ${s.week}`, `${s.name} Spring Break 2027 | Houston Week ${s.week}`,
    `${s.short} Spring Break 2027 in Houston | Week ${s.week}`, `${s.short} Spring Break 2027 | Houston Week ${s.week}`];
  return c.find(t => t.length <= 60) || c[3];
}
const schoolLinks = arr => `<ul class="sl">${arr.map(o => `<li><a href="/schools/${o.slug}/">${esc(o.short)}</a></li>`).join('')}</ul>`;
function schoolPage(s) {
  const W = D.weeks[s.week], url = `${SITE}/schools/${s.slug}/`, aff = `site_s_${s.id}`;
  const kind = [s.hbcu && 'HBCU', s.texas && 'Texas school'].filter(Boolean);
  const where = stateName(s);
  const mates = S.filter(o => o.week === s.week && o.id !== s.id);
  const mHb = mates.filter(o => o.hbcu), mTx = mates.filter(o => o.texas && !o.hbcu);
  const sameState = S.filter(o => o.state === s.state && o.id !== s.id && !(s.state === 'TX'));   // Texas schools already get their own list
  const title = titleFor(s);
  const desc = [`${s.name} (${where}) is on Week ${s.week} of the Houston Spring Break 2027 School List. Parties ${W.nightsShort}. Party Pack $${W.pack}.`,
    `${s.name} is on Week ${s.week} of the Houston Spring Break 2027 School List. Parties ${W.nightsShort}. Party Pack $${W.pack}.`,
    `${s.short} is on Week ${s.week} of the Houston Spring Break 2027 School List. Parties ${W.nightsShort}. Party Pack $${W.pack}.`].find(t => t.length <= 160) || '';
  if (!desc) throw new Error('desc too long: ' + s.name);
  const adults = adultList(s.week);
  const peers = mates.slice(0, 3).map(o => o.short);
  const also = peers.length ? ` ${esc(listAnd(peers))} ${peers.length > 1 ? 'are' : 'is'} on it too.` : '';
  const intro = {
    1: `Week 1 is the opening week, and the first party night is ${PARTIES[1][0].day}.${also}`,
    2: `Week 2 is the biggest week of the season.${also}`,
    3: `Week 3 is the closing week, and the last party night is ${PARTIES[3][PARTIES[3].length - 1].day}.${also}`,
  }[s.week];
  const qs = [
    [`Which Houston Spring Break 2027 week is for ${s.short} students?`, `${esc(s.name)} is on <a href="/week-${s.week}/">Week ${s.week}</a> of the official 2027 School List, so plan on Week ${s.week}: parties run ${W.nights}, 2027. The School List groups schools by spring-break week, so confirm your exact break dates on ${esc(s.name)}’s official academic calendar.`],
    [`What does the Week ${s.week} Party Pack cover?`, `Every event in Week ${s.week} for $${W.pack} before fees. Bought separately, the same events come to about $${W.separately}. Week ${s.week} single tickets run $${W.singlesFrom}–$${W.singlesTo}, and the Friday brunch is free with a ticket. <a href="${EB}?aff=${aff}">Get the pack on Eventbrite</a>.`],
    [`Which Week ${s.week} events are 21+?`, `${listAnd(adults)}. Bring a valid government ID. Everything else in Week ${s.week} is 18+.`],
    [`How do ${s.short} students get the party addresses?`, `Addresses are announced the week of each event. They are sent to ticket holders and posted in the <a href="${GM}">official Houston Spring Break GroupMe</a>.`],
    [`Is Houston Spring Break affiliated with ${s.short}?`, `No. Houston Spring Break is an independent event. It is not affiliated with or endorsed by ${esc(s.name)} or any other school.`],
    ['Can I get a refund?', refundA(aff)],
  ];
  const jsonld = { '@context': 'https://schema.org', '@graph': [
    { '@type': 'WebPage', '@id': url, url, name: title, description: desc, isPartOf: { '@id': `${SITE}/#website` }, about: { '@id': weekId(s.week) }, breadcrumb: { '@id': `${url}#breadcrumb` } },
    crumbsLd(url, [['Houston Spring Break 2027', `${SITE}/`], ['Find your school', `${SITE}/schools/`], [s.name, url]]),
    faqLd(`${url}#faq`, qs),
  ] };
  const body = `  ${crumbsNav([['Home', '/'], ['Find your school', '/schools/'], [s.short, '']])}
  <section class="head">
    <div class="wrap">
      <div class="panel">
        <p class="eyebrow">Week ${s.week} · 2027 School List</p>
        <h1>${esc(s.name)} <span class="h1-sub">Spring Break 2027 in Houston</span></h1>
        <p class="tags"><span>${esc(where)}</span>${kind.map(k => `<span>${k}</span>`).join('')}<span>Week ${s.week}</span></p>
        <p class="lede">${esc(s.name)} is on <b>Week ${s.week}</b> of the official Houston Spring Break 2027 School List. Week ${s.week} parties run <b>${W.nights}, 2027</b>. ${intro}</p>
        <div class="cta-row">
          <a class="btn btn-sun btn-lg" href="${EB}?aff=${aff}">Get the Week ${s.week} Pack · $${W.pack}</a>
          <a class="btn btn-aqua btn-lg" href="${GM}">Join the GroupMe</a>
        </div>
        <a class="chip" href="${POSH}"><b>Free RSVP on Posh</b> · see who's going</a>
        <p class="fine">The School List groups schools by spring-break week. Confirm your exact break dates on ${esc(s.name)}’s official academic calendar. Houston Spring Break is an independent event, not affiliated with or endorsed by ${esc(s.name)}.</p>
      </div>
    </div>
  </section>
  <section aria-labelledby="wk-h">
    <div class="wrap">
      <h2 id="wk-h" class="sec-h">Your week: <a class="h-link" href="/week-${s.week}/">Week ${s.week}</a></h2>
      <div class="grid-2">
        <article class="card pack ${tint(s.week)}${s.week === 2 ? ' hot' : ''}">
          <p class="pk-week">Week ${s.week} · ${pill(s.week)}</p>
          <p class="pk-amt">$${W.pack}<span>Party Pack</span></p>
          <p class="pk-note">Covers every event that week. About $${W.separately} if you bought each party separately. Prices before fees.</p>
          <a class="btn btn-sun" href="${EB}?aff=${aff}">Get the Week ${s.week} Pack</a>
          <p class="fine">Addresses drop in the <a class="ul" href="${GM}">official GroupMe</a> the week of each event.</p>
        </article>
        ${lineupCard(s.week, { h: 'h3' })}
      </div>
    </div>
  </section>
  <section aria-labelledby="mates-h">
    <div class="wrap">
      <div class="panel">
        <h2 id="mates-h">Also on Week ${s.week}</h2>
        <p class="lede">These schools share Week ${s.week} with ${esc(s.name)} on the 2027 School List:</p>
        ${mHb.length ? `<h3 class="mini-h">HBCUs on Week ${s.week}</h3>${schoolLinks(mHb)}` : ''}
        ${mTx.length ? `<h3 class="mini-h">Texas schools on Week ${s.week}</h3>${schoolLinks(mTx)}` : ''}
        ${sameState.length ? `<h3 class="mini-h">Other ${esc(where)} schools with a page here</h3>${schoolLinks(sameState)}<p class="fine">${sameState.some(o => o.week !== s.week) ? 'Some of these are on a different week, so check each page.' : `All of them are on Week ${s.week} too.`}</p>` : ''}
        <p class="fine">200+ schools are on the full list. <a href="/week-${s.week}/">See everything on Week ${s.week}</a>, <a href="/#school-list">the official flyers</a> or <a href="/schools/">find another school</a>.</p>
      </div>
    </div>
  </section>
  <section aria-labelledby="faq-h">
    <div class="wrap">
      <div class="panel">
        <h2 id="faq-h">${esc(s.short)} FAQ</h2>
        ${faqBlock(qs)}
      </div>
    </div>
  </section>
  <section>
    <div class="wrap">
      <div class="panel">
        <h2>Two things to do now</h2>
        <p class="lede">Grab the Week ${s.week} pack, then join the GroupMe so you get the addresses.</p>
        <div class="cta-row">
          <a class="btn btn-sun btn-lg" href="${EB}?aff=${aff}">Get the Week ${s.week} Pack · $${W.pack}</a>
          <a class="btn btn-aqua btn-lg" href="${GM}">Join the GroupMe</a>
        </div>
        ${planLinks()}
      </div>
    </div>
  </section>`;
  return page({ title, desc, canonical: url, jsonld, aff, body });
}

// ---------- schools index ----------
function indexPage() {
  const url = `${SITE}/schools/`;
  const title = 'Find Your School | Houston Spring Break 2027 School List';
  const desc = `Find your school's week for Houston Spring Break 2027: ${HBCU_N} HBCUs and ${TX_N} Texas schools on the official 2027 School List, with party dates and Party Packs for each week.`;
  const weekCard = w => {
    const W = D.weeks[w], inW = S.filter(s => s.week === +w);
    const hb = inW.filter(s => s.hbcu), tx = inW.filter(s => s.texas && !s.hbcu);
    return `<article class="card wk ${tint(+w)}${+w === 2 ? ' hot' : ''}" id="week-${w}">
        <p class="pk-week">${pill(w)}</p>
        <h2><a class="h-link" href="/week-${w}/">Week ${w}</a></h2>
        <p class="fr-w">${W.label} · parties ${W.nightsShort}</p>
        ${hb.length ? `<h3>HBCUs</h3>${schoolLinks(hb)}` : ''}
        ${tx.length ? `<h3>Texas schools</h3>${schoolLinks(tx)}` : ''}
        <a class="btn btn-sun" href="${EB}?aff=site_schools_w${w}">Get the Week ${w} Pack · $${W.pack}</a>
        <a class="pk-link" href="/week-${w}/">Week ${w} page: lineup and FAQ</a>
      </article>`;
  };
  const jsonld = { '@context': 'https://schema.org', '@graph': [
    { '@type': 'CollectionPage', '@id': url, url, name: title, description: desc, isPartOf: { '@id': `${SITE}/#website` }, breadcrumb: { '@id': `${url}#breadcrumb` },
      mainEntity: { '@type': 'ItemList', numberOfItems: S.length, itemListElement: S.map((s, i) => ({ '@type': 'ListItem', position: i + 1, url: `${SITE}/schools/${s.slug}/`, name: s.name })) } },
    crumbsLd(url, [['Houston Spring Break 2027', `${SITE}/`], ['Find your school', url]]),
  ] };
  const body = `  ${crumbsNav([['Home', '/'], ['Find your school', '']])}
  <section class="head">
    <div class="wrap">
      <div class="panel">
        <p class="eyebrow">Official 2027 School List</p>
        <h1>Find Your School <span class="h1-sub">Houston Spring Break 2027</span></h1>
        <p class="lede">The official 2027 School List puts every school on one of three weeks. Search the HBCUs and Texas schools on the list, then lock in that week's Party Pack and join the GroupMe.</p>
        ${finderForm()}
        <script>try{var q=new URLSearchParams(location.search).get('q');if(q)document.getElementById('find').value=q.slice(0,60)}catch(e){}</script>
        <p class="fine">Pages below cover the ${HBCU_N} HBCUs and ${TX_N} Texas schools named on the list. 200+ schools are on the full list: <a href="/#school-list">see the official flyers</a>. The dates printed on the flyers are school spring-break weeks; party nights are Thursday to Sunday of each week. New to it? Read the <a href="${GUIDE}">Houston spring break guide</a>. Houston Spring Break is an independent event, not affiliated with or endorsed by any school.</p>
      </div>
    </div>
  </section>
  <section aria-label="Schools by week">
    <div class="wrap">
      <div class="grid-3">
        ${WEEKS.map(weekCard).join('\n        ')}
      </div>
      <div class="panel" style="margin-top:16px">${planLinks('/schools/')}</div>
    </div>
  </section>`;
  return page({ title, desc, canonical: url, jsonld, aff: 'site_schools_bar', body, scripts: '<script src="/js/finder.js" defer></script>\n' });
}

// ---------- week pages ----------
const nightsGrid = (w, aff) => {
  const W = D.weeks[w];
  return `<div class="nights">${W.days.map(([day]) => {
    const ps = PARTIES[w].filter(p => p.day === day);
    return `<article class="card night ${tint(+w)}">
          <h3>${day}</h3>
          <ul>${ps.map(p => `<li id="${p.anchor}">
            <p class="pt"><span class="pn">${esc(p.name)}${p.adult ? ' <em>21+</em>' : ''}</span><span class="price">${p.free ? 'Free' : '$' + p.price}</span></p>
            <p class="pd">${esc(p.desc)}${p.adult ? '' : ' 18+.'}</p>
          </li>`).join('')}</ul>
        </article>`;
  }).join('\n        ')}</div>
      <p class="fine">Single tickets before fees, on <a href="${EB}?aff=${aff}">Eventbrite</a>. 21+ events are marked; everything else is 18+. Venues are announced the week of each event.</p>`;
};
function weekPage(w) {
  const W = D.weeks[w], url = W.url, aff = `site_w${w}`;
  const label = W.label.replace(' – ', '–');
  const inW = S.filter(s => s.week === +w), hb = inW.filter(s => s.hbcu), tx = inW.filter(s => s.texas && !s.hbcu);
  const others = WEEKS.filter(x => x !== w);
  const adults = adultList(w);
  const title = `Houston Spring Break 2027 Week ${w} (${label}) | Lineup`;
  const desc = `Houston Spring Break 2027 Week ${w}, ${label}: ${PARTIES[w].length} parties ${W.nightsShort}, the Week ${w} Party Pack ($${W.pack}), 21+ events and the schools on Week ${w}.`;
  if (title.length > 60 || desc.length > 160) throw new Error(`week ${w} title/desc too long ${title.length}/${desc.length}`);
  const qs = [
    [`When is Week ${w} of Houston Spring Break 2027?`, `Week ${w} is ${label}, 2027. Party nights run ${W.nights}. ${W.note}`],
    [`What is in the Week ${w} Party Pack?`, `One ticket for all ${PARTIES[w].length} Week ${w} events: ${listAnd(PARTIES[w].map(p => p.name + (p.adult ? ' (21+)' : '')))}. It costs $${W.pack} before fees. Bought separately, the same events come to about $${W.separately}.`],
    [`Which schools are on Week ${w}?`, `${hb.length ? `HBCUs: ${listAnd(hb.map(s => s.short))}. ` : ''}${tx.length ? `Texas schools: ${listAnd(tx.map(s => s.short))}. ` : ''}The <a href="#schools">Week ${w} flyer</a> shows every school on the week. If your school's spring break falls in ${label}, this is your week.`],
    [`Which Week ${w} events are 21+?`, `${listAnd(adults)}. Bring a valid government ID. Everything else in Week ${w} is 18+.`],
    ['How do I get the party addresses?', `Addresses are announced the week of each event. They are sent to ticket holders and posted in the <a href="${GM}">official Houston Spring Break GroupMe</a>.`],
    ['Can I get a refund?', refundA(aff)],
  ];
  const jsonld = { '@context': 'https://schema.org', '@graph': [
    orgNode(),
    { '@type': 'WebPage', '@id': url, url, name: title, description: desc, isPartOf: { '@id': `${SITE}/#website` }, about: { '@id': weekId(w) }, breadcrumb: { '@id': `${url}#breadcrumb` } },
    crumbsLd(url, [['Houston Spring Break 2027', `${SITE}/`], [`Week ${w}`, url]]),
    weekNode(w),
    ...PARTIES[w].map(partyNode),
    faqLd(`${url}#faq`, qs),
  ] };
  const body = `  ${crumbsNav([['Home', '/'], [`Week ${w}`, '']])}
  <section class="head">
    <div class="wrap">
      <div class="panel">
        <p class="eyebrow">Week ${w} · ${pill(w)}</p>
        <h1>Houston Spring Break 2027 <span class="h1-sub">Week ${w} (${label})</span></h1>
        <p class="lede">Week ${w} of Houston Spring Break 2027 runs ${label}, with party nights <b>${W.nights}</b>: ${PARTIES[w].length} parties, and one Party Pack covers all of them for <b>$${W.pack}</b>. ${W.note}</p>
        <dl class="glance">
          <div><dt>Party nights</dt><dd>${W.nightsShort}</dd></div>
          <div><dt>Party Pack</dt><dd>$${W.pack}</dd></div>
          <div><dt>Singles</dt><dd>$${W.singlesFrom}–$${W.singlesTo}</dd></div>
          <div><dt>21+ events</dt><dd>${adults.length} of ${PARTIES[w].length}</dd></div>
        </dl>
        <div class="cta-row">
          <a class="btn btn-sun btn-lg" href="${EB}?aff=${aff}">Get the Week ${w} Pack · $${W.pack}</a>
          <a class="btn btn-aqua btn-lg" href="${GM}">Join the GroupMe</a>
        </div>
        <a class="chip" href="${POSH}"><b>Free RSVP on Posh</b> · see who's going</a>
      </div>
    </div>
  </section>
  <section aria-labelledby="lineup-h">
    <div class="wrap">
      <h2 id="lineup-h" class="sec-h">Week ${w} lineup, night by night</h2>
      ${nightsGrid(w, aff)}
    </div>
  </section>
  <section aria-labelledby="pack-h">
    <div class="wrap">
      <div class="grid-2">
        <article class="card pack ${tint(+w)}${+w === 2 ? ' hot' : ''}">
          <p class="pk-week">Week ${w} · ${pill(w)}</p>
          <h2 id="pack-h" class="pk-h">The Week ${w} Party Pack</h2>
          <p class="pk-amt">$${W.pack}<span>Party Pack</span></p>
          <p class="pk-note">One ticket for all ${PARTIES[w].length} events of Week ${w}. About $${W.separately} if you bought each party separately. Prices before fees.</p>
          <a class="btn btn-sun" href="${EB}?aff=${aff}_pack">Get the Week ${w} Pack</a>
          <p class="fine">On Eventbrite, choose “Week ${w} Party Pack”. Addresses drop in the <a class="ul" href="${GM}">official GroupMe</a> the week of each event.</p>
        </article>
        <div class="panel" id="schools">
          <h2 class="mini-h2">Schools on Week ${w}</h2>
          <p class="lede">The official 2027 School List puts these schools on Week ${w}. Each has its own page.</p>
          ${hb.length ? `<h3 class="mini-h">HBCUs</h3>${schoolLinks(hb)}` : ''}
          ${tx.length ? `<h3 class="mini-h">Texas schools</h3>${schoolLinks(tx)}` : ''}
          <p class="fine">The flyer below lists every school on Week ${w}. Not sure? <a href="/schools/">Search your school</a>.</p>
        </div>
      </div>
      ${flyer(w, '(max-width:1180px) 100vw, 1100px')}
    </div>
  </section>
  <section aria-labelledby="other-h">
    <div class="wrap">
      <h2 id="other-h" class="sec-h">The other two weeks</h2>
      <div class="grid-2 even">
        ${others.map(x => `<a class="card wk-link ${tint(+x)}" href="/week-${x}/"><span class="pk-week">Week ${x} · ${pill(x)}</span><span class="wl-d">${D.weeks[x].label}</span><span class="wl-n">Parties ${D.weeks[x].nightsShort} · Pack $${D.weeks[x].pack}</span></a>`).join('\n        ')}
      </div>
    </div>
  </section>
  <section aria-labelledby="faq-h">
    <div class="wrap">
      <div class="panel">
        <h2 id="faq-h">Week ${w} FAQ</h2>
        ${faqBlock(qs)}
        <p class="fine">More questions? The <a href="${GUIDE}">Houston spring break guide</a> covers packs, 21+ rules, addresses and refunds.</p>
      </div>
    </div>
  </section>
  <section>
    <div class="wrap">
      <div class="panel">
        <h2>Lock in Week ${w}</h2>
        <p class="lede">Grab the Week ${w} pack, then join the GroupMe so you get the addresses.</p>
        <div class="cta-row">
          <a class="btn btn-sun btn-lg" href="${EB}?aff=${aff}_final">Get the Week ${w} Pack · $${W.pack}</a>
          <a class="btn btn-aqua btn-lg" href="${GM}">Join the GroupMe</a>
        </div>
        ${planLinks(`/week-${w}/`)}
      </div>
    </div>
  </section>`;
  return page({ title, desc, canonical: url, jsonld, aff, body });
}

// ---------- pillar guide ----------
function guidePage() {
  const url = `${SITE}${GUIDE}`, aff = 'site_guide';
  const title = 'Houston Spring Break 2027 Guide: Weeks, Packs, 21+ Rules';
  const desc = `Houston Spring Break 2027 guide: the three weeks (March 10–28), how Party Packs work, the lineup, 21+ rules, addresses, refunds and picking your week.`;
  if (title.length > 60 || desc.length > 160) throw new Error(`guide title/desc too long ${title.length}/${desc.length}`);
  // lineup pattern: one row per party slot, price per week
  const slots = D.weeks['1'].days.flatMap(([day, items]) => items.map(([n, adult], i) => ({ dow: day.split(',')[0], n, adult, i })));
  const priceOf = (w, dow, n) => PARTIES[w].find(p => p.day.startsWith(dow) && p.name === n);
  const priceTxt = sl => {
    const ps = WEEKS.map(w => priceOf(w, sl.dow, sl.n));
    if (ps.every(p => p.free)) return 'Free every week';
    if (ps.every(p => p.price === ps[0].price)) return `$${ps[0].price} every week`;
    const by = {}; WEEKS.forEach(w => { const v = priceOf(w, sl.dow, sl.n).price; (by[v] = by[v] || []).push(w); });
    return Object.entries(by).map(([v, ws]) => `${ws.length > 1 ? `Weeks ${listAnd(ws).replace(' and ', ' & ')}` : `Week ${ws[0]}`} $${v}`).join(' · ');
  };
  const dows = [...new Set(slots.map(s => s.dow))];
  const hbAll = S.filter(s => s.hbcu), txAll = S.filter(s => s.texas && !s.hbcu);
  const toc = [['what', 'What it is'], ['weeks', 'The three weeks'], ['packs', 'How Party Packs work'], ['lineup', 'The lineup'],
    ['age', '21+ rules'], ['addresses', 'How addresses drop'], ['refunds', 'Refunds'], ['pick', 'Pick your week'], ['travel', 'Getting around Houston'], ['faq', 'FAQ']];
  const qs = [
    ['When is Houston Spring Break 2027?', `March 10–28, 2027, in three weeks: Week 1 is March 8–14, Week 2 is March 15–21 and Week 3 is March 22–28. Party nights are Thursday to Sunday of each week.`],
    ['How much is a Party Pack?', `$${D.weeks['1'].pack} for Week 1, $${D.weeks['2'].pack} for Week 2 and $${D.weeks['3'].pack} for Week 3, before fees. Each pack covers every event that week.`],
    ['Are the parties 21+?', `Events are 18+ unless marked 21+. The 21+ events are the ${listAnd(ADULT_NAMES)}, every week. Bring a valid government ID.`],
    ['Where are the parties?', 'In Houston, Texas. Venue addresses are announced the week of each event and sent to ticket holders and the official GroupMe.'],
    ['Which week should I pick?', `The week your school is on spring break. The <a href="/schools/">Find your school</a> page and the <a href="/#school-list">2027 School List flyers</a> show every school's week. Week 2 is the biggest week.`],
    ['Can I get a refund?', refundA(aff)],
    ['Which airports serve Houston?', 'Houston has two commercial airports: George Bush Intercontinental (IAH) and William P. Hobby (HOU). Check both when you compare flights.'],
  ];
  const jsonld = { '@context': 'https://schema.org', '@graph': [
    orgNode(),
    { '@type': 'Article', '@id': `${url}#article`, headline: 'Houston Spring Break 2027 Guide', description: desc, url, mainEntityOfPage: { '@id': url },
      author: { '@id': `${SITE}/#org` }, publisher: { '@id': `${SITE}/#org` }, datePublished: '2026-09-25', inLanguage: 'en-US',
      image: [`${SITE}/img/school-list-2027.jpg`], about: { '@id': `${SITE}/#series` } },
    { '@type': 'WebPage', '@id': url, url, name: title, description: desc, isPartOf: { '@id': `${SITE}/#website` }, breadcrumb: { '@id': `${url}#breadcrumb` } },
    crumbsLd(url, [['Houston Spring Break 2027', `${SITE}/`], ['Guide', url]]),
    faqLd(`${url}#faq`, qs),
  ] };
  const sec = (id, h, inner) => `  <section id="${id}" aria-labelledby="${id}-h">
    <div class="wrap">
      <div class="panel prose">
        <h2 id="${id}-h">${h}</h2>
        ${inner}
      </div>
    </div>
  </section>`;
  const body = `  ${crumbsNav([['Home', '/'], ['Guide', '']])}
  <section class="head">
    <div class="wrap">
      <div class="panel">
        <p class="eyebrow">The official guide</p>
        <h1>Houston Spring Break 2027 Guide</h1>
        <p class="lede">Everything you need before you book Houston spring break 2027: the three weeks, what a Party Pack covers, the nightly lineup, the 21+ rules, how the addresses drop, refunds, and how to pick your week.</p>
        <nav class="toc" aria-label="In this guide"><ol>${toc.map(([id, t]) => `<li><a href="#${id}">${t}</a></li>`).join('')}</ol></nav>
      </div>
    </div>
  </section>
${sec('what', 'What Houston Spring Break 2027 is', `<p>Houston Spring Break 2027 is three weeks of college parties in Houston, Texas, from March 10 to March 28, 2027: mansion parties, pool parties, a booze boat party with an open bar, day parties and club nights. It is built for college students and young professionals, with 200+ schools on the official 2027 School List and a strong HBCU turnout.</p>
        <p>Tickets and Party Packs are sold on <a href="${EB}?aff=${aff}">Eventbrite</a>. <a href="${POSH}">Free RSVP on Posh</a> saves your spot and shows who's going. Updates and addresses go out in the <a href="${GM}">official GroupMe</a> and on <a href="${P.instagram}">@houston_springbreak</a>.</p>`)}
${sec('weeks', 'The three weeks', `<p>Each week follows the same pattern: four party nights, Thursday to Sunday. Come the week your school is on spring break.</p>
        <div class="grid-3 tight">${WEEKS.map(w => { const W = D.weeks[w]; return `<a class="card wk-link ${tint(+w)}${+w === 2 ? ' hot' : ''}" href="/week-${w}/"><span class="pk-week">Week ${w} · ${pill(w)}</span><span class="wl-d">${W.label}</span><span class="wl-n">Parties ${W.nightsShort}<br>Party Pack $${W.pack} · singles $${W.singlesFrom}–$${W.singlesTo}</span><span class="wl-go">Week ${w} lineup and schools</span></a>`; }).join('')}</div>`)}
${sec('packs', 'How the Party Packs work', `<p>A Party Pack is one ticket for every event in one week. You buy it on Eventbrite by choosing the pack for your week.</p>
        <ul class="bul">${WEEKS.map(w => { const W = D.weeks[w]; return `<li><b>Week ${w} Party Pack: $${W.pack}.</b> Covers all ${PARTIES[w].length} Week ${w} events. Bought one by one, the same tickets come to about $${W.separately}.</li>`; }).join('')}
          <li><b>Single tickets</b> start at $${SINGLES_MIN}, and the Friday brunch is free with a ticket.</li>
          <li><b>Prices are before fees.</b> Eventbrite adds its fees at checkout.</li></ul>
        <p><a class="btn btn-sun" href="${EB}?aff=${aff}_packs">See the packs on Eventbrite</a></p>`)}
${sec('lineup', 'The lineup', `<p>The same four nights run every week. 21+ events are listed first each night. Prices are single tickets before fees; each week's page has the full night-by-night lineup.</p>
        <div class="pattern">${dows.map(d => `<div class="pat-day"><h3>${d}</h3><ul>${slots.filter(s => s.dow === d).sort((a, b) => (b.adult - a.adult) || (a.i - b.i)).map(s => `<li><span class="pn">${esc(s.n)}${s.adult ? ' <em>21+</em>' : ''}</span><span class="pp">${priceTxt(s)}</span><span class="pd">${esc(D.parties[s.n])}</span></li>`).join('')}</ul></div>`).join('')}</div>`)}
${sec('age', '21+ rules', `<p>Events are 18+ unless marked 21+. These are 21+ every week:</p>
        <ul class="bul">${[...new Set(PARTIES['1'].filter(p => p.adult).map(p => `${p.day.split(',')[0]}: ${p.name}`))].map(t => `<li>${esc(t)}</li>`).join('')}</ul>
        <p>Bring a valid government ID to every 21+ event. For the Booze Boat, the ID is checked at the dock, boarding starts 20 minutes before departure, and the boat does not wait.</p>`)}
${sec('addresses', 'How the addresses drop', `<p>Mansion and pool party locations stay private until the week of each event. Then the addresses go to ticket holders by email and into the <a href="${GM}">official Houston Spring Break GroupMe</a>, along with day-of updates. Buy your ticket, join the GroupMe, and the address comes to you.</p>
        <p><a class="btn btn-aqua" href="${GM}">Join the GroupMe</a></p>`)}
${sec('refunds', 'Refunds', `<p>${refundA(aff + '_refund')}</p>`)}
${sec('pick', 'Pick your week', `<p>The official 2027 School List puts every school on the week that matches its spring break. Search your school, or open a week to see which schools are on it.</p>
        ${finderForm()}
        <h3 class="mini-h">HBCUs by week</h3>
        ${WEEKS.map(w => { const l = hbAll.filter(s => s.week === +w); return l.length ? `<p class="bywk"><a href="/week-${w}/"><b>Week ${w}</b></a>: ${l.map(s => `<a href="/schools/${s.slug}/">${esc(s.short)}</a>`).join(', ')}</p>` : ''; }).join('')}
        <h3 class="mini-h">Texas schools by week</h3>
        ${WEEKS.map(w => { const l = [...S.filter(s => s.texas && s.hbcu && s.week === +w), ...txAll.filter(s => s.week === +w)]; return l.length ? `<p class="bywk"><a href="/week-${w}/"><b>Week ${w}</b></a>: ${l.map(s => `<a href="/schools/${s.slug}/">${esc(s.short)}</a>`).join(', ')}</p>` : ''; }).join('')}
        <p class="fine">200+ schools are on the full list; the <a href="/#school-list">official flyers</a> show all of them. The dates printed on the flyers are school spring-break weeks. Houston Spring Break is an independent event, not affiliated with or endorsed by any school.</p>`)}
${sec('travel', 'Getting to and around Houston', `<ul class="bul">
          <li><b>Two airports.</b> Houston is served by George Bush Intercontinental (IAH) and William P. Hobby (HOU). Compare flights into both.</li>
          <li><b>Plan your rides.</b> Rideshare apps operate across Houston. Venues are announced the week of each event, so set your rides once the addresses drop in the GroupMe.</li>
          <li><b>Bring a valid ID.</b> You need a valid government ID for every 21+ event.</li>
        </ul>`)}
  <section id="faq" aria-labelledby="faq-h">
    <div class="wrap">
      <div class="panel">
        <h2 id="faq-h">Houston spring break FAQ</h2>
        ${faqBlock(qs)}
      </div>
    </div>
  </section>
  <section>
    <div class="wrap">
      <div class="panel">
        <h2>Ready for Houston?</h2>
        <p class="lede">Pick your week, grab the pack, then join the GroupMe so you get the addresses.</p>
        <div class="cta-row">
          <a class="btn btn-sun btn-lg" href="${EB}?aff=${aff}_final">Get Tickets · packs from $${PACK_MIN}</a>
          <a class="btn btn-aqua btn-lg" href="${GM}">Join the GroupMe</a>
        </div>
        ${planLinks(GUIDE)}
      </div>
    </div>
  </section>`;
  return page({ title, desc, canonical: url, jsonld, aff, body, scripts: '<script src="/js/finder.js" defer></script>\n' });
}

// ---------- home: generated regions inside the hand-written index.html ----------
function homeRegions(html) {
  const graph = { '@context': 'https://schema.org', '@graph': [orgNode(), siteNode(), seriesNode(), ...WEEKS.map(weekNode), ...ALL_PARTIES.map(partyNode)] };
  const ld = `<script type="application/ld+json">\n${JSON.stringify(graph, null, 1)}\n</script>`;
  const lineup = `<div class="lineup-grid">${WEEKS.map(w => lineupCard(w, { h: 'h3', btn: true, aff: `site_lineup_w${w}` })).join('')}</div>`;
  const put = (h, name, content) => {
    const re = new RegExp(`(<!-- BUILD:${name} -->)[\\s\\S]*?(<!-- /BUILD:${name} -->)`);
    if (!re.test(h)) throw new Error(`index.html is missing the BUILD:${name} markers`);
    return h.replace(re, (_, open, close) => `${open}\n${content}\n${close}`);   // function replacer: '$' in prices must stay literal
  };
  return put(put(html, 'ld', ld), 'lineup', lineup);
}

// ---------- write ----------
const out = {};                                    // url path -> html
out['/schools/'] = indexPage();
for (const s of S) out[`/schools/${s.slug}/`] = schoolPage(s);
for (const w of WEEKS) out[`/week-${w}/`] = weekPage(w);
out[GUIDE] = guidePage();

for (const dir of ['schools', 'week-1', 'week-2', 'week-3', GUIDE.replace(/\//g, '')]) {
  const p = path.join(ROOT, dir); if (existsSync(p)) rmSync(p, { recursive: true });
}
for (const [u, html] of Object.entries(out)) {
  const dir = path.join(ROOT, u); mkdirSync(dir, { recursive: true }); writeFileSync(path.join(dir, 'index.html'), html);
}
const pub = { eventbrite: EB, weeks: Object.fromEntries(Object.entries(D.weeks).map(([k, w]) => [k, { label: w.label, nightsShort: w.nightsShort, pack: w.pack }])),
  schools: S.map(s => ({ n: s.name, k: s.short, s: s.slug, w: s.week, a: s.aka })) };
writeFileSync(path.join(ROOT, 'schools', 'schools.json'), JSON.stringify(pub));
const homePath = path.join(ROOT, 'index.html');
writeFileSync(homePath, homeRegions(readFileSync(homePath, 'utf8')));

// ---------- sitemap with real lastmod (content hash; the date moves only when a page's HTML changes) ----------
const LM_PATH = path.join(ROOT, '_src/lastmod.json');
const LM = existsSync(LM_PATH) ? JSON.parse(readFileSync(LM_PATH, 'utf8')) : {};
const fileOf = u => path.join(ROOT, u, 'index.html');
const urls = [['/', '1.0'], [GUIDE, '0.9'], ...WEEKS.map(w => [`/week-${w}/`, '0.9']), ['/schools/', '0.8'], ['/links/', '0.5'], ...S.map(s => [`/schools/${s.slug}/`, '0.7'])];
for (const [u] of urls) {
  const h = createHash('sha1').update(readFileSync(fileOf(u))).digest('hex').slice(0, 16);
  if (!LM[u] || LM[u].h !== h) LM[u] = { h, d: TODAY };
}
writeFileSync(LM_PATH, JSON.stringify(Object.fromEntries(Object.entries(LM).sort()), null, 1) + '\n');
const img = ['school-list-2027', 'school-list-week-1', 'school-list-week-2', 'school-list-week-3'].map(n => `    <image:image><image:loc>${SITE}/img/${n}.jpg</image:loc></image:image>`).join('\n');
const wimg = w => `    <image:image><image:loc>${SITE}/img/school-list-week-${w}.jpg</image:loc></image:image>\n`;
const u = (loc, pri, extra = '') => `  <url>\n    <loc>${SITE}${loc}</loc>\n    <lastmod>${LM[loc].d}</lastmod>\n    <priority>${pri}</priority>\n${extra}  </url>`;
writeFileSync(path.join(ROOT, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${urls.map(([l, p]) => u(l, p, l === '/' ? img + '\n' : /^\/week-\d\/$/.test(l) ? wimg(l[6]) : '')).join('\n')}
</urlset>
`);
console.log(`built ${S.length} school pages + index · 3 week pages · guide · home regions · ${ALL_PARTIES.length} party events checked against Eventbrite (read ${EBD.read_at}) · sitemap ${urls.length} urls`);
for (const s of S) { const t = titleFor(s); if (t.length > 60) console.warn('TITLE >60', t.length, t); }
