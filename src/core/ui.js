// Shared DOM helpers for the Pi 5 track and the sandbox: code highlighting,
// the code card and its console, tabs, the flyout, the inspector, the lesson
// strip and the progress card. They fill the markup the ESP32 app's CSS styles.
import { esc } from './layout.js';

export const ICONS = {
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"></path></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"></path></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M7.5 4.8v14.4L19 12z" class="fill" /></svg>',
  stop: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="6.5" width="11" height="11" rx="1.5" class="fill"></rect></svg>',
  prev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5.5-6.5 6.5 6.5 6.5"></path></svg>',
  next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5.5 6.5 6.5L9 18.5"></path></svg>',
  // feature bullets
  chip: '<svg viewBox="0 0 40 40" aria-hidden="true"><rect x="10" y="10" width="20" height="20" rx="2"></rect><path d="M15 4v6M20 4v6M25 4v6M15 30v6M20 30v6M25 30v6M4 15h6M4 20h6M4 25h6M30 15h6M30 20h6M30 25h6"></path></svg>',
  code: '<svg viewBox="0 0 40 40" aria-hidden="true"><path d="m14 12-8 8 8 8M26 12l8 8-8 8M22 9l-4 22"></path></svg>',
  bolt: '<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M22 4 9 23h10l-2 13 14-20H21z"></path></svg>',
  eye: '<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M3 20s6-11 17-11 17 11 17 11-6 11-17 11S3 20 3 20z"></path><circle cx="20" cy="20" r="5"></circle></svg>',
  wave: '<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M4 20c4-9 8-9 12 0s8 9 12 0 6-6 8-4"></path></svg>',
  hand: '<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M14 22V9a2.5 2.5 0 0 1 5 0v10M19 18V6a2.5 2.5 0 0 1 5 0v12M24 18V8a2.5 2.5 0 0 1 5 0v14c0 8-4 13-11 13-5 0-8-3-10-7l-3-6a2.5 2.5 0 0 1 4.3-2.5L14 24"></path></svg>',
  warn: '<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M20 5 3 34h34z"></path><path d="M20 15v9M20 29v.5"></path></svg>',
  cart: '<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M4 7h5l4 18h18l4-13H11"></path><circle cx="15" cy="32" r="2.4"></circle><circle cx="29" cy="32" r="2.4"></circle></svg>',
  clock: '<svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="21" r="14"></circle><path d="M20 12.5V21l6 4"></path></svg>',
};

// ---------------------------------------------------------------- highlighting
const PY_KW = new Set('and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield'.split(' '));
const C_KW = new Set('const int void float bool char unsigned long if else for while return true false HIGH LOW INPUT OUTPUT INPUT_PULLUP include define'.split(' '));
export function highlight(src, lang = 'py') {
  const kw = lang === 'py' ? PY_KW : C_KW;
  const cm = lang === 'py' ? '#' : '//';
  const re = /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(\b\d+(?:\.\d+)?(?:e-?\d+)?\b|\b0x[0-9a-fA-F]+\b)|([A-Za-z_][A-Za-z0-9_]*)(\s*\()?|(.)/g;
  return src.replace(/\s+$/, '').split('\n').map((line, i) => {
    let code = line, comment = '';
    // find a comment marker outside strings
    let inS = null;
    for (let k = 0; k < line.length; k++) {
      const ch = line[k];
      if (inS) { if (ch === '\\') k++; else if (ch === inS) inS = null; continue; }
      if (ch === '"' || ch === "'") { inS = ch; continue; }
      if (line.startsWith(cm, k)) { code = line.slice(0, k); comment = line.slice(k); break; }
    }
    let html = '';
    code.replace(re, (m, str, num, id, call, other) => {
      if (str) html += `<span class="str">${esc(str)}</span>`;
      else if (num) html += `<span class="num">${esc(num)}</span>`;
      else if (id) {
        if (kw.has(id)) html += `<span class="kw">${id}</span>`;
        else if (call) html += `<span class="fn">${id}</span>${esc(call)}`;
        else if (/^[A-Z][A-Za-z0-9]+$/.test(id) || /^[A-Z_0-9]+$/.test(id)) html += `<span class="id">${id}</span>`;
        else html += esc(id);
        if (call && kw.has(id)) html += esc(call);
      } else html += esc(other);
      return m;
    });
    if (comment) html += `<span class="cm">${esc(comment)}</span>`;
    return `<span class="line" data-n="${i + 1}"><span class="ln">${i + 1}</span>${html || ' '}</span>`;
  }).join('');
}

// ---------------------------------------------------------------- code card
export function codeCard(root, { onRun, onStop, consoleTitle = 'Terminal' } = {}) {
  const codeEl = root.querySelector('.code code');
  const runBtn = root.querySelector('.btn-run');
  const con = root.querySelector('.console');
  const lines = root.querySelector('.console-lines');
  const status = root.querySelector('.console-status');
  root.querySelector('.console-title').textContent = consoleTitle;
  let src = '', running = false;
  runBtn.addEventListener('click', () => (running ? onStop?.() : onRun?.()));
  root.querySelector('.console-close').addEventListener('click', () => (running ? onStop?.() : api.closeConsole()));
  root.querySelector('.btn-copy').addEventListener('click', async (e) => {
    try { await navigator.clipboard.writeText(src); e.currentTarget.classList.add('is-done'); setTimeout(() => e.currentTarget?.classList.remove('is-done'), 900); } catch { /* clipboard blocked */ }
  });
  const expand = root.querySelector('.btn-expand');
  expand.addEventListener('click', () => {
    const on = !root.classList.contains('is-expanded');
    root.classList.toggle('is-expanded', on);
    expand.setAttribute('aria-expanded', String(on));
  });
  const api = {
    setCode(code, lang = 'py') { src = code; codeEl.innerHTML = highlight(code, lang); codeEl.parentElement.scrollTop = 0; },
    get code() { return src; },
    mark(n) {
      codeEl.querySelectorAll('.line.is-running').forEach((l) => l.classList.remove('is-running'));
      if (!n) return;
      const l = codeEl.querySelector(`.line[data-n="${n}"]`);
      if (l) {
        l.classList.add('is-running');
        const pre = codeEl.parentElement;
        if (l.offsetTop < pre.scrollTop + 10 || l.offsetTop > pre.scrollTop + pre.clientHeight - 30) pre.scrollTop = l.offsetTop - pre.clientHeight / 3;
      }
    },
    setRunning(on) {
      running = on;
      root.dataset.state = on ? 'running' : 'idle';
      runBtn.innerHTML = on ? ICONS.stop : ICONS.play;
      runBtn.setAttribute('aria-label', on ? 'Stop program' : 'Run program');
      runBtn.title = on ? 'Stop program (Space)' : 'Run program (Space)';
      status.textContent = on ? 'Running' : 'Stopped';
      if (on) api.openConsole();
      if (!on) api.mark(0);
    },
    get running() { return running; },
    openConsole() { con.classList.add('is-open'); },
    closeConsole() { con.classList.remove('is-open'); },
    clear() { lines.innerHTML = ''; },
    print(text, cls) {
      const d = document.createElement('div');
      d.textContent = text;
      if (cls) d.className = cls;
      lines.append(d);
      while (lines.childElementCount > 200) lines.firstChild.remove();
      lines.scrollTop = lines.scrollHeight;
      return d;
    },
  };
  return api;
}

// ---------------------------------------------------------------- tabs
export function tabs(card, render) {
  const buttons = [...card.querySelectorAll('[role=tab]')];
  const content = card.querySelector('.info-content');
  const names = ['overview', 'pinout', 'example', 'specs'];
  let current = 'overview';
  buttons.forEach((b, i) => {
    b.dataset.tab = names[i];
    b.addEventListener('click', () => api.show(names[i]));
    b.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const j = (i + (e.key === 'ArrowRight' ? 1 : buttons.length - 1)) % buttons.length;
      buttons[j].focus(); api.show(names[j]);
    });
  });
  card.querySelector('.expand')?.addEventListener('click', () => card.classList.toggle('is-expanded'));
  const api = {
    show(name = current) {
      current = name;
      buttons.forEach((b) => { const on = b.dataset.tab === name; b.classList.toggle('is-active', on); b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; });
      content.classList.remove('is-in');
      content.innerHTML = render(name);
      content.scrollTop = 0;
      requestAnimationFrame(() => content.classList.add('is-in'));
    },
    get current() { return current; },
  };
  return api;
}

// ---------------------------------------------------------------- flyout
export function flyout(el, sidebar) {
  let kind = null;
  function close() {
    el.classList.remove('is-open'); kind = null;
    sidebar.querySelectorAll('.side-nav li').forEach((li) => li.classList.toggle('is-active', li.querySelector('[data-nav=home]') !== null && false));
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  document.addEventListener('pointerdown', (e) => {
    if (!kind) return;
    if (el.contains(e.target) || e.target.closest('.sidebar')) return;
    close();
  });
  return {
    open(k, html, link) {
      if (kind === k) { close(); return; }
      kind = k;
      el.dataset.kind = k;
      el.innerHTML = html;
      const app = el.offsetParent || el.parentElement;
      const top = link ? Math.max(20, Math.min(link.getBoundingClientRect().top - app.getBoundingClientRect().top, 400)) : 140;
      const sc = app.getBoundingClientRect().height / app.offsetHeight || 1;
      el.style.setProperty('--top', `${Math.round(top / sc)}px`);
      el.classList.add('is-open');
      sidebar.querySelectorAll('.side-nav li').forEach((li) => li.classList.toggle('is-active', li.contains(link)));
    },
    close,
    get kind() { return kind; },
    el,
  };
}

// ---------------------------------------------------------------- inspector
export function inspector(el) {
  let onClose = null;
  el.addEventListener('click', (e) => { if (e.target.closest('.insp-close')) api.hide(); });
  const api = {
    show(info, { x = 40, y = 40, actions = '' } = {}) {
      const rows = (info.rows || []).map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('');
      el.innerHTML = `<header class="insp-head"><h3>${esc(info.title)}</h3><button class="insp-close" type="button" aria-label="Close">${ICONS.close}</button></header>
        <p class="insp-desc">${esc(info.desc || '')}</p>
        <dl class="insp-rows cd-insp-rows"${rows ? '' : ' hidden'}>${rows}</dl>${actions}`;
      const stage = el.parentElement;
      const W = stage.clientWidth, H = stage.clientHeight;
      const w = el.offsetWidth || 292, h = el.offsetHeight || 160;
      const px = Math.max(10, Math.min(W - w - 10, x + 18)), py = Math.max(10, Math.min(H - h - 10, y - h / 2));
      el.style.transform = `translate(${px}px, ${py}px)`;
      el.classList.add('is-on');
    },
    hide() { el.classList.remove('is-on'); onClose?.(); },
    onClose(fn) { onClose = fn; },
    get open() { return el.classList.contains('is-on'); },
  };
  return api;
}

// ---------------------------------------------------------------- lesson strip
export function lessonStrip(section, { items, onPick }) {
  const list = section.querySelector('.lesson-list');
  list.innerHTML = items.map((it, i) => `
    <div class="lesson" role="button" tabindex="0" data-id="${esc(it.id)}" style="--tw: 80; --w: ${Math.max(220, Math.min(300, 120 + it.title.length * 8))};" aria-label="Project ${i + 1}: ${esc(it.title)}">
      <img class="lesson-thumb is-ready" alt="" src="${esc(it.thumb)}" loading="lazy" width="96" height="60" />
      <span class="lesson-title">${i + 1}. ${esc(it.title)}</span>
      <span class="lesson-done" aria-hidden="true">${ICONS.check}</span>
    </div>`).join('');
  list.addEventListener('click', (e) => { const l = e.target.closest('.lesson'); if (l) onPick(l.dataset.id); });
  list.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.lesson')) { e.preventDefault(); onPick(e.target.dataset.id); } });
  if (!section.querySelector('.lesson-step')) section.insertAdjacentHTML('beforeend', `<button class="lesson-step prev" aria-label="Earlier projects">${ICONS.prev}</button><button class="lesson-step next" aria-label="More projects">${ICONS.next}</button>`);
  const prev = section.querySelector('.lesson-step.prev'), next = section.querySelector('.lesson-step.next');
  const step = (d) => list.scrollBy({ left: d * list.clientWidth * 0.8, behavior: 'smooth' });
  prev.addEventListener('click', () => step(-1));
  next.addEventListener('click', () => step(1));
  const update = () => {
    const can = list.scrollWidth > list.clientWidth + 4;
    section.classList.toggle('can-scroll', can);
    prev.disabled = list.scrollLeft < 4;
    next.disabled = list.scrollLeft + list.clientWidth > list.scrollWidth - 4;
    section.classList.toggle('can-right', !next.disabled);
  };
  list.addEventListener('scroll', update, { passive: true });
  new ResizeObserver(update).observe(list);
  return {
    setActive(id) {
      list.querySelectorAll('.lesson').forEach((l) => { const on = l.dataset.id === id; l.classList.toggle('is-active', on); l.setAttribute('aria-current', on ? 'step' : 'false'); if (on) { const r = l.offsetLeft - list.clientWidth / 2 + l.offsetWidth / 2; list.scrollTo({ left: r, behavior: 'smooth' }); } });
      setTimeout(update, 400);
    },
    setDone(set) { list.querySelectorAll('.lesson').forEach((l) => l.classList.toggle('is-done', set.has(l.dataset.id))); },
  };
}

// ---------------------------------------------------------------- progress
export function progress(root, label) {
  root.querySelector('.progress-label').textContent = label;
  return {
    set(done, total) {
      root.querySelector('#progress-fill').style.width = `${total ? (done / total) * 100 : 0}%`;
      root.querySelector('#progress-count').textContent = `${done}/${total}`;
      const bar = root.querySelector('.progress-track');
      bar.setAttribute('aria-valuemax', String(total)); bar.setAttribute('aria-valuenow', String(done));
    },
  };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
