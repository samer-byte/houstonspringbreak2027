/* Find your school — Houston Spring Break 2027.
   Any <form data-finder> with an <input> and a [data-finder-out] region becomes a type-ahead over
   /schools/schools.json (the HBCU + Texas schools on the official 2027 School List).
   Without JS the form submits to /schools/ (the full index). */
(function () {
  var forms = document.querySelectorAll('form[data-finder]');
  if (!forms.length) return;
  var data = null, loading = null;

  function load() {
    if (data) return Promise.resolve(data);
    if (!loading) loading = fetch('/schools/schools.json').then(function (r) { return r.json(); })
      .then(function (d) { data = d; d.schools.forEach(function (s) { s._k = [s.n, s.k].concat(s.a || []).map(norm); }); return d; })
      .catch(function () { loading = null; return null; });
    return loading;
  }
  function norm(t) { return String(t).toLowerCase().replace(/&/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim(); }
  function esc(t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  function score(s, q) {
    var best = 0;
    s._k.forEach(function (k, i) {
      var v = 0;
      if (k === q) v = 100;
      else if (k.indexOf(q) === 0) v = 80;
      else if ((' ' + k).indexOf(' ' + q) >= 0) v = 60;
      else if (q.length >= 3 && k.indexOf(q) >= 0) v = 40;
      if (v && i === 0) v += 1;      // prefer the full-name match on ties
      if (v > best) best = v;
    });
    return best;
  }

  function ranked(q) {
    q = norm(q);
    if (q.length < 2) return [];
    return data.schools.map(function (s) { return [score(s, q), s]; })
      .filter(function (x) { return x[0] > 0; })
      .sort(function (a, b) { return b[0] - a[0] || a[1].n.localeCompare(b[1].n); })
      .slice(0, 3);
  }
  function search(q) { return ranked(q).map(function (x) { return x[1]; }); }

  function card(s) {
    var w = data.weeks[s.w];
    return '<div class="fr"><p class="fr-n"><a href="/schools/' + s.s + '/">' + esc(s.n) + '</a></p>' +
      '<p class="fr-w"><b>Week ' + s.w + '</b> of the 2027 School List · parties ' + esc(w.nightsShort) + '</p>' +
      '<div class="fr-cta"><a class="btn btn-sun" href="' + data.eventbrite + '?aff=site_finder_w' + s.w + '">Get the Week ' + s.w + ' Pack · $' + w.pack + '</a>' +
      '<a class="fr-more" href="/schools/' + s.s + '/">' + esc(s.k) + ' page</a></div></div>';
  }

  forms.forEach(function (form) {
    var input = form.querySelector('input'), out = form.querySelector('[data-finder-out]'), status = form.querySelector('[data-finder-status]');
    var list = form.getAttribute('data-finder-list') || '/#school-list';
    function render() {
      var q = input.value;
      if (!data) { load().then(function (d) { if (d) render(); }); return; }
      if (norm(q).length < 2) { out.innerHTML = ''; if (status) status.textContent = ''; return; }
      var r = search(q);
      out.innerHTML = r.length ? '<div class="fr-list">' + r.map(card).join('') + '</div><p class="fr-none">Not your school? This search covers the HBCUs and Texas schools on the list. <a href="' + list + '">See the official flyers</a> for all 200+ schools.</p>' :
        '<p class="fr-none">No school page for “' + esc(q) + '” yet. This search covers the HBCUs and Texas schools on the list. Check the <a href="' + list + '">official flyers</a> for all 200+ schools, or come the week that matches your spring break.</p>';
      if (status) status.textContent = r.length ? r.length + (r.length > 1 ? ' matches: ' : ' match: ') + r.map(function (s) { return s.n + ', Week ' + s.w; }).join('; ') : 'No school page found';
    }
    input.addEventListener('focus', load, { once: true });
    input.addEventListener('input', render);
    form.addEventListener('submit', function (e) {
      if (!data) return;               // let it go to /schools/ if the data never loaded
      e.preventDefault();
      var r = ranked(input.value);   // jump only on an exact name/short-name/abbreviation match
      if (r.length && r[0][0] >= 100 && (r.length === 1 || r[1][0] < 100)) location.href = '/schools/' + r[0][1].s + '/'; else render();
    });
    if (input.value) load().then(function (d) { if (d) render(); });
  });
})();
