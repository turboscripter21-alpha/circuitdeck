// M11 · Canvas hardware model: turns the canvas wiring + pin states + user inputs
// into net voltages, then into part states (LED brightness, servo angle, buzzer tone…).
// Pure logic (no DOM / three.js) so it can be unit-tested in node.
//
// Canvas model: { boards: [{ id, type }], parts: [{ id, type, opts }], wires: [{ a, b }] }
//   board endpoint "b1:GPIO17" / "b1:GND@6", part endpoint "p3.A".
import { boardPins } from '../core/boards.js';

const OHMS = { 220: 220, 330: 330, '1k': 1000, '2k': 2000, '10k': 10000 };
const LED_VF = { red: 1.8, yellow: 1.9, orange: 1.9, green: 2.0, blue: 2.7, white: 2.7 };
const PULL_R = 45000;
const pinCache = {};
export const pinsOf = (kind) => (pinCache[kind] ||= boardPins(kind));
export const isBoardEnd = (ref) => ref.includes(':');
export const splitBoard = (ref) => { const i = ref.indexOf(':'); return [ref.slice(0, i), ref.slice(i + 1)]; };
export const splitPart = (ref) => { const i = ref.indexOf('.'); return [ref.slice(0, i), ref.slice(i + 1)]; };
export const gpioId = (n) => `GPIO${n}`;

// Default user inputs for a part type (the Inputs panel edits these).
export function defaultInput(type) {
  switch (type) {
    case 'button': return { pressed: false };
    case 'pot': return { value: 0.5 };
    case 'ldr': return { light: 0.6 };
    case 'pir': return { motion: false };
    case 'hcsr04': return { cm: 40 };
    case 'dht22': return { t: 24, h: 55 };
    case 'bme280': return { t: 22, h: 48, p: 1013 };
    case 'soil': return { moist: 0.4 };
    case 'mq2': return { gas: 0.1 };
    case 'keypad': return { key: '' };
    case 'mpu6050': return { ax: 0, ay: 0, az: 1 };
    case 'inmp441': return { level: 0.2 };
    default: return null;
  }
}
const KEYS = ['123', '456', '789', '*0#'];

export class Hardware {
  constructor(model, { setPart } = {}) {
    this.setPart = setPart || (() => {});
    this.pins = {}; // boardId -> { [gpioNum]: { mode, out, duty, freq, tone, servo } }
    this.inputs = {}; // partId -> input state
    this.extra = {}; // partId -> library-driven state (ring pixels, matrix rows…)
    this.shown = {}; // partId -> last pushed state JSON
    this.dirty = true;
    this.version = 0; // bumps whenever any level may have changed
    this.warnings = new Set();
    this.setModel(model);
  }
  setModel(model) {
    this.model = model;
    this.byId = Object.fromEntries(model.parts.map((p) => [p.id, p]));
    this.steppers = model.parts.filter((p) => p.type === 'stepper');
    this.boards = Object.fromEntries(model.boards.map((b) => [b.id, b]));
    for (const p of model.parts) if (!this.inputs[p.id]) { const d = defaultInput(p.type); if (d) this.inputs[p.id] = d; }
    for (const b of model.boards) this.pins[b.id] ||= {};
    this.topo = (this.topo || 0) + 1;
    this.touch();
  }
  reset() { for (const b of Object.keys(this.pins)) this.pins[b] = {}; this.extra = {}; this.warnings.clear(); this.touch(); }
  touch() { this.dirty = true; this.version++; }
  pin(board, n) { const P = (this.pins[board] ||= {}); return (P[n] ||= { mode: 0, out: 0, duty: null, freq: 0, tone: 0, servo: 0 }); }
  // ---- writes from the running program
  mode(board, n, mode) { const p = this.pin(board, n); if (p.mode !== mode) { p.mode = mode; this.touch(); } }
  write(board, n, v) { const p = this.pin(board, n); v = v ? 1 : 0; if (p.mode !== 3) p.mode = 3; if (p.out !== v || p.duty != null || p.tone) { p.out = v; p.duty = null; p.tone = 0; p.servo = 0; this.touch(); if (this.steppers.length) this.trackSteppers(); } }
  // steppers move on every coil change, so track their phase at write time (not once per frame)
  trackSteppers() {
    const s = this.solve();
    for (const p of this.steppers) {
      const bits = [1, 2, 3, 4].map((k) => (s.v(`${p.id}.IN${k}`) ?? 0) > 1.5);
      const H = { '1000': 0, '1100': 1, '0100': 2, '0110': 3, '0010': 4, '0011': 5, '0001': 6, '1001': 7 }[bits.map(Number).join('')];
      const x = this.extra[p.id] || {};
      if (H == null) continue;
      let pos = x.pos || 0;
      if (x.h != null && H !== x.h) { let d = (H - x.h + 8) % 8; if (d > 4) d -= 8; pos += d; }
      this.extra[p.id] = { ...x, h: H, pos };
    }
  }
  pwm(board, n, duty, freq = 1000) {
    const p = this.pin(board, n); p.mode = 3; duty = Math.max(0, Math.min(1, duty));
    const servo = freq >= 40 && freq <= 400 ? duty * (1e6 / freq) : 0;
    if (p.duty !== duty || p.freq !== freq || p.tone) { p.duty = duty; p.freq = freq; p.tone = 0; p.servo = servo; p.out = duty > 0 ? 1 : 0; this.touch(); }
  }
  tone(board, n, f) { const p = this.pin(board, n); p.mode = 3; if (p.tone !== f) { p.tone = f; p.duty = f ? 0.5 : null; p.out = f ? 1 : 0; p.servo = 0; this.touch(); } }
  servo(board, n, us) { const p = this.pin(board, n); p.mode = 3; if (p.servo !== us) { p.servo = us; p.duty = us / 20000; p.freq = 50; p.out = 1; p.tone = 0; this.touch(); } }
  release(board, n) { const p = this.pin(board, n); p.duty = null; p.servo = 0; p.tone = 0; p.out = 0; this.touch(); }
  setInput(id, patch) { this.inputs[id] = { ...(this.inputs[id] || {}), ...patch }; this.touch(); }
  setExtra(id, patch) { this.extra[id] = { ...(this.extra[id] || {}), ...patch }; this.dirty = true; }
  warn(msg) { this.warnings.add(msg); }

  // ---- net building (strong links: wires + closed switches)
  solve() {
    if (!this.dirty && this.sol) return this.sol;
    let prev = this.sol;
    for (let pass = 0; pass < 3; pass++) { const s = this._solve(prev); const same = prev && JSON.stringify(s.sig) === JSON.stringify(prev.sig); prev = s; if (same) break; }
    this.sol = prev; this.dirty = false;
    return prev;
  }
  _solve(prev) {
    const parent = new Map();
    const find = (x) => { if (!parent.has(x)) parent.set(x, x); let r = x; while (parent.get(r) !== r) r = parent.get(r); let y = x; while (parent.get(y) !== r) { const n = parent.get(y); parent.set(y, r); y = n; } return r; };
    const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
    for (const w of this.model.wires) union(w.a, w.b);
    for (const b of this.model.boards) for (const p of pinsOf(b.type)) find(`${b.id}:${p.id}`);
    for (const b of this.model.boards) { // a board's GND pins are one net, and so are its 3V3 / 5V pins
      const ps = pinsOf(b.type);
      for (const k of ['GND', '3V3', '5V']) { const g = ps.filter((p) => p.name === k || (k === '5V' && p.name === 'VIN')); for (let i = 1; i < g.length; i++) union(`${b.id}:${g[0].id}`, `${b.id}:${g[i].id}`); }
    }
    const relayOn = prev?.relay || {};
    for (const p of this.model.parts) {
      const i = this.inputs[p.id] || {};
      if (p.type === 'button' && i.pressed) union(`${p.id}.1`, `${p.id}.2`);
      if (p.type === 'relay' && relayOn[p.id]) union(`${p.id}.COM`, `${p.id}.NO`);
      if (p.type === 'levelshift') { union(`${p.id}.LV1`, `${p.id}.HV1`); union(`${p.id}.LV2`, `${p.id}.HV2`); }
      if (p.type === 'keypad' && i.key) { const r = KEYS.findIndex((row) => row.includes(i.key)); if (r >= 0) union(`${p.id}.R${r + 1}`, `${p.id}.C${KEYS[r].indexOf(i.key) + 1}`); }
    }
    const netOf = (ref) => find(ref);
    const fixed = new Map(); // net -> { v, duty, tone, servo, src }
    const shorts = [];
    const drive = (ref, s) => {
      const n = netOf(ref);
      const cur = fixed.get(n);
      if (cur && Math.abs(cur.v - s.v) > 0.5) { shorts.push(ref); if (s.v === 0 || cur.v === 0) fixed.set(n, { ...s, v: 0 }); return; }
      if (!cur || s.duty != null || s.tone || s.servo) fixed.set(n, s);
    };
    const weak = []; // [net, v, R]
    for (const b of this.model.boards) {
      for (const p of pinsOf(b.type)) {
        const ref = `${b.id}:${p.id}`;
        if (p.kind === 'gnd') drive(ref, { v: 0 });
        else if (p.kind === 'power') drive(ref, { v: p.volts });
        else if (p.kind === 'gpio') {
          const st = this.pins[b.id]?.[+p.id.slice(4)];
          if (!st) continue;
          if (st.mode === 3) drive(ref, { v: st.out || st.duty > 0 ? 3.3 : 0, duty: st.duty, tone: st.tone, servo: st.servo, freq: st.freq, src: ref });
          else if (st.mode === 5) weak.push([netOf(ref), 3.3, PULL_R]);
          else if (st.mode === 9) weak.push([netOf(ref), 0, PULL_R]);
        }
      }
    }
    // power state of a part from the previous pass (or the board rails on the first)
    const pv = (ref) => { const n = netOf(ref); return fixed.get(n)?.v ?? prev?.V?.get(n) ?? null; };
    const powered = (p, vcc, gnd) => (pv(`${p.id}.${vcc}`) ?? 0) >= 2.5 && pv(`${p.id}.${gnd}`) === 0;
    const res = []; // [netA, netB, R]
    for (const p of this.model.parts) {
      const i = this.inputs[p.id] || {};
      const R = (a, b, r) => res.push([netOf(`${p.id}.${a}`), netOf(`${p.id}.${b}`), Math.max(1, r)]);
      switch (p.type) {
        case 'resistor': R('1', '2', OHMS[p.opts?.ohms || '330'] || 330); break;
        case 'ldr': R('1', '2', 200 + (1 - (i.light ?? 0.5)) ** 2 * 100000); break;
        case 'pot': R('1', 'W', 10000 * (i.value ?? 0.5)); R('W', '3', 10000 * (1 - (i.value ?? 0.5))); break;
        case 'battery': drive(`${p.id}.-`, { v: 0 }); drive(`${p.id}.+`, { v: 9 }); break;
        case 'psu12': drive(`${p.id}.-`, { v: 0 }); drive(`${p.id}.+`, { v: 12 }); break;
        case 'pir': if (powered(p, 'VCC', 'GND')) drive(`${p.id}.OUT`, { v: i.motion ? 3.3 : 0 }); break;
        case 'mq2': if (powered(p, 'VCC', 'GND')) { drive(`${p.id}.AO`, { v: 0.3 + 2.9 * (i.gas ?? 0) }); drive(`${p.id}.DO`, { v: (i.gas ?? 0) > 0.5 ? 0 : 3.3 }); } break;
        case 'soil': if (powered(p, 'VCC', 'GND')) drive(`${p.id}.AOUT`, { v: 2.9 - 1.8 * (i.moist ?? 0) }); break;
        case 'hcsr04': if (powered(p, 'VCC', 'GND')) drive(`${p.id}.ECHO`, { v: 0 }); break;
        case 'mpu6050': if (powered(p, 'VCC', 'GND')) drive(`${p.id}.INT`, { v: 0 }); break;
        case 'drv8833': {
          const vm = pv(`${p.id}.VM`) ?? 0;
          for (let k = 1; k <= 4; k++) {
            const inN = netOf(`${p.id}.IN${k}`); const src = fixed.get(inN) || prev?.A?.get(inN);
            const hi = (src?.v ?? prev?.V?.get(inN) ?? 0) > 1.5;
            if (vm > 2 && pv(`${p.id}.GND`) === 0) drive(`${p.id}.OUT${k}`, { v: hi ? vm : 0, duty: hi ? src?.duty ?? null : null });
          }
          break;
        }
        default:
      }
    }
    // solve the undriven nets through resistors + pull-ups (Gauss-Seidel)
    const allNets = new Set([...parent.keys()].map(find));
    const V = new Map(), A = new Map();
    for (const [n, s] of fixed) { V.set(n, s.v); A.set(n, s); }
    const adj = new Map();
    const link = (a, b, r) => { if (a === b) return; (adj.get(a) || adj.set(a, []).get(a)).push([b, r]); };
    for (const [a, b, r] of res) { link(a, b, r); link(b, a, r); }
    const weakOf = new Map();
    for (const [n, v, r] of weak) (weakOf.get(n) || weakOf.set(n, []).get(n)).push([v, r]);
    // reachability from a source
    const reach = new Set();
    const q = [...fixed.keys(), ...weakOf.keys()];
    for (const n of q) reach.add(n);
    while (q.length) { const n = q.pop(); for (const [m] of adj.get(n) || []) if (!reach.has(m)) { reach.add(m); q.push(m); } }
    const free = [...allNets].filter((n) => !fixed.has(n) && reach.has(n));
    for (const n of free) V.set(n, 0);
    for (let it = 0; it < 60; it++) {
      let delta = 0;
      for (const n of free) {
        let g = 0, s = 0;
        for (const [m, r] of adj.get(n) || []) if (V.has(m)) { g += 1 / r; s += V.get(m) / r; }
        for (const [v, r] of weakOf.get(n) || []) { g += 1 / r; s += v / r; }
        if (!g) continue;
        const nv = s / g; delta = Math.max(delta, Math.abs(nv - V.get(n))); V.set(n, nv);
      }
      if (delta < 1e-4) break;
    }
    // carry PWM / tone / servo through resistors (first driven neighbour with a signal)
    for (const n of free) {
      let best = null;
      const seen = new Set([n]); const qq = [n];
      while (qq.length && !best) { const x = qq.shift(); for (const [m] of adj.get(x) || []) { if (seen.has(m)) continue; seen.add(m); const a = A.get(m); if (a && a.v > 0) { best = a; break; } if (!fixed.has(m)) qq.push(m); } }
      if (best) A.set(n, { ...best, v: V.get(n) });
    }
    const v = (ref) => V.get(netOf(ref)) ?? null;
    const a = (ref) => A.get(netOf(ref)) || null;
    const relay = {};
    for (const p of this.model.parts) if (p.type === 'relay') relay[p.id] = powered2(v, p) && (v(`${p.id}.IN`) ?? 0) > 1.5;
    const sig = { relay, shorts: shorts.length };
    return { netOf, V, A, v, a, relay, shorts, sig, find };
  }

  // ---- reads for the running program
  level(board, n) {
    const s = this.solve();
    const st = this.pins[board]?.[n];
    if (st?.mode === 3) return st.out ? 1 : 0;
    const x = s.v(`${board}:${gpioId(n)}`);
    if (x == null) return 0; // floating input reads LOW here (real hardware: random)
    return x > 1.65 ? 1 : 0;
  }
  floating(board, n) { const s = this.solve(); return s.v(`${board}:${gpioId(n)}`) == null; }
  volts(board, n) { const s = this.solve(); return s.v(`${board}:${gpioId(n)}`) ?? 0; }
  // The parts of `type` whose pin `pinName` shares a net with this board GPIO (or any of its pins when n == null)
  partsAt(board, type, pinName, n) {
    const s = this.solve();
    const out = [];
    for (const p of this.model.parts) {
      if (p.type !== type) continue;
      const net = s.netOf(`${p.id}.${pinName}`);
      if (n != null) { if (net === s.netOf(`${board}:${gpioId(n)}`)) out.push(p); continue; }
      const b = this.boards[board];
      if (b && pinsOf(b.type).some((bp) => bp.kind === 'gpio' && s.netOf(`${board}:${bp.id}`) === net)) out.push(p);
    }
    return out;
  }
  // parts on the I2C bus wired to this board (SDA and SCL both reach board GPIOs)
  i2c(board, type) { return this.partsAt(board, type, 'SDA').filter((p) => this.partsAt(board, type, 'SCL').includes(p)); }
  // ---- push the visual state of every output part (call once per frame)
  refresh() {
    const s = this.solve();
    const { v, a } = s;
    const diff = (ref1, ref2) => { const x = v(ref1), y = v(ref2); return x == null || y == null ? 0 : x - y; };
    const bright = (ref) => { const s0 = a(ref); return s0?.duty != null ? s0.duty : 1; };
    for (const p of this.model.parts) {
      const id = p.id, i = this.inputs[id] || {}, x = this.extra[id] || {};
      let st = null;
      switch (p.type) {
        case 'led': { const vf = LED_VF[p.opts?.color || 'red'] || 1.8; const d = diff(`${id}.A`, `${id}.K`); st = { on: d >= vf ? Math.round(bright(`${id}.A`) * (a(`${id}.K`)?.duty != null ? 1 - a(`${id}.K`).duty : 1) * 100) / 100 : 0 }; break; }
        case 'rgbled': { const c = (k) => (diff(`${id}.${k}`, `${id}.GND`) >= 1.8 ? Math.round(bright(`${id}.${k}`) * 100) / 100 : 0); st = { r: c('R'), g: c('G'), b: c('B') }; break; }
        case 'trafficlight': { const c = (k) => diff(`${id}.${k}`, `${id}.GND`) >= 1.8; st = { r: c('R'), y: c('Y'), g: c('G') }; break; }
        case 'buzzer': { const on = diff(`${id}.+`, `${id}.-`) > 2; const s0 = a(`${id}.+`); st = { on, freq: on ? (s0?.tone || 2300) : 0 }; break; }
        case 'servo': {
          const s0 = a(`${id}.SIG`);
          const pow = (v(`${id}.V+`) ?? 0) >= 3 && v(`${id}.GND`) === 0;
          if (pow && s0?.servo) { const us = Math.max(500, Math.min(2500, s0.servo)); st = { angle: Math.round(((us - 1500) / 1000) * 90 * 10) / 10 }; } else st = null;
          if (!pow && s0?.servo) this.warn(`${id}: the servo has a signal but no power — wire V+ to 5V and GND to GND.`);
          break;
        }
        case 'motor': { const d = diff(`${id}.M+`, `${id}.M-`); const hi = d >= 0 ? a(`${id}.M+`) : a(`${id}.M-`); st = { speed: Math.abs(d) > 1 ? Math.sign(d) * (hi?.duty != null ? hi.duty : 1) : 0 }; break; }
        case 'relay': st = { on: !!s.relay[id] }; break;
        case 'lamp': st = { on: Math.abs(diff(`${id}.L1`, `${id}.L2`)) > 3 }; break;
        case 'stepper': {
          const bits = [1, 2, 3, 4].map((k) => (v(`${id}.IN${k}`) ?? 0) > 1.5);
          const pos = x.pos || 0;
          st = { angle: Math.round((pos / 4096) * 360 * 10) / 10, phase: bits.reduce((m, b, k) => m | (b ? 1 << k : 0), 0) };
          break;
        }
        case 'button': st = { pressed: !!i.pressed }; break;
        case 'pot': st = { value: i.value ?? 0.5 }; break;
        case 'pir': st = { motion: !!i.motion }; break;
        case 'mq2': st = { gas: i.gas ?? 0 }; break;
        case 'ring': st = { pixels: x.pixels || [] }; break;
        case 'matrix': st = { rows: x.rows || [] }; break;
        case 'hcsr04': if (x.ping) { st = { ping: x.ping }; } break;
        default:
      }
      if (!st) continue;
      const j = JSON.stringify(st);
      if (this.shown[id] !== j) { this.shown[id] = j; this.setPart(id, st); }
    }
    return s;
  }
}
function powered2(v, p) { return (v(`${p.id}.VCC`) ?? 0) >= 2.5 && v(`${p.id}.GND`) === 0; }
