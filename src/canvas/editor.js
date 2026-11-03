// Canvas mode · code editor: file tabs, a textarea over a highlighted copy of the code,
// line numbers, an error marker with a jump-to-line banner, and the serial console.
import { highlight, ICONS } from '../core/ui.js';
import { esc } from '../core/layout.js';

const LH = 20; // px per line (canvas.css keeps the textarea, the copy and the gutter on this)
export function createEditor(root, { onInput, onTab, onAddFile, onRenameFile, onDeleteFile, onBoard, onLang, onSerial } = {}) {
  const tabsEl = root.querySelector('.cv-files');
  const ed = root.querySelector('.cv-editor');
  const ta = ed.querySelector('textarea');
  const hl = ed.querySelector('.cv-hl code');
  const gut = ed.querySelector('.cv-gutter');
  const errLine = ed.querySelector('.cv-errline');
  const banner = root.querySelector('.cv-errbar');
  const lines = root.querySelector('.console-lines');
  const status = root.querySelector('.console-status');
  const con = root.querySelector('.console');
  let lang = 'cpp', err = null, open = null; // open: the console line still being printed to
  let readOnly = false;

  function paint() {
    const src = ta.value;
    hl.innerHTML = highlight(`${src}\n `, lang === 'cpp' ? 'c' : 'py');
    const n = src.split('\n').length;
    if (gut.childElementCount !== n) gut.innerHTML = Array.from({ length: n }, (_, i) => `<span>${i + 1}</span>`).join('');
    gut.querySelectorAll('.is-err').forEach((s) => s.classList.remove('is-err'));
    if (err?.line) gut.children[err.line - 1]?.classList.add('is-err');
    errLine.hidden = !err?.line;
    if (err?.line) errLine.style.top = `${(err.line - 1) * LH + 8}px`;
    sync();
  }
  function sync() {
    const y = ta.scrollTop, x = ta.scrollLeft;
    hl.parentElement.style.transform = `translate(${-x}px, ${-y}px)`;
    gut.style.transform = `translateY(${-y}px)`;
    errLine.style.transform = `translateY(${-y}px)`;
  }
  ta.addEventListener('scroll', sync);
  ta.addEventListener('input', () => { if (err?.kind === 'compile') setError(null); paint(); onInput?.(ta.value); });
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      const { selectionStart: s, selectionEnd: f, value: v } = ta;
      if (e.shiftKey) {
        const ls = v.lastIndexOf('\n', s - 1) + 1;
        const cut = v.slice(ls, ls + 2).match(/^ {1,2}/)?.[0].length || 0;
        if (cut) { ta.setRangeText('', ls, ls + cut, 'preserve'); ta.selectionStart = ta.selectionEnd = Math.max(ls, s - cut); }
      } else if (s === f) document.execCommand?.('insertText', false, '  ') || ta.setRangeText('  ', s, f, 'end');
      else {
        const ls = v.lastIndexOf('\n', s - 1) + 1;
        const block = v.slice(ls, f).replace(/^/gm, '  ');
        ta.setRangeText(block, ls, f, 'select');
      }
      ta.dispatchEvent(new Event('input'));
    } else if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      const { selectionStart: s, value: v } = ta;
      const ls = v.lastIndexOf('\n', s - 1) + 1;
      const cur = v.slice(ls, s);
      let ind = cur.match(/^\s*/)[0];
      if (/[:{]\s*$/.test(cur)) ind += '  ';
      if (lang === 'py' && /[:]\s*$/.test(cur)) ind = cur.match(/^\s*/)[0] + '    ';
      e.preventDefault();
      if (!document.execCommand?.('insertText', false, `\n${ind}`)) ta.setRangeText(`\n${ind}`, s, ta.selectionEnd, 'end');
      ta.dispatchEvent(new Event('input'));
    }
  });

  // ---- file tabs
  function setTabs({ boards, board, files, file, langs }) {
    const b = boards.find((x) => x.id === board);
    tabsEl.innerHTML = `${boards.length ? `<select class="cv-board" aria-label="Board to program">${boards.map((x) => `<option value="${esc(x.id)}" ${x.id === board ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}</select>` : ''}
      ${b && langs.length > 1 ? `<select class="cv-lang" aria-label="Language">${langs.map(([k, n]) => `<option value="${k}" ${k === b.lang ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>` : ''}
      <div class="cv-tabs" role="tablist" aria-label="Files">${(files || []).map((f, i) => `<button type="button" role="tab" class="cv-tab${f.name === file ? ' is-active' : ''}" aria-selected="${f.name === file}" data-file="${esc(f.name)}" title="${i ? 'Double-click to rename' : 'Main file'}">${esc(f.name)}${i ? `<span class="cv-x" data-del="${esc(f.name)}" role="button" aria-label="Delete ${esc(f.name)}">×</span>` : ''}</button>`).join('')}
      ${b ? '<button type="button" class="cv-tab cv-add" data-addfile aria-label="New file" title="New file">+</button>' : ''}</div>`;
  }
  tabsEl.addEventListener('click', (e) => {
    const del = e.target.closest('[data-del]');
    if (del) { e.stopPropagation(); onDeleteFile?.(del.dataset.del); return; }
    const t = e.target.closest('[data-file]');
    if (t) { onTab?.(t.dataset.file); return; }
    if (e.target.closest('[data-addfile]')) onAddFile?.();
  });
  tabsEl.addEventListener('dblclick', (e) => { const t = e.target.closest('[data-file]'); if (t && t.previousElementSibling) onRenameFile?.(t.dataset.file); });
  tabsEl.addEventListener('change', (e) => {
    if (e.target.matches('.cv-board')) onBoard?.(e.target.value);
    if (e.target.matches('.cv-lang')) onLang?.(e.target.value);
  });

  // ---- error banner
  function setError(e) {
    err = e;
    banner.hidden = !e;
    if (e) banner.innerHTML = `${ICONS.warn}<span><b>${e.kind === 'compile' ? 'Compile error' : 'Runtime error'}${e.line ? ` · line ${e.line}` : ''}${e.file ? ` · ${esc(e.file)}` : ''}</b> ${esc(e.msg)}</span>${e.line ? '<button type="button" class="cd-btn" data-jump>Go to line</button>' : ''}<button type="button" class="cd-btn cv-ai-fix" data-aifix>Fix with AI</button>`;
    paint();
  }
  function jump(line) {
    const v = ta.value.split('\n');
    let pos = 0;
    for (let i = 0; i < Math.min(line - 1, v.length); i++) pos += v[i].length + 1;
    ta.focus({ preventScroll: true });
    ta.setSelectionRange(pos, pos + (v[line - 1]?.length || 0));
    ta.scrollTop = Math.max(0, (line - 3) * LH);
    sync();
  }
  banner.addEventListener('click', (e) => {
    if (e.target.closest('[data-jump]') && err?.line) api.onJump ? api.onJump(err) : jump(err.line);
    if (e.target.closest('[data-aifix]')) window.CircuitDeckAI?.open({ mode: 'fix' });
  });

  // ---- console
  const form = root.querySelector('.cv-serial');
  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    const inp = form.querySelector('input');
    onSerial?.(inp.value);
    inp.value = '';
  });
  function print(text, cls) {
    const parts = String(text).replace(/\r/g, '').split('\n');
    if (cls) {
      if (parts[parts.length - 1] === '') parts.pop();
      for (const p of parts) { const d = document.createElement('div'); d.className = cls; d.textContent = p; lines.append(d); }
      open = null;
    } else {
      parts.forEach((p, i) => {
        if (!open) { open = document.createElement('div'); lines.append(open); }
        open.textContent += p;
        if (i < parts.length - 1) open = null;
      });
    }
    while (lines.childElementCount > 400) lines.firstChild.remove();
    lines.scrollTop = lines.scrollHeight;
  }

  const api = {
    get value() { return ta.value; },
    set(code, l, { keepScroll = false } = {}) {
      lang = l;
      if (ta.value !== code) ta.value = code;
      if (!keepScroll) { ta.scrollTop = 0; ta.scrollLeft = 0; }
      paint();
    },
    setTabs, setError, jump,
    get error() { return err; },
    setReadOnly(on) { readOnly = on; ta.readOnly = on; },
    get readOnly() { return readOnly; },
    focus() { ta.focus(); },
    print,
    clear() { lines.innerHTML = ''; open = null; },
    status(t) { status.textContent = t; },
    openConsole() { con.classList.add('is-open'); root.classList.add('cv-con-open'); },
    closeConsole() { con.classList.remove('is-open'); root.classList.remove('cv-con-open'); },
    textarea: ta,
    onJump: null,
  };
  return api;
}
