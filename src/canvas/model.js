// CircuitDeck · Canvas mode: the workspace model, starters, validation, storage and share links.
// Model: { v, kind:'canvas', name, boards:[{id,type,x,z,rot,lang}], parts:[{id,type,opts,x,z,rot}],
//          wires:[{a,b}], files:{ [boardId]: [{name, code}] } }
// Board pin refs are 'b1:GPIO17'; part pin refs are 'led1.A'.
import { PARTS } from '../core/parts.js';
import { pinsOf } from './hw.js';

export const BOARD_TYPES = {
  esp32: { name: 'ESP32 DevKit', short: 'ESP32', langs: ['cpp', 'py'] },
  esp32s3: { name: 'ESP32-S3 board', short: 'ESP32-S3', langs: ['cpp', 'py'] },
  pi5: { name: 'Raspberry Pi 5', short: 'Pi 5', langs: ['py'] },
};
export const LANG_NAME = { cpp: 'Arduino C++', py: 'Python' };
export const LIMITS = { boards: 4, parts: 80, wires: 400, files: 8, chars: 60000 };
export const CUR_KEY = 'circuitdeck:canvas:current';
const SAVES_KEY = 'circuitdeck:canvas:saves';

export const mainFile = (b) => (b.lang === 'cpp' ? 'sketch.ino' : 'main.py');
export const langName = (b) => (b.lang === 'cpp' ? 'Arduino C++' : b.type === 'pi5' ? 'Python (gpiozero / RPi.GPIO)' : 'MicroPython');
export const isCode = (b, name) => (b.lang === 'cpp' ? /\.(ino|h|hpp|cpp)$/.test(name) : /\.py$/.test(name));

// ---------------------------------------------------------------- starter code
export const CODE = {
  cpp(led = 26) {
    return `// Blink an LED on GPIO${led} (through a 330 Ω resistor)
const int LED_PIN = ${led};

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  Serial.println("Hello from the canvas!");
}

void loop() {
  digitalWrite(LED_PIN, HIGH);
  delay(500);
  digitalWrite(LED_PIN, LOW);
  delay(500);
}
`;
  },
  mpy(led = 26) {
    return `# MicroPython: blink an LED on GPIO${led}
from machine import Pin
import time

led = Pin(${led}, Pin.OUT)
print("Hello from the canvas!")
while True:
    led.value(not led.value())
    time.sleep(0.5)
`;
  },
  pi(led = 17) {
    return `# Raspberry Pi 5 · gpiozero: blink an LED on GPIO${led}
from gpiozero import LED
from time import sleep

led = LED(${led})
print("Hello from the canvas!")
while True:
    led.on()
    sleep(0.5)
    led.off()
    sleep(0.5)
`;
  },
  blankCpp: () => '// Arduino C++ for this board\n\nvoid setup() {\n  Serial.begin(115200);\n}\n\nvoid loop() {\n}\n',
  blankMpy: () => '# MicroPython for this board\nfrom machine import Pin\nimport time\n\n',
  blankPi: () => '# Python on the Raspberry Pi 5 (gpiozero)\nfrom gpiozero import LED, Button\nfrom signal import pause\n\n',
};
export function defaultFiles(type, lang, starter = true, led) {
  if (lang === 'cpp') return [{ name: 'sketch.ino', code: starter ? CODE.cpp(led) : CODE.blankCpp() }];
  if (type === 'pi5') return [{ name: 'main.py', code: starter ? CODE.pi(led) : CODE.blankPi() }];
  return [{ name: 'main.py', code: starter ? CODE.mpy(led) : CODE.blankMpy() }];
}
const gnd = (type) => pinsOf(type).find((p) => p.kind === 'gnd').id;
const BOARD_SPOT = { esp32: [-4.2, 0.6], esp32s3: [-4.6, 0.6], pi5: [-6.5, 0] };

// A blink circuit on one board (LED + 330 Ω), ids suffixed so several can share a canvas.
function blinkOn(m, bid, type, gpio, sfx = '') {
  const r = `r${sfx || 1}`, led = `led${sfx || 1}`;
  m.parts.push({ id: r, type: 'resistor', opts: { ohms: '330' } }, { id: led, type: 'led', opts: { color: sfx === '2' ? 'green' : 'red' } });
  m.wires.push({ a: `${bid}:GPIO${gpio}`, b: `${r}.1` }, { a: `${r}.2`, b: `${led}.A` }, { a: `${led}.K`, b: `${bid}:${gnd(type)}` });
}
export const STARTERS = [
  { id: 'blank', title: 'Blank canvas', blurb: 'Nothing yet — add boards and parts yourself.' },
  { id: 'esp32', title: 'ESP32 · Arduino', blurb: 'An ESP32 with a blinking LED in Arduino C++.' },
  { id: 'esp32-mpy', title: 'ESP32 · MicroPython', blurb: 'The same blink in MicroPython.' },
  { id: 'esp32s3', title: 'ESP32-S3', blurb: 'An ESP32-S3 with a blinking LED.' },
  { id: 'pi5', title: 'Raspberry Pi 5', blurb: 'A Pi 5 blinking an LED with gpiozero.' },
  { id: 'multi', title: 'Multi-board', blurb: 'An ESP32 and a Pi 5 side by side, each with its own code.' },
];
export function starter(id) {
  const m = { v: 1, kind: 'canvas', name: 'My canvas', boards: [], parts: [], wires: [], files: {} };
  const add = (bid, type, lang, gpio, sfx, at) => {
    m.boards.push({ id: bid, type, lang, x: at?.[0] ?? BOARD_SPOT[type][0], z: at?.[1] ?? BOARD_SPOT[type][1], rot: 0 });
    m.files[bid] = defaultFiles(type, lang, true, gpio);
    blinkOn(m, bid, type, gpio, sfx);
  };
  if (id === 'esp32') { m.name = 'ESP32 blink'; add('b1', 'esp32', 'cpp', 26); }
  else if (id === 'esp32-mpy') { m.name = 'ESP32 MicroPython blink'; add('b1', 'esp32', 'py', 26); }
  else if (id === 'esp32s3') { m.name = 'ESP32-S3 blink'; add('b1', 'esp32s3', 'cpp', 4); }
  else if (id === 'pi5') { m.name = 'Pi 5 blink'; add('b1', 'pi5', 'py', 17); }
  else if (id === 'multi') { m.name = 'Two boards'; add('b1', 'esp32', 'cpp', 26, '', [-4.2, -1.6]); add('b2', 'pi5', 'py', 17, '2', [-6.5, 7.2]); }
  else m.name = 'Blank canvas';
  return m;
}

// ---------------------------------------------------------------- validation
const ID = /^[A-Za-z][A-Za-z0-9_]{0,23}$/;
const FILE = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,39}$/;
const num = (v, lim = 80) => (Number.isFinite(+v) && Math.abs(+v) <= lim ? +(+v).toFixed(2) : undefined);
export function validate(raw) {
  if (!raw || typeof raw !== 'object' || raw.kind !== 'canvas') throw new Error('Not a CircuitDeck canvas file.');
  const boards = Array.isArray(raw.boards) ? raw.boards : [];
  const parts = Array.isArray(raw.parts) ? raw.parts : [];
  const wires = Array.isArray(raw.wires) ? raw.wires : [];
  if (boards.length > LIMITS.boards) throw new Error(`Too many boards (max ${LIMITS.boards}).`);
  if (parts.length > LIMITS.parts) throw new Error(`Too many parts (max ${LIMITS.parts}).`);
  if (wires.length > LIMITS.wires) throw new Error(`Too many wires (max ${LIMITS.wires}).`);
  const m = { v: 1, kind: 'canvas', name: String(raw.name || 'My canvas').replace(/[<>]/g, '').slice(0, 60).trim() || 'My canvas', boards: [], parts: [], wires: [], files: {} };
  const ids = new Set();
  for (const b of boards) {
    if (!b || !ID.test(b.id) || ids.has(b.id)) throw new Error('Bad board id.');
    if (!BOARD_TYPES[b.type]) throw new Error(`Unknown board “${String(b.type).slice(0, 20)}”.`);
    ids.add(b.id);
    const lang = BOARD_TYPES[b.type].langs.includes(b.lang) ? b.lang : BOARD_TYPES[b.type].langs[0];
    m.boards.push({ id: b.id, type: b.type, lang, x: num(b.x) ?? BOARD_SPOT[b.type][0], z: num(b.z) ?? BOARD_SPOT[b.type][1], rot: [0, 90, 180, 270].includes(b.rot) ? b.rot : 0 });
    const fl = Array.isArray(raw.files?.[b.id]) ? raw.files[b.id] : [];
    const files = [];
    for (const f of fl.slice(0, LIMITS.files)) {
      if (!f || !FILE.test(f.name) || files.some((x) => x.name === f.name)) continue;
      files.push({ name: f.name, code: String(f.code ?? '').slice(0, LIMITS.chars) });
    }
    if (!files.some((f) => f.name === mainFile({ lang }))) files.unshift(defaultFiles(b.type, lang, false)[0]);
    m.files[b.id] = files;
  }
  for (const p of parts) {
    if (!p || !ID.test(p.id) || ids.has(p.id)) throw new Error(`Bad or duplicate part id “${String(p?.id).slice(0, 20)}”.`);
    if (!PARTS[p.type]) throw new Error(`Unknown part “${String(p.type).slice(0, 20)}”.`);
    ids.add(p.id);
    const opts = {};
    for (const [k, ch] of Object.entries(PARTS[p.type].props || {})) if (ch.includes(p.opts?.[k])) opts[k] = p.opts[k];
    m.parts.push({ id: p.id, type: p.type, opts, x: num(p.x), z: num(p.z), rot: [0, 90, 180, 270].includes(p.rot) ? p.rot : 0 });
  }
  const okRef = (r) => {
    if (typeof r !== 'string') return false;
    const i = r.indexOf(':');
    if (i > 0) { const b = m.boards.find((x) => x.id === r.slice(0, i)); return !!b && pinsOf(b.type).some((p) => p.id === r.slice(i + 1)); }
    const j = r.indexOf('.');
    const p = j > 0 && m.parts.find((x) => x.id === r.slice(0, j));
    return !!p && PARTS[p.type].pins.some((d) => d.n === r.slice(j + 1));
  };
  for (const w of wires) {
    const a = Array.isArray(w) ? w[0] : w?.a, b = Array.isArray(w) ? w[1] : w?.b;
    if (!okRef(a) || !okRef(b)) throw new Error(`Bad wire ${String(a).slice(0, 30)} → ${String(b).slice(0, 30)}.`);
    if (a !== b && !m.wires.some((x) => (x.a === a && x.b === b) || (x.a === b && x.b === a))) m.wires.push({ a, b });
  }
  return m;
}
export const serialize = (m) => JSON.stringify({ v: 1, kind: 'canvas', name: m.name, boards: m.boards, parts: m.parts, wires: m.wires, files: m.files });
export const clone = (m) => JSON.parse(serialize(m));

// ---------------------------------------------------------------- share links (#c= deflate-raw, #j= plain)
const b64u = (bytes) => { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const unb64u = (s) => { const t = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)); return Uint8Array.from(t, (ch) => ch.charCodeAt(0)); };
const pipe = async (bytes, stream) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
export async function encodeShare(m) {
  const bytes = new TextEncoder().encode(serialize(m));
  if (typeof CompressionStream === 'function') return `c=${b64u(await pipe(bytes, new CompressionStream('deflate-raw')))}`;
  return `j=${b64u(bytes)}`;
}
export async function decodeShare(hash) {
  const h = hash.replace(/^#/, '');
  const k = h.slice(0, 2), body = h.slice(2);
  if (body.length > 400000) throw new Error('Too big.');
  let bytes = unb64u(body);
  if (k === 'c=') bytes = await pipe(bytes, new DecompressionStream('deflate-raw'));
  else if (k !== 'j=') throw new Error('Not a canvas link.');
  return validate(JSON.parse(new TextDecoder().decode(bytes)));
}

// ---------------------------------------------------------------- storage
// The current canvas autosaves to localStorage; named saves live in IndexedDB
// (falling back to localStorage when IndexedDB is unavailable).
export function loadCurrent() { try { const r = localStorage.getItem(CUR_KEY); return r ? validate(JSON.parse(r)) : null; } catch { return null; } }
export function saveCurrent(m) { try { localStorage.setItem(CUR_KEY, serialize(m)); return true; } catch { return false; } }
let dbp = null;
function db() {
  if (!('indexedDB' in globalThis)) return Promise.resolve(null);
  return (dbp ||= new Promise((res) => {
    try {
      const r = indexedDB.open('circuitdeck-canvas', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('saves', { keyPath: 'name' });
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
    } catch { res(null); }
  }));
}
const tx = (d, mode, fn) => new Promise((res, rej) => { const t = d.transaction('saves', mode); const s = t.objectStore('saves'); const r = fn(s); t.oncomplete = () => res(r?.result); t.onerror = () => rej(t.error); });
const lsSaves = () => { try { const s = JSON.parse(localStorage.getItem(SAVES_KEY) || '[]'); return Array.isArray(s) ? s : []; } catch { return []; } };
export async function listSaves() {
  const d = await db();
  const all = d ? await tx(d, 'readonly', (s) => s.getAll()).catch(() => lsSaves()) : lsSaves();
  return (all || []).filter((s) => s && typeof s.name === 'string' && s.canvas).sort((a, b) => (b.at || 0) - (a.at || 0));
}
export async function saveNamed(m) {
  const rec = { name: m.name, at: Date.now(), canvas: JSON.parse(serialize(m)) };
  const d = await db();
  try {
    if (d) { await tx(d, 'readwrite', (s) => s.put(rec)); return true; }
    const list = lsSaves().filter((s) => s.name !== m.name); list.unshift(rec); localStorage.setItem(SAVES_KEY, JSON.stringify(list.slice(0, 50))); return true;
  } catch { return false; }
}
export async function deleteSave(name) {
  const d = await db();
  if (d) await tx(d, 'readwrite', (s) => s.delete(name)).catch(() => {});
  else localStorage.setItem(SAVES_KEY, JSON.stringify(lsSaves().filter((s) => s.name !== name)));
}
export function download(m) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(JSON.parse(serialize(m)), null, 2)], { type: 'application/json' }));
  a.download = `${m.name.replace(/[^\w-]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'canvas'}.canvas.json`;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
