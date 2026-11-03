// CircuitDeck AI layer: the tutor chat, editor help (Explain my code / Suggest a fix),
// run-failure hints, and the "Recommended next" card. Plain script, loaded by shared/chrome.js
// on every page, so the ESP32 bundle (assets/) is never touched: everything here reads the
// shared lesson DOM (.info-card, .code-card, .console-lines, .lessons) or a page-provided
// window.__cdAIContext() for richer context (Pi 5, sandbox, TinyML).
// All model calls go to /api/ai (a Vercel function); the API key never reaches the browser.
(() => {
  if (window.CircuitDeckAI) return;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clip = (s, n) => (s && s.length > n ? `${s.slice(0, n)}…` : s || '');
  const load = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
  const API = '/api/ai';
  const K = { runs: 'circuitdeck:runs', seen: 'circuitdeck:seen', recOff: 'circuitdeck:rec-hidden' };
  const DONE = { esp32: 'learn-esp32:done', pi5: 'circuitdeck:pi5:done', tinyml: 'circuitdeck:tinyml:done', sandbox: 'circuitdeck:sandbox:done', canvas: 'circuitdeck:canvas:done' };
  const TRACK_NAME = { esp32: 'ESP32', pi5: 'Pi 5', sandbox: 'Sandbox', tinyml: 'TinyML', canvas: 'Canvas' };
  const page = (() => { const p = location.pathname; if (p.startsWith('/pi5')) return 'pi5'; if (p.startsWith('/sandbox')) return 'sandbox'; if (p.startsWith('/canvas')) return 'canvas'; if (p.startsWith('/gallery')) return 'gallery'; if (p.startsWith('/tinyml')) return 'tinyml'; return 'esp32'; })();
  const LESSON_PAGE = page !== 'gallery';
  const ICON = {
    spark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l1.7 4.6 4.6 1.7-4.6 1.7L12 16.1l-1.7-4.6-4.6-1.7 4.6-1.7z"/><path d="M18.5 15l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    send: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12l16-8-6 16-2.5-6.5z"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6"/></svg>',
  };

  // ------------------------------------------------------------------ context
  function codeText() {
    const code = $('.code-card .code code');
    if (!code) return '';
    const lines = $$('.line', code);
    if (!lines.length) return code.innerText;
    return lines.map((l) => { const c = l.cloneNode(true); c.querySelector('.ln')?.remove(); return c.textContent.replace(/\u00a0/g, ' '); }).join('\n');
  }
  function outputText(n = 30) {
    const lines = $$('.console-lines > *').map((x) => x.textContent.trim()).filter(Boolean);
    return lines.slice(-n).join('\n');
  }
  function activeLesson() {
    const a = $('.lesson.is-active');
    const id = a?.dataset.id || (location.hash.replace(/^#/, '').split(/[&=]/)[0]) || '';
    const title = (a?.getAttribute('aria-label') || '').replace(/^(Lesson|Project)\s*\d+:\s*/i, '') || $('.info-content h1, .info-content h2')?.textContent || document.title;
    return { id, title };
  }
  function context() {
    let p = {};
    try { p = (window.__cdAIContext && window.__cdAIContext()) || {}; } catch {}
    const a = activeLesson();
    const ctx = {
      track: TRACK_NAME[p.track || page] || page,
      id: p.id || a.id,
      title: p.title || a.title,
      lesson: clip(p.lesson || $('.info-card .info-content')?.innerText || '', 3800),
      code: clip(p.code ?? codeText(), 7800),
      lang: p.lang || (page === 'pi5' ? 'python' : 'cpp'),
      output: clip(outputText(), 2400),
    };
    if (p.issues) ctx.issues = clip(p.issues, 2400);
    return ctx;
  }
  const keyOf = () => { let p = {}; try { p = window.__cdAIContext?.() || {}; } catch {} return `${p.track || page}:${p.id || activeLesson().id || 'main'}`; };

  // ------------------------------------------------------------------ API
  let status = null; // null unknown, true configured, false not configured
  async function checkStatus() {
    if (status !== null) return status;
    try { const r = await fetch(API, { headers: { Accept: 'application/json' } }); const j = r.ok ? await r.json() : {}; status = !!j.configured; }
    catch { status = false; }
    return status;
  }
  async function ask(body) {
    if (status === null) await checkStatus(); // ask before the first POST (e.g. Explain opened straight from the sandbox)
    if (status === false) return { notConfigured: true }; // known not configured: no request, no console 503
    let r;
    try {
      r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    } catch { return { error: 'Could not reach the AI service — check your connection.' }; }
    let j = {};
    try { j = await r.json(); } catch {}
    if (r.status === 404 || r.status === 501 || r.status === 503 || j.configured === false) { status = false; return { notConfigured: true }; }
    if (!r.ok || !j.text) return { error: j.error || `The AI could not answer (HTTP ${r.status}).` };
    status = true;
    return { text: j.text };
  }

  // ------------------------------------------------------------------ tiny markdown
  function md(src) {
    const out = [];
    const parts = String(src).split(/```/);
    parts.forEach((chunk, i) => {
      if (i % 2) { const nl = chunk.indexOf('\n'); const body = nl >= 0 && /^[\w+#-]*$/.test(chunk.slice(0, nl).trim()) ? chunk.slice(nl + 1) : chunk; out.push(`<pre><code>${esc(body.replace(/\n$/, ''))}</code></pre>`); return; }
      let list = null;
      const flush = () => { if (list) { out.push(`<${list.t}>${list.items.map((x) => `<li>${x}</li>`).join('')}</${list.t}>`); list = null; } };
      const inline = (s) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>');
      for (const raw of chunk.split('\n')) {
        const line = raw.trimEnd();
        const ul = line.match(/^\s*[-*•]\s+(.*)/), ol = line.match(/^\s*\d+[.)]\s+(.*)/);
        if (ul || ol) { const t = ul ? 'ul' : 'ol'; if (!list || list.t !== t) { flush(); list = { t, items: [] }; } list.items.push(inline((ul || ol)[1])); continue; }
        flush();
        if (!line.trim()) continue;
        const h = line.match(/^#{1,4}\s+(.*)/);
        out.push(h ? `<p><b>${inline(h[1])}</b></p>` : `<p>${inline(line)}</p>`);
      }
      flush();
    });
    return out.join('');
  }

  // ------------------------------------------------------------------ tutor panel
  const NOT_CONFIGURED = 'AI not configured yet — the site owner hasn’t connected the AI service. Everything else on CircuitDeck still works; try the lesson’s Example and Pinout tabs in the meantime.';
  const history = [];
  let panel, log, input, ctxLine, banner, busy = false;
  function build() {
    if (panel) return;
    panel = document.createElement('aside');
    panel.className = 'cd-ai';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'AI tutor');
    panel.hidden = true;
    panel.innerHTML = `
      <header class="cd-ai-head"><span class="cd-ai-badge">${ICON.spark}</span><div><b>AI tutor</b><small class="cd-ai-ctx"></small></div><button type="button" class="cd-ai-x" data-ai="close" aria-label="Close AI tutor">${ICON.close}</button></header>
      <p class="cd-ai-banner" hidden></p>
      <div class="cd-ai-log" aria-live="polite"></div>
      <div class="cd-ai-quick" role="group" aria-label="Quick questions">
        <button type="button" data-ai="explain">Explain my code</button>
        <button type="button" data-ai="fix">Suggest a fix</button>
        <button type="button" data-ai="hint">Hint for the last run</button>
      </div>
      <form class="cd-ai-form"><textarea rows="2" maxlength="1200" placeholder="Ask about this lesson, the wiring or the code…" aria-label="Your question"></textarea><button type="submit" class="cd-ai-send" aria-label="Send">${ICON.send}</button></form>
      <p class="cd-ai-note">AI answers can be wrong — check pin voltages before wiring real hardware. When you ask, this lesson’s text, your code and the last run output are sent to the AI.</p>`;
    document.body.appendChild(panel);
    log = $('.cd-ai-log', panel); input = $('textarea', panel); ctxLine = $('.cd-ai-ctx', panel); banner = $('.cd-ai-banner', panel);
    // the lesson pages have keyboard shortcuts (Space = run, WASD = pan): keep them out of the panel
    for (const ev of ['keydown', 'keyup', 'keypress', 'pointerdown', 'wheel', 'touchstart']) panel.addEventListener(ev, (e) => e.stopPropagation(), { passive: ev === 'wheel' || ev === 'touchstart' });
    panel.addEventListener('click', (e) => {
      const b = e.target.closest('[data-ai]');
      if (!b) return;
      const a = b.dataset.ai;
      if (a === 'close') close();
      else run(a);
    });
    $('form', panel).addEventListener('submit', (e) => { e.preventDefault(); const q = input.value.trim(); if (q) { input.value = ''; run('chat', q); } });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('form', panel).requestSubmit(); } if (e.key === 'Escape') close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) close(); });
  }
  function bubble(role, html, cls = '') {
    const d = document.createElement('div');
    d.className = `cd-ai-msg is-${role} ${cls}`.trim();
    d.innerHTML = html;
    log.appendChild(d);
    log.scrollTop = log.scrollHeight;
    return d;
  }
  function refreshCtx() {
    const c = context();
    const bits = [c.title && clip(c.title, 40), c.code && `${c.code.split('\n').length} lines of code`, c.output && 'last run output', c.issues && 'wiring checks'].filter(Boolean);
    ctxLine.textContent = bits.length ? `Using: ${bits.join(' · ')}` : 'Ask about electronics or code';
    $('[data-ai=hint]', panel).hidden = !lastFail;
    $('[data-ai=explain]', panel).hidden = $('[data-ai=fix]', panel).hidden = !c.code;
    return c;
  }
  async function open(opts = {}) {
    build();
    panel.hidden = false;
    document.documentElement.classList.add('cd-ai-open');
    hideToast();
    refreshCtx();
    if (!log.children.length) bubble('model', md(`Hi! I can explain this ${page === 'sandbox' ? 'circuit' : 'lesson'}, walk through the code, or help when a run fails. What would you like to know?`));
    checkStatus().then((ok) => { banner.hidden = ok; if (!ok) banner.textContent = NOT_CONFIGURED; });
    if (opts.mode && opts.mode !== 'chat') run(opts.mode, opts.question, opts);
    else if (opts.question) run('chat', opts.question, opts);
    else setTimeout(() => input.focus({ preventScroll: true }), 30);
  }
  function close() { if (!panel) return; panel.hidden = true; document.documentElement.classList.remove('cd-ai-open'); }
  const LABEL = { explain: 'Explain my code', fix: 'Suggest a fix', hint: 'Give me a hint for the last run', wiring: 'Explain the wiring checks' };
  async function run(mode, question = '', opts = {}) {
    if (busy) return;
    build();
    const c = refreshCtx();
    if (opts.issues) c.issues = clip(opts.issues, 2400);
    const shown = question || LABEL[mode] || '';
    bubble('user', esc(shown));
    const wait = bubble('model', '<span class="cd-ai-dots"><i></i><i></i><i></i></span>', 'is-wait');
    busy = true; panel.classList.add('is-busy');
    const res = await ask({ mode, question, context: c, history: history.slice(-6) });
    busy = false; panel.classList.remove('is-busy');
    wait.remove();
    if (res.notConfigured) { bubble('model', esc(NOT_CONFIGURED), 'is-note'); banner.hidden = false; banner.textContent = NOT_CONFIGURED; return; }
    if (res.error) { bubble('model', esc(res.error), 'is-note'); return; }
    history.push({ role: 'user', text: shown }, { role: 'model', text: res.text });
    bubble('model', md(res.text));
  }

  // ------------------------------------------------------------------ editor buttons
  function ensureCodeButton() {
    const actions = $('.code-card .code-actions');
    if (!actions || $('.cd-ai-code', actions)) return;
    const wrap = document.createElement('span');
    wrap.className = 'cd-ai-code';
    wrap.innerHTML = `<button type="button" class="btn-ghost cd-ai-btn" aria-haspopup="menu" aria-expanded="false" aria-label="AI help for this code" title="AI help">${ICON.spark}</button>
      <span class="cd-ai-menu" role="menu" hidden>
        <button type="button" role="menuitem" data-mode="explain">Explain my code</button>
        <button type="button" role="menuitem" data-mode="fix">Suggest a fix</button>
        <button type="button" role="menuitem" data-mode="chat">Ask the tutor…</button>
      </span>`;
    actions.insertBefore(wrap, actions.firstChild);
    const btn = $('.cd-ai-btn', wrap), menu = $('.cd-ai-menu', wrap);
    for (const ev of ['keydown', 'keyup', 'pointerdown']) wrap.addEventListener(ev, (e) => e.stopPropagation());
    btn.addEventListener('click', (e) => { e.stopPropagation(); const o = menu.hidden; menu.hidden = !o; btn.setAttribute('aria-expanded', String(o)); });
    menu.addEventListener('click', (e) => { const b = e.target.closest('[data-mode]'); if (!b) return; e.stopPropagation(); menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); open({ mode: b.dataset.mode }); });
    document.addEventListener('click', (e) => { if (!wrap.contains(e.target)) { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); } });
  }

  // ------------------------------------------------------------------ runs, failures, hints
  let lastFail = null, runKey = null, runFailed = false, toast;
  const ESP_FAIL = /\b(error|failed|not connected|missing|brownout|guru meditation|exception)\b/i;
  function recordRun() {
    runKey = keyOf(); runFailed = false; lastFail = null; hideToast();
    const runs = load(K.runs, {}); const r = runs[runKey] || { r: 0, f: 0 };
    r.r++; r.t = Date.now(); runs[runKey] = r; save(K.runs, runs);
  }
  function recordFail(text) {
    lastFail = { key: runKey || keyOf(), text };
    if (runFailed) return;
    runFailed = true;
    const runs = load(K.runs, {}); const k = lastFail.key; const r = runs[k] || { r: 1, f: 0 };
    r.f++; r.lf = Date.now(); runs[k] = r; save(K.runs, runs);
    setTimeout(() => showToast(text), 250);
  }
  function showToast(text) {
    if (panel && !panel.hidden) return;
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'cd-ai-toast';
      toast.setAttribute('role', 'status');
      document.body.appendChild(toast);
      toast.addEventListener('click', (e) => {
        const b = e.target.closest('[data-t]');
        if (!b) return;
        hideToast();
        if (b.dataset.t === 'hint') open({ mode: 'hint' });
        else if (b.dataset.t === 'fix') open({ mode: 'fix' });
      });
      for (const ev of ['keydown', 'pointerdown']) toast.addEventListener(ev, (e) => e.stopPropagation());
    }
    toast.innerHTML = `<span class="cd-ai-badge">${ICON.spark}</span><span class="cd-ai-toast-t"><b>That run hit a problem.</b><small>${esc(clip(text, 90))}</small></span><button type="button" data-t="hint">Get a hint</button><button type="button" data-t="fix" class="is-soft">Suggest a fix</button><button type="button" data-t="x" class="cd-ai-x" aria-label="Dismiss">${ICON.close}</button>`;
    toast.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(hideToast, 20000);
  }
  function hideToast() { if (toast) toast.hidden = true; }
  function watchConsole() {
    const mo = new MutationObserver((muts) => {
      for (const m of muts) for (const n of m.addedNodes) {
        if (n.nodeType !== 1 || !n.parentElement?.classList.contains('console-lines')) continue;
        const t = n.textContent.trim();
        const bad = n.classList.contains('cd-err') || (page === 'esp32' && ESP_FAIL.test(t));
        if (bad) recordFail(t);
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });
    // a run starts when Run is pressed while idle
    document.addEventListener('click', (e) => {
      const b = e.target.closest('.btn-run');
      if (!b) return;
      const card = b.closest('.code-card');
      if (card && card.dataset.state === 'running') return; // that click stops it
      recordRun();
    }, true);
  }
  function recordSeen() {
    const k = keyOf();
    if (!k || k.endsWith(':')) return;
    const seen = load(K.seen, {}); seen[k] = Date.now(); save(K.seen, seen);
  }

  // ------------------------------------------------------------------ recommendations (rule-based)
  let DATA = null;
  async function data() {
    if (DATA) return DATA;
    try { const r = await fetch('/gallery/data.json'); DATA = r.ok ? await r.json() : []; } catch { DATA = []; }
    return DATA;
  }
  function doneSets() {
    const out = {};
    for (const [t, k] of Object.entries(DONE)) out[t] = new Set(load(k, []));
    return out;
  }
  function recommend(items, now = Date.now()) {
    const done = doneSets(), runs = load(K.runs, {}), seen = load(K.seen, {});
    const byTrack = {};
    for (const it of items) (byTrack[it.track] ||= []).push(it);
    const totalDone = Object.values(done).reduce((a, s) => a + s.size, 0);
    // most recently active track
    const activity = {};
    for (const [k, v] of Object.entries({ ...seen, ...Object.fromEntries(Object.entries(runs).map(([k2, r]) => [k2, r.t || 0])) })) { const t = k.split(':')[0]; activity[t] = Math.max(activity[t] || 0, v || 0); }
    const active = Object.entries(activity).sort((a, b) => b[1] - a[1])[0]?.[0];
    const doneTopics = new Map();
    for (const it of items) if (done[it.track]?.has(it.id)) for (const tp of it.topics || []) doneTopics.set(tp, (doneTopics.get(tp) || 0) + 1);
    const scored = [];
    for (const [track, list] of Object.entries(byTrack)) {
      const d = done[track] || new Set();
      let last = -1;
      list.forEach((it, i) => { if (d.has(it.id)) last = i; });
      list.forEach((it, i) => {
        if (d.has(it.id)) return;
        const key = `${track}:${it.id}`, r = runs[key], why = [];
        let s = 0;
        if (track === 'sandbox') { s -= 20; if (totalDone >= 6) { s += 15; why.push(['Put what you learned together in the sandbox', 1]); } }
        if (i === last + 1 && track !== 'sandbox') { s += 50; why.push([last < 0 ? `Start of the ${TRACK_NAME[track]} track` : `Next in the ${TRACK_NAME[track]} track`, 50]); }
        if (i < last) { s += 28 + Math.min(8, last - i); why.push(['You skipped this one', 30]); }
        if (r?.f) { const fresh = now - (r.lf || 0) < 14 * 864e5; s += fresh ? 45 : 25; why.push([r.f > 1 ? `${r.f} runs hit a problem — have another go` : 'Your last run hit a problem — have another go', 45]); }
        else if (seen[key]) { s += 14; why.push(['You opened it but haven’t finished', 14]); }
        if (track === active) s += 20;
        if (track === page && i === last + 1) s += 40; // on a track's own page, its next project first
        if (!totalDone && track === 'esp32' && i === 0) { s += 30; why.unshift(['Start here: the basics of the ESP32 board', 80]); }
        if (!totalDone && track === 'pi5' && i === 0) s += 15;
        if (totalDone < 4 && it.difficulty === 'Beginner') s += 10;
        if (totalDone < 8 && it.difficulty === 'Advanced') s -= 18;
        let aff = 0; for (const tp of it.topics || []) aff += doneTopics.has(tp) ? 4 : 0;
        s += Math.min(12, aff);
        if (!why.length) why.push([aff ? `Builds on topics you’ve done (${(it.topics || []).filter((t) => doneTopics.has(t)).slice(0, 2).join(', ')})` : `A good ${it.difficulty?.toLowerCase() || ''} project to try`, 1]);
        why.sort((a, b) => b[1] - a[1]);
        scored.push({ item: it, score: s, why: why[0][0] });
      });
    }
    scored.sort((a, b) => b.score - a.score || (a.item.n || 0) - (b.item.n || 0));
    return scored;
  }
  function go(href) {
    const u = new URL(href, location.href);
    if (u.pathname === location.pathname && u.hash !== location.hash) { location.hash = u.hash; if (page === 'esp32') location.reload(); }
    else location.href = u.href;
  }
  async function renderRec() {
    if (load(K.recOff, 0) > Date.now()) return;
    const items = await data();
    if (!items.length) return;
    const list = recommend(items);
    // on a lesson page, never recommend the lesson that is open right now
    const here = keyOf();
    const top = list.filter((x) => `${x.item.track}:${x.item.id}` !== here);
    if (!top.length) return;
    const best = top[0];
    if (page === 'gallery') {
      const hero = $('.g-hero');
      if (!hero) return;
      $('.cd-rec-g', hero)?.remove();
      const alts = top.slice(1, 3);
      const el = document.createElement('div');
      el.className = 'cd-rec-g';
      el.innerHTML = `<a class="cd-rec-main" href="${esc(best.item.href)}">${best.item.thumb ? `<img src="${esc(best.item.thumb)}" alt="" loading="lazy">` : ''}<span><em>${ICON.spark}Recommended next</em><b>${esc(best.item.title)}</b><small>${esc(best.why)} · ${esc(TRACK_NAME[best.item.track])} · ${esc(best.item.difficulty || '')}</small></span>${ICON.arrow}</a>
        ${alts.length ? `<div class="cd-rec-alts"><span>Also good:</span>${alts.map((a) => `<a href="${esc(a.item.href)}" title="${esc(a.why)}">${esc(a.item.title)} <small>${esc(TRACK_NAME[a.item.track])}</small></a>`).join('')}</div>` : ''}`;
      hero.appendChild(el);
      return;
    }
    const host = $('.lessons');
    if (!host) return;
    let el = $('.cd-rec', host);
    if (!el) {
      el = document.createElement('div');
      el.className = 'cd-rec';
      host.appendChild(el);
      for (const ev of ['keydown', 'pointerdown']) el.addEventListener(ev, (e) => e.stopPropagation());
      el.addEventListener('click', (e) => {
        if (e.target.closest('[data-rec=x]')) { e.preventDefault(); save(K.recOff, Date.now() + 864e5); el.remove(); return; }
        const a = e.target.closest('a[href]');
        if (a) { e.preventDefault(); go(a.getAttribute('href')); }
      });
    }
    el.innerHTML = `<a href="${esc(best.item.href)}" title="${esc(best.why)}"><em>${ICON.spark}Recommended next</em><b>${esc(best.item.title)}</b><small>${esc(best.why)}${best.item.track !== page ? ` · ${esc(TRACK_NAME[best.item.track])}` : ''}</small></a><button type="button" class="cd-ai-x" data-rec="x" aria-label="Hide recommendation for today">${ICON.close}</button>`;
  }

  // ------------------------------------------------------------------ boot
  function css() {
    if ($('link[href="/shared/ai.css"]')) return;
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = '/shared/ai.css'; document.head.appendChild(l);
  }
  function boot() {
    css();
    if (LESSON_PAGE) {
      watchConsole();
      let raf = 0;
      const tick = () => { raf = 0; ensureCodeButton(); if (!$('.lessons .cd-rec') && $('.lessons .lesson')) renderRec(); };
      new MutationObserver(() => { if (!raf) raf = requestAnimationFrame(tick); }).observe(document.body, { childList: true, subtree: true });
      tick();
      let lastKey = '';
      const onNav = () => { setTimeout(() => { const k = keyOf(); if (k !== lastKey) { lastKey = k; recordSeen(); renderRec(); lastFail = null; hideToast(); if (panel && !panel.hidden) refreshCtx(); } }, 400); };
      addEventListener('hashchange', onNav);
      document.addEventListener('click', (e) => { if (e.target.closest('.lesson, .fly-list button, [data-tpl], .lesson-step')) onNav(); }, true);
      onNav();
      addEventListener('cd-progress', () => renderRec());
    } else renderRec();
  }
  window.CircuitDeckAI = { open, close, ask: run, context, recommend: async () => recommend(await data()), renderRec, status: checkStatus, md, _state: () => ({ lastFail, runKey, runs: load(K.runs, {}), seen: load(K.seen, {}) }) };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
