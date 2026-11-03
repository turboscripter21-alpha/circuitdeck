// M11 · Canvas runtime: a cooperative scheduler that runs compiled sketches
// (generators from cpp.js / py.js) against the canvas hardware model (hw.js).
// One Machine per board. Virtual time advances with real time (frame by frame);
// delay()/sleep() yield milliseconds, tight loops yield when their budget runs out.
import { pinsOf, gpioId } from './hw.js';

export class RunError extends Error {
  constructor(msg, line) { super(msg); this.kind = 'runtime'; if (line != null) this.line = line; }
}
class Restart extends Error {}
const BUDGET = 6000;

export const BOARD_INFO = {
  esp32: { name: 'ESP32 DevKit', adc: new Set([32, 33, 34, 35, 36, 39, 0, 2, 4, 12, 13, 14, 15, 25, 26, 27]), inputOnly: new Set([34, 35, 36, 39]), flash: new Set([6, 7, 8, 9, 10, 11]), led: 2 },
  esp32s3: { name: 'ESP32-S3 board', adc: new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]), inputOnly: new Set(), flash: new Set([26, 27, 28, 29, 30, 31, 32]), led: 48 },
  pi5: { name: 'Raspberry Pi 5', adc: new Set(), inputOnly: new Set(), flash: new Set(), led: null },
};

// ---------------------------------------------------------------- formatting helpers
const fixed = (v, d) => (Number.isNaN(v) ? 'nan' : !Number.isFinite(v) ? (v < 0 ? '-inf' : 'inf') : (+v).toFixed(Math.max(0, d)));
export function fmtv(v, tag, arg) {
  switch (tag) {
    case 'f': return fixed(v, arg ?? 2);
    case 'c': return arg != null ? fmtInt(v, arg) : String.fromCharCode(v & 255);
    case 'b': return v ? '1' : '0';
    case 's': return String(v ?? '');
    case 'i': case 'u': return fmtInt(v, arg, tag === 'u');
    case 'o': return '';
    default:
      if (typeof v === 'number') return Number.isInteger(v) ? String(v) : fixed(v, arg ?? 2);
      return String(v ?? '');
  }
}
function fmtInt(v, base = 10, uns = false) {
  v = Math.trunc(v);
  if (base === 10 || base == null) return String(uns ? v >>> 0 : v);
  if (base < 2 || base > 36) base = 10;
  const u = v < 0 ? v >>> 0 : v;
  return u.toString(base).toUpperCase();
}
export function fmt(f, args = [], tags = []) {
  let i = 0, out = '';
  f = String(f);
  for (let k = 0; k < f.length; k++) {
    const ch = f[k];
    if (ch !== '%') { out += ch; continue; }
    const m = /^%([-+ 0#]*)(\*|\d+)?(?:\.(\*|\d+))?(hh|h|ll|l|L|z|j|t)?([diouxXeEfFgGcsp%])/.exec(f.slice(k));
    if (!m) { out += ch; continue; }
    k += m[0].length - 1;
    const [, flags, w0, p0, , conv] = m;
    if (conv === '%') { out += '%'; continue; }
    let width = w0 === '*' ? args[i++] : w0 ? +w0 : 0;
    let prec = p0 === '*' ? args[i++] : p0 != null ? +p0 : null;
    const v = args[i++];
    let s;
    switch (conv) {
      case 'd': case 'i': s = String(Math.trunc(+v || 0)); if (prec != null) s = s.replace(/^(-?)(\d+)/, (_, sg, d) => sg + d.padStart(prec, '0')); break;
      case 'u': s = String(Math.trunc(+v || 0) >>> 0); break;
      case 'o': s = (Math.trunc(+v || 0) >>> 0).toString(8); break;
      case 'x': s = (Math.trunc(+v || 0) >>> 0).toString(16); if (flags.includes('#') && v) s = '0x' + s; break;
      case 'X': s = (Math.trunc(+v || 0) >>> 0).toString(16).toUpperCase(); if (flags.includes('#') && v) s = '0X' + s; break;
      case 'f': case 'F': s = fixed(+v, prec ?? 6); break;
      case 'e': case 'E': s = Number.isFinite(+v) ? (+v).toExponential(prec ?? 6).replace(/e([+-])(\d)$/, 'e$10$2') : fixed(+v, 0); if (conv === 'E') s = s.toUpperCase(); break;
      case 'g': case 'G': s = Number.isFinite(+v) ? String(+(+v).toPrecision(prec || 6)) : fixed(+v, 0); break;
      case 'c': s = typeof v === 'string' ? v.slice(0, 1) : String.fromCharCode((+v || 0) & 255); break;
      case 's': s = typeof v === 'number' && tags[i - 1] !== 's' ? String(v) : String(v ?? '(null)'); if (prec != null) s = s.slice(0, prec); break;
      case 'p': s = '0x3ffb0000'; break;
      default: s = '';
    }
    if (flags.includes('+') && /[dife]/i.test(conv) && !s.startsWith('-')) s = '+' + s;
    else if (flags.includes(' ') && /[dife]/i.test(conv) && !s.startsWith('-')) s = ' ' + s;
    if (s.length < width) {
      if (flags.includes('-')) s = s.padEnd(width);
      else if (flags.includes('0') && /[diouxXfFeEgG]/.test(conv)) { const sg = /^[-+ ]/.test(s) ? s[0] : ''; s = sg + s.slice(sg.length).padStart(width - sg.length, '0'); }
      else s = s.padStart(width);
    }
    out += s;
  }
  return out;
}

// seeded PRNG so runs are repeatable
function lcg(seed) { let s = seed >>> 0 || 1; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }

// ---------------------------------------------------------------- the machine
export class Machine {
  // opts: { hw, board: 'b1', kind: 'esp32', print(text), note(msg), draw(partId, painter, info), onHalt(err|null) }
  constructor(opts) {
    Object.assign(this, { print: () => {}, note: () => {}, draw: () => {}, onHalt: () => {} }, opts);
    this.info = BOARD_INFO[this.kind] || BOARD_INFO.esp32;
    this.gpios = new Set(pinsOf(this.kind).filter((p) => p.kind === 'gpio').map((p) => +p.id.slice(4)));
    this.threads = [];
    this.now = 0;
    this.running = false;
    this.halted = null;
    this.noted = new Set();
    this.screens = {}; // partId -> { kind, lines/ops } for tests + redraws
    this.dirtyScreens = new Set();
    this.serialOut = '';
  }
  noteOnce(key, msg) { if (this.noted.has(key)) return; this.noted.add(key); this.note(msg); }
  out(text) { this.serialOut += text; if (this.serialOut.length > 20000) this.serialOut = this.serialOut.slice(-12000); this.print(text); }
  // program: { make($) -> { main: generator function } }   ($ is the language runtime object)
  load(program) { this.program = program; }
  start() {
    this.stop();
    this.hw.reset();
    this.now = 0; this.halted = null; this.running = true; this.threads = []; this.watch = []; this.serialOut = '';
    this.screens = {}; this.noted.clear();
    this.rt = this.program.make(this);
    this.spawn(this.rt.main(), 'main');
    this.lastVersion = -1;
  }
  stop() { this.running = false; this.threads = []; this.watch = []; }
  spawn(gen, name, prio = false) { const t = { gen, name, wake: this.now, l: 0, prio }; if (prio) this.threads.unshift(t); else this.threads.push(t); return t; }
  get l() { return this.rt?.$?.l ?? 0; }
  halt(err) {
    this.running = false; this.threads = [];
    this.halted = err || { ok: true };
    this.onHalt(err || null);
  }
  // Advance virtual time by dt ms (one animation frame).
  step(dt) {
    if (!this.running) return;
    const $ = this.rt.$;
    const target = this.now + Math.min(Math.max(dt, 0), 250);
    $.b = BUDGET; $.target = target;
    this.checkEdges();
    let guard = 0;
    while (this.running && guard++ < 20000) {
      let t = null;
      for (const x of this.threads) if (x.wake <= target && (!t || x.wake < t.wake || (x.prio && !t.prio))) t = x;
      if (!t) break;
      if (t.wake > this.now) this.now = t.wake;
      $.l = t.l;
      this.cur = t;
      let r;
      try { r = t.gen.next(); } catch (e) {
        if (e instanceof Restart) { this.out('\r\nets Jun  8 2016 00:22:57\r\nrst:0xc (SW_CPU_RESET)\r\n'); this.rt.$.l = 0; this.start(); return; }
        this.fail(e, $.l);
        return;
      }
      t.l = $.l;
      if (r.done) { this.threads.splice(this.threads.indexOf(t), 1); if (t.name === 'main') { this.halt(null); return; } continue; }
      const v = r.value;
      if (v === 0 || v == null) { t.wake = target + 1e-6; if ($.b < 0) { this.now = target; break; } }
      else t.wake = this.now + v;
      this.checkEdges();
    }
    if (this.running) this.now = Math.max(this.now, target);
    this.flushScreens();
  }
  fail(e, line) {
    let msg = e?.message || String(e);
    if (!(e instanceof RunError)) {
      if (/Cannot read properties of (null|undefined)/.test(msg)) msg = 'used an object or array that was never set up (it is null)';
      else if (/Maximum call stack/.test(msg)) msg = 'stack overflow — a function keeps calling itself without stopping';
      else if (/is not a function/.test(msg)) msg = msg.replace(/\$\.|v_|_\d+/g, '');
    }
    const err = { kind: 'runtime', line: e?.line ?? line, msg, py: e?.py };
    this.halt(err);
  }
  // ---- interrupts: watch pins, spawn handler threads on edges
  attach(pin, fn, mode, line) {
    this.checkPin(pin, line);
    this.watch = (this.watch || []).filter((w) => w.pin !== pin);
    this.watch.push({ pin, fn, mode, last: this.hw.level(this.board, pin) });
  }
  detach(pin) { this.watch = (this.watch || []).filter((w) => w.pin !== pin); }
  checkEdges() {
    if (!this.watch?.length || this.hw.version === this.lastVersion) return;
    this.lastVersion = this.hw.version;
    for (const w of this.watch) {
      const now = this.hw.level(this.board, w.pin);
      if (now === w.last) continue;
      const rising = now === 1;
      w.last = now;
      if (w.mode === 3 || (w.mode === 1 && rising) || (w.mode === 2 && !rising)) this.spawn(w.fn(rising), 'isr', true);
    }
  }
  // ---- shared pin helpers (C++ and Python runtimes both use these)
  checkPin(pin, line, { output = false, analog = false } = {}) {
    const n = +pin;
    const bn = this.info.name;
    if (!Number.isInteger(n) || !this.gpios.has(n)) {
      if (this.info.flash.has(n)) throw new RunError(`GPIO${n} is wired to the flash chip on the ${bn} — using it crashes the board. Pick another pin.`, line);
      throw new RunError(`GPIO${pin} doesn't exist on the ${bn}${this.kind === 'pi5' ? ' (use BCM numbers 2–27)' : ''}.`, line);
    }
    if (output && this.info.inputOnly.has(n)) throw new RunError(`GPIO${n} is input-only on the ${bn} — it can't drive an output. Use e.g. GPIO25 or GPIO26.`, line);
    if (analog && !this.info.adc.has(n)) throw new RunError(this.kind === 'pi5' ? 'The Raspberry Pi has no analog inputs — use an MCP3008 ADC.' : `GPIO${n} is not an analog (ADC) pin on the ${bn}. Try GPIO34, 35, 32 or 33.`, line);
    return n;
  }
  setScreen(partId, data) { this.screens[partId] = data; this.dirtyScreens.add(partId); }
  flushScreens() {
    for (const id of this.dirtyScreens) { const s = this.screens[id]; if (s) this.draw(id, s); }
    this.dirtyScreens.clear();
  }
  serialIn(text) { this.rt?.serialIn?.(text); }
}
export { Restart };
