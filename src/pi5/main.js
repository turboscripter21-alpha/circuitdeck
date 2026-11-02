// CircuitDeck · Raspberry Pi 5 track — and, from M8, the TinyML track (/tinyml/),
// which reuses this page with an ESP32-S3 CAM board and its own project list.
// Builds each project's 3D scene from its data (projects-a/b.js or
// ../tinyml/projects.js), runs its simulation against the code card, and keeps
// per-project progress.
import * as THREE from 'three';
import { createFit, startClock, storeGet, storeSet, esc } from '../core/layout.js';
import { createStage } from '../core/stage.js';
import { PI, PI5_LAYOUT } from '../core/pi5model.js';
import { sfx, isSoundOn, setSound } from '../core/sound.js';
import { buildPi5, buildEsp32, buildBreadboard, PI_PIN_NUMBER, PI_ALT } from '../core/boards.js';
import { makePart, drawScreen, PARTS } from '../core/parts.js';
import { ICONS, codeCard, tabs, flyout, inspector, lessonStrip, progress } from '../core/ui.js';

const TINY = location.pathname.startsWith('/tinyml');
const { PROJECTS, byId, buyList, BB } = await import(TINY ? '../tinyml/projects.js' : './projects.js');
// everything that differs between the two tracks that use this page
const CFG = TINY ? {
  key: 'tinyml', board: 'ESP32-S3 CAM', short: 'TinyML', track: 'TinyML', tagColor: '#2b6cb0', top: 0.16,
  build: () => buildEsp32({ s3: true }),
  boardInfo: { title: 'ESP32-S3 CAM board', desc: 'An ESP32-S3 (two Xtensa LX7 cores at 240 MHz with vector instructions for neural networks), 8 MB PSRAM and a camera connector — a popular, cheap board for TinyML.', rows: [['CPU', '2 × LX7 @ 240 MHz'], ['Memory', '512 KB SRAM + 8 MB PSRAM'], ['Logic', '3.3 V']] },
  pinLabel: (n) => (n === 'CAM' ? 'Camera connector (24-pin DVP)' : n),
  prompt: (p) => (p.lang === 'py' ? `you@laptop:~ $ python3 ${p.id}.py` : `Compiling ${p.id}.ino for ESP32-S3… uploaded. Serial monitor @ 115200 baud`),
  stopText: (p) => (p.lang === 'py' ? '^C\nKeyboardInterrupt' : '(board reset)'),
  console: 'Serial monitor', list: 'TinyML projects', pinHead: 'ESP32-S3 pin',
  pinSub: 'How this circuit is wired to the ESP32-S3. Pin names are the GPIO numbers you use in code.',
  buyNote: 'Generic parts — any electronics supplier will do. The models are trained on your laptop (free tools) and run on the board without a network.',
  aloneNote: 'This project uses the ESP32-S3 board on its own.',
  refNote: 'TinyML facts used here: ESP32-S3 with 2 × Xtensa LX7 @ 240 MHz and vector (SIMD) instructions, 512 KB SRAM, 8 MB PSRAM; models are int8 TensorFlow Lite for Microcontrollers (TFLite Micro / ESP-NN). The webcam demos run Google MediaPipe in your browser — no video leaves this device.',
  lang: 'The TinyML track is in English for now. The ESP32 track has more languages.',
} : {
  key: 'pi5', board: 'Raspberry Pi 5', short: 'Pi 5', track: 'Raspberry Pi 5', tagColor: '#c51a4a', top: PI.t,
  build: buildPi5,
  boardInfo: { title: 'Raspberry Pi 5', desc: 'BCM2712 quad-core Arm Cortex-A76 @ 2.4 GHz, with the RP1 I/O chip handling GPIO, USB and Ethernet.', rows: [['CPU', '4 × Cortex-A76 @ 2.4 GHz'], ['Power', '5 V / 5 A USB-C (27 W)'], ['GPIO', '3.3 V logic']] },
  pinLabel: null,
  prompt: (p) => (p.lang === 'sh' ? `pi@raspberrypi:~ $ bash ${p.id}.sh` : `pi@raspberrypi:~ $ python3 ${p.id}.py`),
  stopText: (p) => (p.lang === 'sh' ? '^C' : '^C\nKeyboardInterrupt'),
  console: 'Terminal', list: 'Pi 5 projects', pinHead: 'Pi 5 pin',
  pinSub: 'How this circuit is wired to the Pi 5. GPIO numbers are BCM numbers, as gpiozero uses them.',
  buyNote: 'Generic parts — any electronics supplier will do. Already have a Pi 5 set-up? Skip the first three lines.',
  aloneNote: 'This project uses the Pi 5 on its own — click any part of the board to learn about it.',
  refNote: 'Pi 5 facts used here: BCM2712, 4 × Cortex-A76 @ 2.4 GHz; RP1 I/O chip; 3.3 V GPIO; 5 V / 5 A USB-C; PCIe 2.0 ×1; two 4-lane MIPI CSI/DSI ports. GPIO code uses <code>gpiozero</code> (lgpio backend) — <code>RPi.GPIO</code> and <code>pigpio</code> do not work on the Pi 5.',
  lang: 'The Pi 5 track is in English for now. The ESP32 track has more languages.',
};

const $ = (s, r = document) => r.querySelector(s);
const DONE_KEY = `circuitdeck:${CFG.key}:done`;
const SET_KEY = `circuitdeck:${CFG.key}:settings`;
const PI_POS = new THREE.Vector3(TINY ? -7.2 : -6.5, 0, 0);
const PI_TOP = CFG.top; // top face of the board's PCB
const PALETTE = ['#f0a53a', '#3d6fc4', '#2fa36b', '#8f45b8', '#e05a8a', '#1aa3b8', '#c9842b', '#6b7cff'];
const PIN_COLORS = { '5V': '#d83a34', '3V3': '#f08a24', GND: '#2f3547' };
const STOP = Symbol('stop');

// ------------------------------------------------------------------ state
const done = new Set(storeGet(DONE_KEY, []).filter((id) => byId[id]));
const settings = { labels: true, ...storeGet(SET_KEY, {}) };
delete settings.sound;
let project = null;          // the project on screen
const removed = new Set();   // part ids taken out in Components (this project only)
let insts = {};              // part id -> part instance
let tagByPart = {};          // part id -> tag object
let wireColors = {};         // board pin -> css colour used for its wire
let inputs = {};             // input id -> current value
let run = null;              // the running simulation, if any
let previewFn = null;

// ------------------------------------------------------------------ layout
const app = $('#app');
startClock($('#clock-date'), $('#clock-time'));

let stage = null;
createFit(app, () => stage?.resize());
stage = createStage({ canvas: $('#board-canvas'), tagsEl: $('#tags'), leadersEl: $('#leaders'), tipEl: $('#tip'), viewbar: $('#viewbar'), rigEl: $('#rig') });
const cc = codeCard($('.code-card'), { onRun: start, onStop: () => stop(true), consoleTitle: CFG.console });
const info = tabs($('.info-card'), renderTab);
const fly = flyout($('#flyout'), $('.sidebar'));
const insp = inspector($('#inspector'));
const prog = progress($('.status'), CFG.board);
const strip = lessonStrip($('.lessons'), { items: PROJECTS, onPick: (id) => go(id) });
const panel = $('#cd-panel');

// ------------------------------------------------------------------ scene
let pi = null;
function worldOf(obj, local) { obj.updateMatrixWorld(true); return obj.localToWorld(local.clone()); }

function boardPoint(name) {
  const p = pi.pinPoint(name);
  return p ? worldOf(pi.group, p) : null;
}
function endpoint(ref) {
  const dot = ref.indexOf('.');
  if (dot < 0) return { board: true, name: ref, point: boardPoint(ref) };
  const id = ref.slice(0, dot), pin = ref.slice(dot + 1);
  const inst = insts[id];
  if (!inst || !inst.pins[pin]) return null;
  return { board: false, id, pin, inst, point: worldOf(inst.group, inst.pins[pin]) };
}
function pinLabel(name) {
  if (CFG.pinLabel) return CFG.pinLabel(name);
  if (name === 'CAM0' || name === 'CAM1') return `${name} camera/display port (22-pin)`;
  if (name === 'PCIE') return 'PCIe 2.0 ×1 connector (FPC)';
  if (name === 'FAN') return '4-pin fan connector (JST, PWM)';
  const n = PI_PIN_NUMBER[name];
  return n ? `${name} · physical pin ${n}${PI_ALT[name] ? ` · ${PI_ALT[name]}` : ''}` : name;
}
function partPinLabel(e) {
  const def = PARTS[e.inst.type];
  const pin = def.pins.find((p) => p.n === e.pin);
  return `${labelOf(e.id)} · ${pin?.label || e.pin}`;
}
const labelOf = (id) => project.parts.find((p) => p.id === id)?.label || id;

function buildScene(p) {
  stage.clearTicks();
  stage.clear();
  sfx.stopAll();
  insts = {}; tagByPart = {}; wireColors = {};
  pi = CFG.build();
  pi.group.position.copy(PI_POS);
  stage.content.add(pi.group);
  pi.group.traverse((o) => { if (o.userData.info) o.userData.pick = { board: true }; });

  let bbTop = 0;
  if (!p.noBreadboard) {
    const bb = buildBreadboard(BB.w, BB.d);
    bb.group.position.set(BB.x, 0, BB.z);
    stage.content.add(bb.group);
    bbTop = bb.top;
  }
  for (const part of p.parts) {
    if (removed.has(part.id)) continue;
    const inst = makePart(part.type, part.opts || {});
    const [x, z] = part.at;
    if (part.mount === 'pi') inst.group.position.set(PI_POS.x + x, PI_TOP + 0.02, PI_POS.z + z);
    else inst.group.position.set(x, part.table || p.noBreadboard ? 0 : bbTop, z);
    if (part.rot) inst.group.rotation.y = part.rot;
    const def = PARTS[part.type];
    inst.group.userData.info = {
      title: part.label, desc: def.desc,
      rows: [['Part', def.name], ...(part.why ? [['Needed because', `without it ${part.why}`]] : []), ['Buy', def.buy]],
    };
    inst.group.userData.pick = { part: part.id };
    stage.content.add(inst.group);
    insts[part.id] = inst;
    if (inst.tick) stage.addTick((t, dt) => inst.tick(t, dt));
  }
  // wires
  let pal = 0;
  for (const [from, to, o = {}] of p.wires) {
    const a = endpoint(from), b = endpoint(to);
    if (!a?.point || !b?.point) continue; // a removed part leaves its wires out too
    const boardEnd = a.board ? a : b.board ? b : null;
    const ribbon = boardEnd && ['CAM0', 'CAM1', 'PCIE', 'CAM'].includes(boardEnd.name);
    const gndish = [a, b].some((e) => !e.board && PARTS[e.inst.type].pins.find((x) => x.n === e.pin)?.role === 'gnd');
    let css = boardEnd ? PIN_COLORS[boardEnd.name] : gndish ? PIN_COLORS.GND : null;
    if (!css) css = PALETTE[pal++ % PALETTE.length];
    if (o.color != null) css = `#${o.color.toString(16).padStart(6, '0')}`;
    if (boardEnd && !wireColors[boardEnd.name]) wireColors[boardEnd.name] = css;
    const color = new THREE.Color(css).getHex();
    const la = a.board ? pinLabel(a.name) : partPinLabel(a), lb = b.board ? pinLabel(b.name) : partPinLabel(b);
    stage.addWire(a.point, b.point, ribbon ? 0xe8e0d0 : color, {
      ribbon, width: boardEnd?.name === 'PCIE' ? 0.8 : 0.9, radius: o.radius,
      info: { title: ribbon ? 'Ribbon cable' : 'Jumper wire', desc: ribbon ? (TINY ? 'The camera’s flat flexible cable plugs straight into the board’s 24-pin connector.' : 'A flat flexible cable. Pi 5 uses the small 22-pin connector, so standard cameras need a 22-to-15-pin cable.') : 'A jumper wire joins two points of the circuit.', rows: [['From', la], ['To', lb]] },
    });
  }
  pi.resetPins();
  // tags
  // the tour: ESP32-style callout cards round the bare board
  const tour = !TINY && p.noBreadboard && !p.parts.length;
  const T = PI.t, HW = PI.w / 2, HD = PI.d / 2;
  const infoOf = (title) => { let hit = null; pi.group.traverse((o) => { if (!hit && o.userData.info?.title?.startsWith(title)) hit = o.userData.info; }); return hit; };
  const C = (title, icon, body, at, x, y, find) => ({ title, icon, body, x, y, w: 226, anchor: worldOf(pi.group, new THREE.Vector3(...at)), onClick: (e) => { const d = infoOf(find); if (d) inspectAt(d, e); } });
  const compact = document.documentElement.classList.contains('compact');
  const PHONE_TAGS = ['GPIO Header', 'BCM2712 SoC', 'USB-C Power', 'USB 3.0', 'Camera / Display']; // phones show tags only; keep them from piling up
  stage.setCallouts(tour ? [
    C('GPIO Header', 'pins', '40 pins: GPIO,<br />3.3 V, 5 V, ground.', [-1.1, T + 0.9, PI5_LAYOUT.header.rowOdd - 0.13], -240, -420, '40-pin'),
    C('BCM2712 SoC', 'chip', 'Four 2.4 GHz<br />Cortex-A76 cores.', [PI5_LAYOUT.soc[0], T + 0.24, PI5_LAYOUT.soc[1]], -505, -330, 'BCM2712'),
    C('LPDDR4X RAM', 'memory', '1 to 16 GB of fast<br />working memory.', [PI5_LAYOUT.ram[0], T + 0.2, PI5_LAYOUT.ram[1]], 40, -420, 'LPDDR4X'),
    C('Micro-HDMI', 'hdmi', 'Two 4K60 screens<br />at once.', [PI5_LAYOUT.hdmi[0], T + 0.3, HD + 0.05], -510, -85, 'Micro'),
    C('USB-C Power', 'bolt', '5 V / 5 A in, from<br />a USB-PD supply.', [PI5_LAYOUT.usbc, T + 0.3, HD + 0.05], -505, -195, 'USB-C'),
    C('Fan', 'fan', 'Header for the<br />Active Cooler.', [PI5_LAYOUT.fan[0], T + 0.25, PI5_LAYOUT.fan[1]], 285, -330, 'Fan'),
    C('RP1 I/O', 'io', 'GPIO, USB, Ethernet<br />and cameras.', [PI5_LAYOUT.rp1[0], T + 0.18, PI5_LAYOUT.rp1[1]], 40, 190, 'RP1'),
    C('USB 3.0', 'usb', 'Two 5 Gbps ports,<br />plus two USB 2.0.', [HW + 0.2, T + 1.2, PI5_LAYOUT.usb3], 285, -180, 'USB 3.0'),
    C('Ethernet', 'ethernet', 'Gigabit wired<br />networking.', [HW + 0.2, T + 1.1, PI5_LAYOUT.eth], 296, -20, 'Gigabit Ethernet'),
    C('Camera / Display', 'camera', 'Two MIPI ports for<br />cameras or screens.', [PI5_LAYOUT.cam0[0], T + 0.12, PI5_LAYOUT.cam0[1]], -250, 190, 'CAM/DISP'),
  ].filter((c) => !compact || PHONE_TAGS.includes(c.title)) : []);
  const tags = tour ? [] : [{ anchor: worldOf(pi.group, new THREE.Vector3(TINY ? -1.5 : 1.5, TINY ? 0.9 : 1.4, TINY ? 0 : 0.6)), label: CFG.board, color: CFG.tagColor, onClick: (e) => inspectAt(pi.group.userData.info || CFG.boardInfo, e) }];
  let k = 0;
  for (const part of p.parts) {
    const inst = insts[part.id];
    if (!inst || part.type === 'resistor' && p.parts.filter((x) => x.type === 'resistor').length > 2) continue;
    const t = { anchor: worldOf(inst.group, inst.anchor || new THREE.Vector3(0, 1, 0)), label: part.label, color: PALETTE[k++ % PALETTE.length], lift: 38 + (k % 2) * 16, onClick: (e) => inspectPart(part.id, e) };
    tags.push(t);
  }
  stage.setTags(tags);
  stage.setTagsVisible(settings.labels);
  tags.forEach((t, i) => { if (i || tour) tagByPart[p.parts.find((x) => x.label === t.label)?.id] = t; });
  stage.addTick((t) => drawPreview(t));
  stage.setAmbient(1);
  stage.frame([stage.content, stage.wires], tour ? (compact ? { fill: 0.8 } : { fill: 0.58, shift: [10, 66] }) : { fill: p.noBreadboard ? 0.5 : 0.62 });
}

// ------------------------------------------------------------------ inspector
function stagePoint(e) {
  const r = $('#stage').getBoundingClientRect();
  const sc = r.width / $('#stage').offsetWidth || 1;
  return { x: (e.clientX - r.left) / sc, y: (e.clientY - r.top) / sc };
}
function inspectAt(data, e, actions = '') { insp.show(data, { ...(e ? stagePoint(e) : { x: 60, y: 120 }), actions }); }
function inspectPart(id, e) {
  const inst = insts[id];
  if (!inst) return;
  const part = project.parts.find((p) => p.id === id);
  const req = part.required !== false;
  const act = `<div class="cd-insp-act"><button type="button" class="cd-btn" data-remove="${esc(id)}">Remove from circuit</button>${req ? '<small>Required — the program will tell you it is missing.</small>' : '<small>Optional for this project.</small>'}</div>`;
  inspectAt(inst.group.userData.info, e, act);
}
$('#inspector').addEventListener('click', (e) => {
  const b = e.target.closest('[data-remove]');
  if (!b) return;
  togglePart(b.dataset.remove, false);
  insp.hide();
});
stage.onPick((hit, e) => {
  if (!hit) { insp.hide(); return; }
  if (hit.pick?.part) {
    const inst = insts[hit.pick.part];
    if (inst?.pressable) pressButton(hit.pick.part);
    inspectPart(hit.pick.part, e);
    return;
  }
  if (hit.info) inspectAt(hit.info, e);
});
function pressButton(id) {
  const inp = project.inputs?.find((i) => i.id === id && (i.type === 'hold' || i.type === 'pulse'));
  if (!inp) return;
  setInput(id, true);
  setTimeout(() => setInput(id, false), inp.ms || 350);
}

// ------------------------------------------------------------------ inputs panel
function setInput(id, v) {
  inputs[id] = v;
  if (insts[id]?.pressable) insts[id].set({ pressed: !!v });
  const el = panel.querySelector(`[data-input="${id}"]`);
  if (el?.type === 'range') { el.value = v; el.nextElementSibling.textContent = fmtInput(project.inputs.find((i) => i.id === id), v); }
  if (el?.tagName === 'BUTTON') el.classList.toggle('is-down', !!v);
}
function fmtInput(i, v) { return i.max <= 1 && !i.unit ? `${Math.round(v * 100)} %` : `${v}${i.unit ? ` ${i.unit}` : ''}`; }
function renderPanel(p) {
  inputs = {};
  const list = p.inputs || [];
  for (const i of list) inputs[i.id] = i.type === 'range' ? i.value : i.type === 'choice' ? i.options[0] : false;
  if (!list.length && !p.preview) { panel.hidden = true; panel.innerHTML = ''; return; }
  panel.hidden = false;
  const rows = list.map((i) => {
    if (i.type === 'range') return `<label class="cd-in"><span>${esc(i.label)}</span><input type="range" data-input="${i.id}" min="${i.min}" max="${i.max}" step="${i.step}" value="${i.value}"><output>${esc(fmtInput(i, i.value))}</output></label>`;
    if (i.type === 'choice') return `<label class="cd-in"><span>${esc(i.label)}</span><select data-input="${i.id}">${i.options.map((o) => `<option>${esc(o)}</option>`).join('')}</select></label>`;
    return `<button type="button" class="cd-btn cd-press" data-input="${i.id}" data-kind="${i.type}">${ICONS.hand}<span>${esc(i.label)}</span></button>`;
  }).join('');
  panel.innerHTML = `<header><h3>${p.preview ? (p.previewTitle || 'Camera &amp; inputs') : 'Inputs'}</h3><small>Simulated</small></header>${p.preview ? `<canvas class="cd-preview" width="320" height="180" aria-label="${esc(p.previewLabel || 'Simulated camera preview')}"></canvas>` : ''}${p.ml ? '<div class="cd-ml-row"></div><p class="cd-ml-note" hidden></p>' : ''}${rows}`;
  if (p.ml) mountWebcam(p); else stopWebcam();
  drawPreview(0, true);
}

// ------------------------------------------------------------------ M8: in-browser ML on the user's webcam
// The camera projects can swap the simulated feed for the real webcam: MediaPipe
// (or jsQR) runs on this device and the simulation reads its results via ctx.live().
let liveCam = null, mlBtn = null;
const ML_TEXT = {
  objects: 'Object detection runs on this device with MediaPipe — no video leaves your browser.',
  pose: 'Pose landmarks run on this device with MediaPipe — no video leaves your browser.',
  qr: 'QR decoding runs on this device with jsQR — no video leaves your browser. Hold a QR code up to the camera.',
  faces: 'Face detection runs on this device with MediaPipe — no video leaves your browser.',
  hands: 'Hand landmarks run on this device with MediaPipe — no video leaves your browser.',
};
async function mountWebcam(p) {
  stopWebcam();
  const row = panel.querySelector('.cd-ml-row'), note = panel.querySelector('.cd-ml-note');
  let ML;
  try { ML = await import('/shared/ml-camera.js'); } catch { return; }
  if (project !== p || !row.isConnected) return;
  if (!ML.supported()) { note.hidden = false; note.textContent = 'Your browser can’t open a webcam here, so the camera stays simulated.'; return; }
  mlBtn = ML.toggleButton({
    mode: p.ml, label: 'Use my webcam (runs in your browser)',
    onStart(cam) { liveCam = cam; syncLive(); },
    onStop() { liveCam = null; syncLive(); },
    onError(msg) { note.hidden = false; note.textContent = msg; },
  });
  row.append(mlBtn);
  note.hidden = false; note.textContent = ML_TEXT[p.ml] || ML_TEXT.objects;
}
function syncLive() {
  const small = panel.querySelector('header small');
  if (small) small.textContent = liveCam ? 'Your webcam' : 'Simulated';
  // a webcam replaces the simulated choices that describe the scene
  for (const i of project?.inputs || []) if (i.scene) { const l = panel.querySelector(`[data-input="${i.id}"]`)?.closest('label'); if (l) l.style.display = liveCam ? 'none' : ''; }
  drawPreview(0, true);
}
function stopWebcam() { if (mlBtn) { mlBtn.stopCam?.(); mlBtn = null; } liveCam = null; }
panel.addEventListener('input', (e) => {
  const el = e.target.closest('[data-input]');
  if (!el) return;
  const i = project.inputs.find((x) => x.id === el.dataset.input);
  setInput(i.id, el.type === 'range' ? Number(el.value) : el.value);
});
panel.addEventListener('pointerdown', (e) => {
  const b = e.target.closest('button[data-input]');
  if (!b) return;
  const i = project.inputs.find((x) => x.id === b.dataset.input);
  setInput(i.id, true);
  if (i.type === 'pulse') { setTimeout(() => setInput(i.id, false), i.ms || 1000); return; }
  const up = () => { setInput(i.id, false); removeEventListener('pointerup', up); removeEventListener('pointercancel', up); };
  addEventListener('pointerup', up); addEventListener('pointercancel', up);
});
panel.addEventListener('keydown', (e) => {
  const b = e.target.closest('button[data-input]');
  if (b && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); e.stopPropagation(); pressButton(b.dataset.input) || setInput(b.dataset.input, true); setTimeout(() => setInput(b.dataset.input, false), 400); }
});
function drawPreview(t, force) {
  const cv = panel.querySelector('.cd-preview');
  if (!cv || (!previewFn && !liveCam && !force)) return;
  const c = cv.getContext('2d');
  if (liveCam) { liveCam.draw(c, cv.width, cv.height); return; }
  if (previewFn) { previewFn(c, cv.width, cv.height, t); return; }
  const dark = document.documentElement.dataset.theme === 'dark';
  c.fillStyle = dark ? '#0d1218' : '#1b2330'; c.fillRect(0, 0, cv.width, cv.height);
  c.fillStyle = '#9aa6b5'; c.font = '600 15px "Barlow Semi Condensed", sans-serif'; c.textAlign = 'center';
  c.fillText(insts.cam ? 'Camera idle — press Run' : 'No camera connected', cv.width / 2, cv.height / 2 + 5);
}

// ------------------------------------------------------------------ audio
// Part sounds (buzzers, relays, servos, motors, steppers, fans, buttons) come from
// core/sound.js reacting to part state changes; these two are kept for the sim API.
function beep(on) { if (!on) return; }
function click() { sfx.shutter(); }

// ------------------------------------------------------------------ simulation
async function start() {
  if (run) return;
  const p = project;
  cc.clear(); cc.setRunning(true);
  cc.print(CFG.prompt(p), 'cd-cmd');
  const missing = p.parts.filter((x) => x.required !== false && removed.has(x.id));
  if (missing.length) {
    for (const m of missing) cc.print(`✗ ${m.label} is missing — ${m.why ? `without it ${m.why}` : 'this program needs it'}. Add it back in Components.`, 'cd-err');
    cc.setRunning(false);
    cc.openConsole();
    const nav = $('[data-nav=parts]'); nav.classList.add('cd-flash'); setTimeout(() => nav.classList.remove('cd-flash'), 1600);
    return;
  }
  const token = { stopped: false, timers: new Map() };
  run = token;
  const lines = p.code.split('\n');
  const ctx = {
    at(snip) { const i = lines.findIndex((l) => l.includes(snip)); cc.mark(i >= 0 ? i + 1 : 0); },
    print(text, cls) { if (!token.stopped) cc.print(text, cls); },
    sleep(ms) {
      if (token.stopped) return Promise.reject(STOP);
      return new Promise((res, rej) => { const id = setTimeout(() => { token.timers.delete(id); token.stopped ? rej(STOP) : res(); }, ms); token.timers.set(id, rej); });
    },
    async until(pred) { while (!pred()) await ctx.sleep(50); },
    set(id, patch) { if (!token.stopped) insts[id]?.set(patch); },
    input: (id) => inputs[id],
    live: () => (liveCam?.latest?.ready ? liveCam.latest : null),
    has: (id) => !!insts[id],
    readout(id, text) { const t = tagByPart[id]; if (t?.btn) t.btn.firstChild.textContent = `${t.label} · ${text}`; },
    screen(id, fn) { if (!token.stopped) drawScreen(insts[id], fn); },
    preview(fn) { previewFn = fn; },
    beep(on) { if (!token.stopped) beep(on); },
    click() { if (!token.stopped) click(); },
    ambient(k) { stage.setAmbient((0.45 + 0.6 * Math.max(0, Math.min(1, k))) / 1.05); },
  };
  const credit = setTimeout(() => { if (run === token) markDone(p.id); }, 2500);
  try {
    await p.run(ctx);
    if (run === token) { markDone(p.id); cc.print('Program finished.', 'cd-ok'); }
  } catch (e) {
    if (e !== STOP) { clearTimeout(credit); console.error(e); cc.print(`Simulation error: ${e.message}`, 'cd-err'); }
  } finally {
    if (run === token) stop(false);
  }
}
function stop(user) {
  const token = run;
  if (!token) return;
  token.stopped = true;
  for (const [id, rej] of token.timers) { clearTimeout(id); rej(STOP); }
  token.timers.clear();
  run = null;
  if (user) cc.print(CFG.stopText(project), 'cd-dim');
  cc.setRunning(false);
  resetStates();
}
function resetStates() {
  sfx.stopAll();
  previewFn = null; drawPreview(0, true);
  stage.setAmbient(1);
  for (const [id, inst] of Object.entries(insts)) {
    if (inst.type === 'epaper') continue; // e-paper keeps its picture without power — that is the point
    const s = {};
    for (const k of Object.keys(inst.state)) s[k] = typeof inst.state[k] === 'boolean' ? false : typeof inst.state[k] === 'number' ? 0 : Array.isArray(inst.state[k]) ? inst.state[k].map((v) => (Array.isArray(v) ? v.map(() => 0) : 0)) : inst.state[k];
    if (inst.pressable) s.pressed = !!inputs[id];
    inst.set(s);
    if (inst.screen) drawScreen(inst, (c, w, h) => { c.fillStyle = '#05080c'; c.fillRect(0, 0, w, h); });
    const t = tagByPart[id]; if (t?.btn) t.btn.firstChild.textContent = t.label;
  }
}

// ------------------------------------------------------------------ progress
function markDone(id) {
  if (done.has(id)) return;
  done.add(id);
  storeSet(DONE_KEY, [...done]);
  strip.setDone(done);
  prog.set(done.size, PROJECTS.length);
  const el = $(`.lesson[data-id="${id}"]`);
  el?.classList.add('just-done'); setTimeout(() => el?.classList.remove('just-done'), 1200);
  dispatchEvent(new Event('cd-progress')); // the Recommended-next cards refresh on this
}

// ------------------------------------------------------------------ info tabs
const chip = (cls, html) => `<span class="cd-chip ${cls}">${html}</span>`;
function renderTab(name) {
  const p = project;
  if (!p) return '';
  const i = PROJECTS.indexOf(p), prev = PROJECTS[i - 1], next = PROJECTS[i + 1];
  if (name === 'overview') {
    return `<h2>${esc(p.title)}</h2>
      <div class="cd-meta">${chip(`cd-diff cd-${p.difficulty.toLowerCase()}`, esc(p.difficulty))}${chip('', `${ICONS.clock}${esc(p.time)}`)}${p.topics.map((t) => chip('cd-topic', esc(t))).join('')}</div>
      <p class="lede">${p.lede}</p>
      <ul class="features">${p.features.map(([ic, html]) => `<li><span class="feature-icon">${ICONS[ic] || ICONS.chip}</span><span>${html}</span></li>`).join('')}</ul>
      <nav class="cd-pn" aria-label="Project navigation">
        ${prev ? `<a href="#${prev.id}" class="cd-pn-prev">${ICONS.prev}<span><small>Previous</small>${esc(prev.title)}</span></a>` : '<span></span>'}
        ${next ? `<a href="#${next.id}" class="cd-pn-next"><span><small>Next</small>${esc(next.title)}</span>${ICONS.next}</a>` : ''}
      </nav>`;
  }
  if (name === 'pinout') {
    const rows = p.pinout.map(([pin, to, does]) => `<tr><td><span class="wire-dot" style="--c:${wireColors[pin] || PIN_COLORS[pin] || '#8a94a3'}"></span><code>${esc(pin.replace(/^GPIO/, 'GPIO '))}</code>${!TINY && PI_PIN_NUMBER[pin] ? `<small class="cd-phys">pin ${PI_PIN_NUMBER[pin]}</small>` : ''}</td><td>${esc(to)}</td><td>${esc(does)}</td></tr>`).join('');
    return `<h2>Pinout</h2><p class="sub">${CFG.pinSub}</p>
      <table class="pin-table"><thead><tr><th>${CFG.pinHead}</th><th>Connects to</th><th>What it does</th></tr></thead><tbody>${rows}</tbody></table>`;
  }
  if (name === 'example') return `<h2>How the code works</h2><ol class="steps">${p.steps.map((s) => `<li>${s}</li>`).join('')}</ol>`;
  const buy = buyList(p);
  return `<h2>Specifications</h2>
    <dl class="spec-grid">${p.specs.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
    <h3 class="cd-h3">${ICONS.cart}What to buy</h3>
    <ul class="cd-buy">${buy.map(([q, what]) => `<li><b>${q}×</b><span>${esc(what)}</span></li>`).join('')}</ul>
    <p class="cd-note">${CFG.buyNote}</p>`;
}

// ------------------------------------------------------------------ flyouts
function flyHead(title, extra = '') { return `<header><h2>${title}</h2>${extra ? `<span>${extra}</span>` : ''}</header>`; }
function openFly(kind, link) {
  if (kind === 'lessons') {
    fly.open('lessons', `${flyHead(CFG.list, `${done.size}/${PROJECTS.length} done`)}<ol class="fly-list">${PROJECTS.map((p, i) => `
      <li><button data-go="${p.id}" class="${p === project ? 'is-current' : ''}"><span class="fly-num">${done.has(p.id) ? ICONS.check : i + 1}</span><span class="fly-text"><b>${esc(p.title)}</b><small>${esc(p.difficulty)} · ${esc(p.time)}</small></span></button></li>`).join('')}</ol>`, link);
  } else if (kind === 'parts') {
    const items = project.parts.map((part) => {
      const on = !removed.has(part.id), req = part.required !== false;
      return `<li><label class="switch cd-row"><input type="checkbox" data-part="${part.id}" ${on ? 'checked' : ''}><span class="switch-track"><span></span></span><span class="fly-text"><b>${esc(part.label)}</b><small>${esc(PARTS[part.type].name)} · ${req ? 'required' : 'optional'}</small></span></label></li>`;
    }).join('');
    fly.open('parts', `${flyHead('Components', `${project.parts.length - removed.size}/${project.parts.length} in use`)}
      ${project.parts.length ? `<ul class="fly-list cd-parts">${items}</ul><p class="cd-note">Switch a part off to take it out of the circuit, then press Run to see what happens.</p>${removed.size ? '<button class="cd-btn" data-restore>Put everything back</button>' : ''}` : `<p class="cd-note">${CFG.aloneNote}</p>`}`, link);
  } else if (kind === 'settings') {
    fly.open('settings', `${flyHead('Settings')}<ul class="fly-list cd-parts">
      <li><label class="switch cd-row"><input type="checkbox" data-set="labels" ${settings.labels ? 'checked' : ''}><span class="switch-track"><span></span></span><span class="fly-text"><b>Part labels</b><small>Show the tags over the 3D view</small></span></label></li>
      <li><label class="switch cd-row"><input type="checkbox" data-set="sound" ${isSoundOn() ? 'checked' : ''}><span class="switch-track"><span></span></span><span class="fly-text"><b>Sound</b><small>Buzzers and clicks while running</small></span></label></li>
      <li><label class="switch cd-row"><input type="checkbox" data-set="dark" ${document.documentElement.dataset.theme === 'dark' ? 'checked' : ''}><span class="switch-track"><span></span></span><span class="fly-text"><b>Dark theme</b><small>Also in the header (sun/moon)</small></span></label></li>
      </ul><button class="cd-btn cd-danger" data-reset>Reset ${CFG.short} progress</button>`, link);
  } else if (kind === 'reference') {
    fly.open('reference', `${flyHead('Reference')}<dl class="cd-ref">
      <div><dt>Drag · WASD / arrows</dt><dd>Pan the view (left or right button; one finger on touch)</dd></div><div><dt>Middle-drag · Q / E</dt><dd>Rotate</dd></div><div><dt>Scroll · pinch · + / −</dt><dd>Zoom</dd></div>
      <div><dt>R</dt><dd>Reset the view</dd></div><div><dt>Space</dt><dd>Run / stop the program</dd></div><div><dt>[ · ]</dt><dd>Previous / next project</dd></div>
      <div><dt>Click a part</dt><dd>Inspect it (and remove it)</dd></div></dl>
      <p class="cd-note">${CFG.refNote}</p>`, link);
  } else if (kind === 'language') {
    fly.open('language', `${flyHead('Language')}<p class="cd-note">${CFG.lang}</p>`, link);
  } else if (kind === 'home') { fly.close(); location.href = '/gallery/'; }
}
$('.sidebar').addEventListener('click', (e) => {
  const a = e.target.closest('[data-nav]');
  if (!a) return;
  e.preventDefault();
  openFly(a.dataset.nav, a);
});
$('#flyout').addEventListener('click', (e) => {
  const g = e.target.closest('[data-go]');
  if (g) { fly.close(); go(g.dataset.go); return; }
  if (e.target.closest('[data-restore]')) { removed.clear(); rebuild(); fly.close(); openFly('parts', $('[data-nav=parts]')); return; }
  if (e.target.closest('[data-reset]')) {
    if (!done.size) return;
    if (!confirm(`Reset your ${CFG.short} progress? This clears ${done.size} completed project${done.size > 1 ? 's' : ''} and cannot be undone.`)) return;
    done.clear(); storeSet(DONE_KEY, []); strip.setDone(done); prog.set(0, PROJECTS.length); }
});
$('#flyout').addEventListener('change', (e) => {
  const c = e.target;
  if (c.dataset.part) { togglePart(c.dataset.part, c.checked); syncPartsFly(); }
  if (c.dataset.set === 'labels') { settings.labels = c.checked; stage.setTagsVisible(c.checked); storeSet(SET_KEY, settings); }
  if (c.dataset.set === 'sound') { setSound(c.checked); }
  if (c.dataset.set === 'dark') window.CircuitDeck?.setTheme(c.checked ? 'dark' : 'light');
});
// keeps an open Components flyout in step with the circuit: count + restore button
function syncPartsFly() {
  if (fly.kind !== 'parts') return;
  const s = $('#flyout header span'); if (s) s.textContent = `${project.parts.length - removed.size}/${project.parts.length} in use`;
  const btn = $('#flyout [data-restore]');
  if (removed.size && !btn) $('#flyout .cd-parts + .cd-note')?.insertAdjacentHTML('afterend', '<button class="cd-btn" data-restore>Put everything back</button>');
  else if (!removed.size && btn) btn.remove();
  $('#flyout').querySelectorAll('[data-part]').forEach((x) => { x.checked = !removed.has(x.dataset.part); });
}
function togglePart(id, on) {
  if (on) removed.delete(id); else removed.add(id);
  rebuild();
}
function rebuild() {
  const was = !!run;
  stop(false);
  const cam = stage.getView();
  buildScene(project);
  stage.setView(cam);
  if (was) cc.print('Circuit changed — press Run again.', 'cd-dim');
}

// ------------------------------------------------------------------ routing
function go(id) { if (location.hash.slice(1) !== id) location.hash = id; else show(id); }
function show(id) {
  const p = byId[id] || PROJECTS[0];
  // an unknown hash falls back to the first project; say so in the URL too
  if (!byId[id] && location.hash.length > 1) history.replaceState(null, '', `${location.pathname}${location.search}#${p.id}`);
  if (p === project) return;
  stop(false);
  insp.hide();
  project = p;
  removed.clear();
  buildScene(p);
  renderPanel(p);
  cc.setCode(p.code, p.lang || 'py');
  cc.clear(); cc.closeConsole();
  info.show('overview');
  strip.setActive(p.id);
  // an open Components / Projects flyout follows the new project
  if (fly.kind === 'parts' || fly.kind === 'lessons') { const k = fly.kind; fly.close(); openFly(k, $(`[data-nav=${k}]`)); }
  document.title = `${p.title} · ${CFG.track} · CircuitDeck`;
}
addEventListener('hashchange', () => show(location.hash.slice(1)));
addEventListener('keydown', (e) => {
  if (e.target.closest('input, select, textarea, [contenteditable], .cd-chrome')) return;
  const i = PROJECTS.indexOf(project);
  if (e.key === '[' && i > 0) go(PROJECTS[i - 1].id);
  else if (e.key === ']' && i < PROJECTS.length - 1) go(PROJECTS[i + 1].id);
  else if (e.key === ' ' && !e.target.closest('button, a, [role=button], [role=tab], [role=switch]')) { e.preventDefault(); cc.running ? stop(true) : start(); }
});
addEventListener('cd-theme', () => drawPreview(0, !previewFn));

// ------------------------------------------------------------------ boot
strip.setDone(done);
prog.set(done.size, PROJECTS.length);
show(location.hash.slice(1));
requestAnimationFrame(() => requestAnimationFrame(() => {
  document.documentElement.classList.remove('is-loading');
  app.inert = false;
  $('#loader')?.classList.add('is-done');
  setTimeout(() => $('#loader')?.remove(), 700);
}));
// M8: what the AI tutor sees on this page
const strip_ = (h) => String(h || '').replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, ' ');
window.__cdAIContext = () => project && ({
  track: CFG.key, id: project.id, title: `${project.title} (${CFG.board})`,
  lesson: `${strip_(project.lede)}\n\nHow the code works:\n${project.steps.map((x, i) => `${i + 1}. ${strip_(x)}`).join('\n')}\n\nParts: ${project.parts.map((x) => x.label).join(', ') || 'the board only'}\nWiring: ${project.pinout.map(([a, b]) => `${a} → ${b}`).join('; ')}`,
  code: project.code, lang: { sh: 'bash', py: 'python', cpp: 'cpp' }[project.lang] || 'python',
});
// for the thumbnail script and tests
window.__track = CFG.key;
window.__pi5 = { stage, PROJECTS, show, start, stop: () => stop(true), get project() { return project; }, get insts() { return insts; }, get live() { return liveCam?.latest || null; }, CFG };
