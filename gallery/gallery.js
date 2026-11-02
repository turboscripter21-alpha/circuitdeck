// CircuitDeck gallery: renders /gallery/data.json (built by _tools/gallery-data.mjs) with track,
// difficulty and text filters. The filters live in the query string so a filtered view can be shared.
(() => {
  const TRACK = { esp32: 'ESP32', pi5: 'Pi 5', tinyml: 'TinyML', sandbox: 'Sandbox' };
  const grid = document.getElementById('g-grid');
  const empty = document.getElementById('g-empty');
  const count = document.getElementById('g-count');
  const q = document.getElementById('g-q');
  const params = new URLSearchParams(location.search);
  // m8: only known values (any case); anything else falls back to "all"
  const pick = (v, list) => list.find((x) => x.toLowerCase() === String(v || '').trim().toLowerCase()) || 'all';
  const state = { track: pick(params.get('track'), Object.keys(TRACK)), level: pick(params.get('level'), ['Beginner', 'Intermediate', 'Advanced']), q: (params.get('q') || '').slice(0, 80) };
  const readDone = (k) => { try { const v = JSON.parse(localStorage.getItem(k) || '[]'); return new Set(Array.isArray(v) ? v : Object.keys(v || {})); } catch { return new Set(); } };
  const done = { esp32: readDone('learn-esp32:done'), pi5: readDone('circuitdeck:pi5:done'), tinyml: readDone('circuitdeck:tinyml:done'), sandbox: new Set() };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  let items = [];
  let cards = [];

  function card(it) {
    const a = document.createElement('a');
    a.className = 'card';
    a.href = it.href;
    a.dataset.track = it.track;
    a.dataset.level = it.difficulty;
    a.dataset.text = [it.title, it.short, ...(it.topics || []), TRACK[it.track], it.difficulty].join(' ').toLowerCase();
    const kind = it.track === 'esp32' ? 'Lesson' : it.track === 'pi5' || it.track === 'tinyml' ? 'Project' : 'Template';
    const foot = it.track === 'sandbox' ? `Opens in the sandbox · ${it.board === 'pi5' ? 'Pi 5' : 'ESP32'}` : [kind + ' ' + it.n, it.time].filter(Boolean).join(' · ');
    a.innerHTML = `
      <div class="card-thumb"><img src="${esc(it.thumb)}" alt="" loading="lazy" decoding="async" width="320" height="200" /></div>
      <div class="card-body">
        <div class="card-meta"><span class="tag t-${it.track}">${TRACK[it.track]}</span><span class="lvl lvl-${esc(it.difficulty)}">${esc(it.difficulty)}</span></div>
        <h3>${it.track !== 'sandbox' ? `<small>${it.n}.</small>` : ''}${esc(it.title)}</h3>
        ${it.short ? `<p>${esc(it.short)}</p>` : ''}
        <div class="card-foot">${esc(foot)}</div>
      </div>
      ${done[it.track].has(it.id) ? '<span class="done" title="Completed"><svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg></span>' : ''}`;
    a.setAttribute('aria-label', `${TRACK[it.track]} ${kind.toLowerCase()}: ${it.title} (${it.difficulty})`);
    return a;
  }

  function apply() {
    const words = state.q.toLowerCase().split(/\s+/).filter(Boolean);
    let n = 0;
    for (const c of cards) {
      const ok = (state.track === 'all' || c.dataset.track === state.track)
        && (state.level === 'all' || c.dataset.level === state.level)
        && words.every((w) => c.dataset.text.includes(w));
      c.hidden = !ok;
      if (ok) n++;
    }
    count.textContent = `${n} of ${cards.length}`;
    empty.hidden = n > 0;
    for (const g of document.querySelectorAll('[data-filter]')) {
      for (const b of g.querySelectorAll('.chip')) b.setAttribute('aria-pressed', String(b.dataset.v === state[g.dataset.filter]));
    }
    const p = new URLSearchParams();
    if (state.track !== 'all') p.set('track', state.track);
    if (state.level !== 'all') p.set('level', state.level);
    if (state.q) p.set('q', state.q);
    const qs = p.toString();
    history.replaceState(null, '', location.pathname + (qs ? '?' + qs : ''));
  }

  for (const g of document.querySelectorAll('[data-filter]')) {
    g.addEventListener('click', (e) => {
      const b = e.target.closest('.chip');
      if (!b) return;
      state[g.dataset.filter] = b.dataset.v;
      apply();
    });
  }
  q.value = state.q;
  q.addEventListener('input', () => { state.q = q.value.trim(); apply(); });

  fetch('/gallery/data.json')
    .then((r) => r.json())
    .then((data) => {
      items = data;
      for (const t of Object.keys(TRACK)) {
        const el = document.getElementById('n-' + t);
        if (el) el.textContent = items.filter((x) => x.track === t).length;
      }
      cards = items.map(card);
      grid.append(...cards);
      apply();
      window.__gallery = { items, state, apply };
    })
    .catch(() => { empty.hidden = false; empty.textContent = 'Could not load the gallery.'; });
})();
