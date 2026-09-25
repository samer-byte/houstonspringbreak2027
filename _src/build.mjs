#!/usr/bin/env node
// Builds the "Find your school" pages from _src/schools.json.
//   node _src/build.mjs
// Writes: schools/index.html · schools/<slug>/index.html · schools/schools.json · sitemap.xml
// _src/ is not published (GitHub Pages' Jekyll build skips folders that start with "_").
// Rule: never state a school's academic-calendar dates. A page only says which week of the
// official 2027 School List the school is on, plus that week's party nights, lineup and pack.
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://houstonspringbreak2027.com';
const TODAY = process.env.LASTMOD || new Date().toISOString().slice(0, 10);
const D = JSON.parse(readFileSync(path.join(ROOT, '_src/schools.json'), 'utf8'));
const EB = D.eventbrite, GM = D.groupme, POSH = D.posh;

const esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const slug = n => n.toLowerCase().replace(/&/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const tint = w => ({ 1: 'c-sun', 2: 'c-rose', 3: 'c-aqua' })[w];
const S = D.schools.map(s => ({ ...s, slug: slug(s.name) }));
const slugs = new Set(S.map(s => s.slug)); if (slugs.size !== S.length) throw new Error('duplicate slug');
const HBCU_N = S.filter(s => s.hbcu).length, TX_N = S.filter(s => s.texas).length;

// ---------- shared fragments ----------
const SKYLINE = `<svg viewBox="0 0 1200 200" preserveAspectRatio="none"><g fill="#2a1436"><rect x="40" y="120" width="34" height="80"/><rect x="82" y="86" width="26" height="114"/><rect x="118" y="140" width="40" height="60"/><rect x="168" y="60" width="30" height="140"/><polygon points="168,60 183,34 198,60"/><rect x="212" y="110" width="44" height="90"/><rect x="266" y="70" width="24" height="130"/><rect x="300" y="128" width="52" height="72"/><rect x="360" y="44" width="34" height="156"/><polygon points="360,44 377,16 394,44"/><rect x="404" y="100" width="28" height="100"/><rect x="442" y="132" width="46" height="68"/><rect x="498" y="78" width="30" height="122"/><rect x="536" y="116" width="38" height="84"/><rect x="584" y="54" width="36" height="146"/><rect x="630" y="124" width="30" height="76"/><rect x="672" y="92" width="42" height="108"/><rect x="722" y="138" width="34" height="62"/><rect x="766" y="66" width="28" height="134"/><polygon points="766,66 780,40 794,66"/><rect x="806" y="118" width="48" height="82"/><rect x="866" y="88" width="26" height="112"/><rect x="902" y="134" width="40" height="66"/><rect x="952" y="74" width="32" height="126"/><rect x="994" y="126" width="44" height="74"/><rect x="1048" y="98" width="28" height="102"/><rect x="1086" y="140" width="52" height="60"/><rect x="1148" y="110" width="30" height="90"/></g></svg>`;
const PALM_L = `<svg class="p-l" viewBox="-10 240 270 460" preserveAspectRatio="xMinYMax meet"><g fill="#150a24"><path d="M112 700 C108 560 104 470 84 392 l24 -6 c20 84 26 180 28 314 z"/><path d="M100 392 C60 350 22 336 -8 344 c34 -28 84 -22 116 18 z"/><path d="M104 388 C82 330 44 296 6 286 c48 -6 92 26 112 92 z"/><path d="M110 384 C118 320 154 276 200 258 c-30 40 -58 74 -70 130 z"/><path d="M116 390 C160 356 214 350 254 368 c-48 -4 -92 6 -126 36 z"/><path d="M108 386 C96 338 96 288 116 246 c10 46 8 94 6 142 z"/><circle cx="106" cy="392" r="9"/><circle cx="122" cy="398" r="7"/></g></svg>`;
const PALM_R = `<svg class="p-r" viewBox="950 250 275 450" preserveAspectRatio="xMaxYMax meet"><g fill="#150a24"><path d="M1088 700 C1094 574 1102 486 1124 414 l-24 -8 c-22 78 -30 168 -34 294 z"/><path d="M1108 410 C1150 366 1192 352 1222 362 c-36 -28 -88 -20 -118 20 z"/><path d="M1104 406 C1128 348 1166 314 1204 304 c-48 -8 -94 24 -114 90 z"/><path d="M1098 402 C1088 338 1052 294 1006 276 c30 40 58 74 70 130 z"/><path d="M1092 408 C1048 374 994 368 954 386 c48 -4 92 6 126 36 z"/><circle cx="1102" cy="410" r="9"/><circle cx="1086" cy="416" r="7"/></g></svg>`;
const SCENE = `<div class="scene" aria-hidden="true"><div class="s-glow"></div><div class="s-sun"></div><div class="s-skyline">${SKYLINE}</div><div class="s-water"></div><div class="s-palms">${PALM_L}${PALM_R}</div><div class="s-grain"></div></div>`;

const head = ({ title, desc, canonical, jsonld }) => `<!doctype html>
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
<meta property="og:image" content="${SITE}/img/school-list-2027.jpg">
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
      <li><a href="/schools/">Find your school</a></li>
      <li><a href="/#school-list">2027 School List flyers</a></li>
      <li><a href="/#lineup">Lineup, day by day</a></li>
      <li><a href="/#faq">FAQ</a></li>
      <li><a href="/links/">All links</a></li>
      <li><a href="https://www.instagram.com/houston_springbreak">Instagram</a></li>
    </ul>
    <p class="foot-base">Presented by @houston_springbreak · Houston Spring Break 2027 · Houston, TX<br>An independent event. Not affiliated with or endorsed by any college or university.</p>
  </div>
</footer>`;

const finderForm = (aff = '') => `<form class="finder" data-finder action="/schools/" method="get" role="search">
      <label for="find">Find your school</label>
      <input id="find" name="q" type="search" autocomplete="off" spellcheck="false" placeholder="Your school, e.g. Howard or UH" aria-describedby="find-status">
      <p id="find-status" class="sr" data-finder-status role="status" aria-live="polite"></p>
      <div id="find-out" data-finder-out></div>
    </form>`;

const lineupCard = w => {
  const W = D.weeks[w];
  const days = W.days.map(([day, items]) => `<div class="day"><h4>${day}</h4><ul>${items.map(([n, adult, p]) => `<li><span>${esc(n)}${adult ? ' <em>21+</em>' : ''}</span><span class="price">${p}</span></li>`).join('')}</ul></div>`).join('');
  return `<article class="card lw ${tint(+w)}${+w === 2 ? ' hot' : ''}"><h3>Week ${w} lineup<span>Parties ${W.nightsShort}</span></h3>${days}<p class="fine">Single tickets before fees. 21+ events are marked; everything else is 18+.</p></article>`;
};
const adultList = w => {
  const seen = [];
  D.weeks[w].days.forEach(([day, items]) => items.forEach(([n, a]) => { if (a) seen.push(`${day.split(',')[0]} ${n}`); }));
  return seen;
};
const refundQ = ['Can I get a refund?', 'Refunds are available up to 7 days before the event, under the refund policy on the Eventbrite listing. Request a refund from your Eventbrite order; it goes back to your original payment method.'];

const faqBlock = qs => `<div class="faq-list">${qs.map(([q, a], i) => `<details class="faq-q"${i === 0 ? ' open' : ''}><summary><h3>${esc(q)}</h3></summary><p>${a}</p></details>`).join('')}</div>`;
const faqLd = (id, qs) => ({ '@type': 'FAQPage', '@id': id, mainEntity: qs.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&') } })) });

// ---------- school page ----------
function titleFor(s) {
  const c = [`${s.name} Spring Break 2027 in Houston | Week ${s.week}`, `${s.name} Spring Break 2027 | Houston Week ${s.week}`,
    `${s.short} Spring Break 2027 in Houston | Week ${s.week}`, `${s.short} Spring Break 2027 | Houston Week ${s.week}`];
  return c.find(t => t.length <= 60) || c[3];
}
function schoolPage(s) {
  const W = D.weeks[s.week], url = `${SITE}/schools/${s.slug}/`, aff = `site_s_${s.id}`;
  const group = [s.hbcu && `one of ${HBCU_N} HBCUs`, s.texas && `one of ${TX_N} Texas schools`].filter(Boolean).join(' and ');
  const mates = S.filter(o => o.week === s.week && o.id !== s.id);
  const title = titleFor(s);
  const desc = [`${s.name} is on Week ${s.week} of the official Houston Spring Break 2027 School List. Parties ${W.nightsShort}. Party Pack $${W.pack}.`,
    `${s.short} is on Week ${s.week} of the official Houston Spring Break 2027 School List. Parties ${W.nightsShort}. Party Pack $${W.pack}.`].find(t => t.length <= 160) || '';
  if (!desc) throw new Error('desc too long: ' + s.name);
  const adults = adultList(s.week);
  const qs = [
    [`When should ${s.short} students come to Houston Spring Break 2027?`, `${esc(s.name)} is on Week ${s.week} of the official 2027 School List, so plan on Week ${s.week}: parties run ${W.nights}, 2027. The School List groups schools by spring-break week, so confirm your exact break dates on ${esc(s.name)}’s official academic calendar.`],
    [`What does the Week ${s.week} Party Pack cover?`, `Every event in Week ${s.week} for $${W.pack} before fees. Bought separately, the same events come to about $${W.separately}. Single party tickets start at $20. <a href="${EB}?aff=${aff}">Get the pack on Eventbrite</a>.`],
    ['How do I get the party addresses?', `Addresses are announced the week of each event. They are sent to ticket holders and posted in the <a href="${GM}">official Houston Spring Break GroupMe</a>.`],
    ['What is the age requirement?', `Events are 18+ unless marked 21+. In Week ${s.week} the 21+ events are ${adults.slice(0, -1).join(', ')} and ${adults.slice(-1)}.`],
    refundQ,
  ];
  const jsonld = { '@context': 'https://schema.org', '@graph': [
    { '@type': 'WebPage', '@id': url, url, name: title, description: desc, isPartOf: { '@id': `${SITE}/#website` }, about: { '@id': `${SITE}/#week-${s.week}` }, breadcrumb: { '@id': `${url}#breadcrumb` } },
    { '@type': 'BreadcrumbList', '@id': `${url}#breadcrumb`, itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Houston Spring Break 2027', item: `${SITE}/` },
      { '@type': 'ListItem', position: 2, name: 'Find your school', item: `${SITE}/schools/` },
      { '@type': 'ListItem', position: 3, name: s.name, item: url }] },
    faqLd(`${url}#faq`, qs),
  ] };
  return `${head({ title, desc, canonical: url, jsonld })}
<body>
<a class="skip" href="#main">Skip to content</a>
${SCENE}
${bar(aff)}
<main id="main">
  <div class="wrap">
    <nav class="crumbs" aria-label="Breadcrumb"><ol><li><a href="/">Home</a></li><li><a href="/schools/">Find your school</a></li><li aria-current="page">${esc(s.short)}</li></ol></nav>
  </div>
  <section class="head">
    <div class="wrap">
      <div class="panel">
        <p class="eyebrow">Week ${s.week} · 2027 School List</p>
        <h1>${esc(s.name)} <span class="h1-sub">Spring Break 2027 in Houston</span></h1>
        <p class="lede">${esc(s.name)} is on <b>Week ${s.week}</b> of the official Houston Spring Break 2027 School List. Week ${s.week} parties run <b>${W.nights}, 2027</b>. ${W.note}</p>
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
      <h2 id="wk-h" class="sec-h">Your week: Week ${s.week}</h2>
      <div class="grid-2">
        <article class="card pack ${tint(s.week)}${s.week === 2 ? ' hot' : ''}">
          <p class="pk-week">Week ${s.week}</p>
          <p class="pk-amt">$${W.pack}<span>Party Pack</span></p>
          <p class="pk-note">Covers every event that week. About $${W.separately} if you bought each party separately. Prices before fees.</p>
          <a class="btn btn-sun" href="${EB}?aff=${aff}">Get the Week ${s.week} Pack</a>
          <p class="fine">Addresses drop in the <a class="ul" href="${GM}">official GroupMe</a> the week of each event.</p>
        </article>
        ${lineupCard(s.week)}
      </div>
    </div>
  </section>
  <section aria-labelledby="mates-h">
    <div class="wrap">
      <div class="panel">
        <h2 id="mates-h">Also on Week ${s.week}</h2>
        <p class="lede">${esc(s.name)} is ${group} on the 2027 School List. Other HBCUs and Texas schools on Week ${s.week}:</p>
        <ul class="sl">${mates.map(o => `<li><a href="/schools/${o.slug}/">${esc(o.short)}</a></li>`).join('')}</ul>
        <p class="fine">200+ schools are on the full list. <a href="/#school-list">See the official flyers</a> or <a href="/schools/">find another school</a>.</p>
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
      </div>
    </div>
  </section>
</main>
${footer}
</body>
</html>
`;
}

// ---------- index page ----------
function indexPage() {
  const url = `${SITE}/schools/`;
  const title = 'Find Your School | Houston Spring Break 2027 School List';
  const desc = `Find your school's week for Houston Spring Break 2027: ${HBCU_N} HBCUs and ${TX_N} Texas schools on the official 2027 School List, with party dates and Party Packs for each week.`;
  const weekCard = w => {
    const W = D.weeks[w], inW = S.filter(s => s.week === +w);
    const hb = inW.filter(s => s.hbcu), tx = inW.filter(s => s.texas && !s.hbcu);
    const list = arr => `<ul class="sl">${arr.map(s => `<li><a href="/schools/${s.slug}/">${esc(s.short)}</a></li>`).join('')}</ul>`;
    return `<article class="card wk ${tint(+w)}${+w === 2 ? ' hot' : ''}" id="week-${w}">
        <p class="pk-week">${+w === 2 ? 'Biggest week' : 'School List'}</p>
        <h2>Week ${w}</h2>
        <p class="fr-w">Parties ${W.nightsShort}</p>
        ${hb.length ? `<h3>HBCUs</h3>${list(hb)}` : ''}
        ${tx.length ? `<h3>Texas schools</h3>${list(tx)}` : ''}
        <a class="btn btn-sun" href="${EB}?aff=site_schools_w${w}">Get the Week ${w} Pack · $${W.pack}</a>
      </article>`;
  };
  const jsonld = { '@context': 'https://schema.org', '@graph': [
    { '@type': 'CollectionPage', '@id': url, url, name: title, description: desc, isPartOf: { '@id': `${SITE}/#website` }, breadcrumb: { '@id': `${url}#breadcrumb` },
      mainEntity: { '@type': 'ItemList', numberOfItems: S.length, itemListElement: S.map((s, i) => ({ '@type': 'ListItem', position: i + 1, url: `${SITE}/schools/${s.slug}/`, name: s.name })) } },
    { '@type': 'BreadcrumbList', '@id': `${url}#breadcrumb`, itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Houston Spring Break 2027', item: `${SITE}/` },
      { '@type': 'ListItem', position: 2, name: 'Find your school', item: url }] },
  ] };
  return `${head({ title, desc, canonical: url, jsonld })}
<body>
<a class="skip" href="#main">Skip to content</a>
${SCENE}
${bar('site_schools_bar')}
<main id="main">
  <div class="wrap">
    <nav class="crumbs" aria-label="Breadcrumb"><ol><li><a href="/">Home</a></li><li aria-current="page">Find your school</li></ol></nav>
  </div>
  <section class="head">
    <div class="wrap">
      <div class="panel">
        <p class="eyebrow">Official 2027 School List</p>
        <h1>Find Your School <span class="h1-sub">Houston Spring Break 2027</span></h1>
        <p class="lede">The official 2027 School List puts every school on one of three weeks. Search the HBCUs and Texas schools on the list, then lock in that week's Party Pack and join the GroupMe.</p>
        ${finderForm()}
        <script>try{var q=new URLSearchParams(location.search).get('q');if(q)document.getElementById('find').value=q.slice(0,60)}catch(e){}</script>
        <p class="fine">Pages below cover the ${HBCU_N} HBCUs and ${TX_N} Texas schools named on the list. 200+ schools are on the full list: <a href="/#school-list">see the official flyers</a>. The dates printed on the flyers are school spring-break weeks; party nights are Thursday to Sunday of each week. Houston Spring Break is an independent event, not affiliated with or endorsed by any school.</p>
      </div>
    </div>
  </section>
  <section aria-label="Schools by week">
    <div class="wrap">
      <div class="grid-3">
        ${['1', '2', '3'].map(weekCard).join('\n        ')}
      </div>
    </div>
  </section>
</main>
${footer}
<script src="/js/finder.js" defer></script>
</body>
</html>
`;
}

// ---------- write ----------
const outDir = path.join(ROOT, 'schools');
if (existsSync(outDir)) rmSync(outDir, { recursive: true });
mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, 'index.html'), indexPage());
for (const s of S) {
  mkdirSync(path.join(outDir, s.slug), { recursive: true });
  writeFileSync(path.join(outDir, s.slug, 'index.html'), schoolPage(s));
}
const pub = { eventbrite: EB, weeks: Object.fromEntries(Object.entries(D.weeks).map(([k, w]) => [k, { label: w.label, nightsShort: w.nightsShort, pack: w.pack }])),
  schools: S.map(s => ({ n: s.name, k: s.short, s: s.slug, w: s.week, a: s.aka })) };
writeFileSync(path.join(outDir, 'schools.json'), JSON.stringify(pub));

const img = ['school-list-2027', 'school-list-week-1', 'school-list-week-2', 'school-list-week-3'].map(n => `    <image:image><image:loc>${SITE}/img/${n}.jpg</image:loc></image:image>`).join('\n');
const u = (loc, pri, extra = '') => `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${TODAY}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>${pri}</priority>\n${extra}  </url>`;
writeFileSync(path.join(ROOT, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${[u(`${SITE}/`, '1.0', img + '\n'), u(`${SITE}/schools/`, '0.8'), u(`${SITE}/links/`, '0.6'), ...S.map(s => u(`${SITE}/schools/${s.slug}/`, '0.7'))].join('\n')}
</urlset>
`);
console.log(`built ${S.length} school pages + index · ${HBCU_N} HBCU · ${TX_N} Texas · sitemap ${S.length + 3} urls · lastmod ${TODAY}`);
for (const s of S) { const t = titleFor(s); if (t.length > 60) console.warn('TITLE >60', t.length, t); }
