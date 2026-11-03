// CircuitDeck · Canvas mode (M11). A free-form workbench: any number of boards (ESP32,
// ESP32-S3, Raspberry Pi 5), any part from the library, wires from any pin to any pin,
// and your own Arduino C++ / MicroPython / Python per board, run in the browser.
import * as THREE from 'three';
import { createFit, startClock, storeGet, storeSet, esc } from '../core/layout.js';
import { createStage } from '../core/stage.js';
import { PI } from '../core/pi5model.js';
import { sfx, isSoundOn, setSound } from '../core/sound.js';
import { buildPi5, buildEsp32, buildBreadboard } from '../core/boards.js';
import { makePart, PARTS, drawScreen } from '../core/parts.js';
import { ICONS, tabs, flyout, inspector, lessonStrip, progress } from '../core/ui.js';
import { pinsOf, boardPin, partPinDef, analyse } from '../sandbox/circuit.js';
import * as M from './model.js';
import { createEditor } from './editor.js';
import { generateFromWiring } from './gen.js';
import { compileCpp } from './cpp.js';
import { arduinoProgram } from './arduino.js';
import { pythonProgram } from './py.js';
import { Hardware, defaultInput } from './hw.js';
import { Machine } from './runtime.js';

const $ = (s, r = document) => r.querySelector(s);
const SET_KEY = 'circuitdeck:canvas:settings';
const BB = { x: 4.5, z: 0.6, w: 11, d: 6.6 };
const TABLE = new Set(['motor', 'battery', 'stepper', 'lamp', 'psu12', 'keypad', 'relay', 'drv8833', 'uln2003', 'cam3', 'aikit', 'epaper']);
const PALETTE = ['#f0a53a', '#3d6fc4', '#2fa36b', '#8f45b8', '#e05a8a', '#1aa3b8', '#c9842b', '#6b7cff'];
const RAIL_COLORS = { power5: '#d83a34', power3: '#f08a24', gnd: '#2f3547' };
const ROLE_DOT = { gnd: 0x2f3547, vcc: 0xd83a34, v5: 0xd83a34, v3: 0xf08a24 };
const BOARD_COLOR = { esp32: '#2f6fd0', esp32s3: '#1f8a8a', pi5: '#c51a4a' };
const LIMIT_X = 58;
const deg = THREE.MathUtils.degToRad;

// ------------------------------------------------------------------ state
const settings = { labels: true, ...storeGet(SET_KEY, {}) };
delete settings.sound;
let model = null;        // the canvas document (see model.js)
let issues = [];         // wiring checks, all boards
let insts = {};          // part id -> part instance
let boardObjs = {};      // board id -> built board
let dots = {};           // ref -> dot mesh
let owners = {};         // owner id (board or part) -> [dot meshes]
let pending = null;      // first pin of a wire being made
let sel = null;          // { kind: 'part'|'board', id }
let selBox = null;
let notice = '';
let shareUrl = '';
let cur = { board: null, file: null };
let hist = [], redoStack = [];
let clip = null;
let run = null;          // { hw, machines: [{ b, m }], raf, last }
let inputs = {};         // part id -> input state (kept across runs)
let lastErr = null;      // { kind, line, msg, file, board }
const partState = {};    // part id -> last state pushed while running (re-applied after a rebuild)
const screens = {};      // part id -> last screen data while running

// ------------------------------------------------------------------ layout
const app = $('#app');
startClock($('#clock-date'), $('#clock-time'));
let stage = null;
createFit(app, () => stage?.resize());
stage = createStage({ canvas: $('#board-canvas'), tagsEl: $('#tags'), leadersEl: $('#leaders'), tipEl: $('#tip'), viewbar: $('#viewbar'), rigEl: $('#rig') });
const TAB_LABELS = ['Canvas', 'Wiring', 'Checks', 'APIs'];
document.querySelectorAll('.info-card [role=tab]').forEach((b, i) => { b.textContent = TAB_LABELS[i]; });
const info = tabs($('.info-card'), renderTab);
const fly = flyout($('#flyout'), $('.sidebar'));
const insp = inspector($('#inspector'));
const prog = progress($('.status'), 'Canvas');
const strip = lessonStrip($('.lessons'), { items: M.STARTERS.map((t) => ({ id: t.id, title: t.title, thumb: `/canvas/thumbs/${t.id}.png` })), onPick: (id) => loadStarter(id) });
const panel = $('#cd-panel');
const hint = document.createElement('div');
hint.className = 'sb-hint';
hint.setAttribute('role', 'status');
$('#stage').append(hint);
const fileIn = Object.assign(document.createElement('input'), { type: 'file', accept: '.json,application/json', hidden: true });
document.body.append(fileIn);
const codeCard = $('.code-card');
const runBtn = $('.btn-run', codeCard);
const ed = createEditor(codeCard, {
  onInput: (v) => { const f = curFile(); if (!f) return; f.code = v.slice(0, M.LIMITS.chars); autosave(); },
  onTab: (name) => { cur.file = name; showFile(); },
  onAddFile: addFile, onRenameFile: renameFile, onDeleteFile: deleteFile,
  onBoard: (id) => { cur.board = id; cur.file = null; showFile(); },
  onLang: (l) => setLang(cur.board, l),
  onSerial: (t) => { if (!run) { ed.print('Run the program first — then what you type here goes to Serial / input().', 'cd-dim'); return; } const mm = run.machines.find((x) => x.b.id === cur.board) || run.machines[0]; mm?.m.serialIn(`${t}\n`); ed.print(`> ${t}`, 'cd-cmd'); },
});
ed.onJump = (e) => { if (e.board && e.board !== cur.board) cur.board = e.board; if (e.file) cur.file = e.file; showFile(); ed.jump(e.line); };
runBtn.addEventListener('click', () => (run ? stop(true) : start()));
$('.console-close', codeCard).addEventListener('click', () => (run ? stop(true) : ed.closeConsole()));
$('.btn-copy', codeCard).addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  try { await navigator.clipboard.writeText(ed.value); btn.classList.add('is-done'); setTimeout(() => btn.classList.remove('is-done'), 900); } catch { /* clipboard blocked */ }
});
$('.btn-expand', codeCard).addEventListener('click', (e) => { const on = !codeCard.classList.contains('is-expanded'); codeCard.classList.toggle('is-expanded', on); e.currentTarget.setAttribute('aria-expanded', String(on)); });
$('.cv-gen', codeCard).addEventListener('click', () => genCode());
$('.console-title', codeCard).textContent = 'Serial monitor';

// ------------------------------------------------------------------ helpers
const worldOf = (obj, v) => { obj.updateMatrixWorld(true); return obj.localToWorld(v.clone()); };
const isB = (ref) => ref.includes(':');
const splitB = (ref) => { const i = ref.indexOf(':'); return [ref.slice(0, i), ref.slice(i + 1)]; };
const splitP = (ref) => { const i = ref.indexOf('.'); return [ref.slice(0, i), ref.slice(i + 1)]; };
const boardById = (id) => model.boards.find((b) => b.id === id);
const partById = (id) => model.parts.find((p) => p.id === id);
const boardLabel = (b) => `${M.BOARD_TYPES[b.type].short}${model.boards.length > 1 ? ` (${b.id})` : ''}`;
function partName(p) {
  const base = (PARTS[p.type]?.name || p.type).replace(/ \(.*\)$/, '');
  return model.parts.filter((x) => x.type === p.type).length > 1 ? `${base} (${p.id})` : base;
}
function refLabel(ref) {
  if (isB(ref)) {
    const [bid, pin] = splitB(ref);
    const b = boardById(bid);
    if (!b) return ref;
    const p = boardPin(b.type, pin);
    return `${boardLabel(b)} ${p?.name || pin}${p?.phys ? ` (pin ${p.phys})` : ''}`;
  }
  const [id, pin] = splitP(ref);
  const p = partById(id);
  return p ? `${partName(p)} · ${partPinDef(p.type, pin)?.label || pin}` : ref;
}
const ownerOf = (ref) => (isB(ref) ? splitB(ref)[0] : splitP(ref)[0]);
function dotHex(ref) {
  if (isB(ref)) {
    const [bid, pin] = splitB(ref);
    const p = boardPin(boardById(bid)?.type, pin);
    if (!p) return 0xb8a35a;
    return p.kind === 'gnd' ? ROLE_DOT.gnd : p.kind === 'power' ? (p.volts > 4 ? ROLE_DOT.v5 : ROLE_DOT.v3) : p.kind === 'gpio' ? 0xd9b44a : 0x8a94a3;
  }
  const [id, pin] = splitP(ref);
  const d = partPinDef(partById(id)?.type, pin);
  return d?.role === 'gnd' ? ROLE_DOT.gnd : d?.role === 'vcc' ? ROLE_DOT.vcc : 0x3d8fe0;
}
function wireCss(a, b, i) {
  for (const r of [a, b]) {
    if (!isB(r)) continue;
    const [bid, pin] = splitB(r);
    const p = boardPin(boardById(bid)?.type, pin);
    if (p?.kind === 'gnd') return RAIL_COLORS.gnd;
    if (p?.kind === 'power') return p.volts > 4 ? RAIL_COLORS.power5 : RAIL_COLORS.power3;
  }
  for (const r of [a, b]) if (!isB(r)) { const [id, pin] = splitP(r); if (partPinDef(partById(id)?.type, pin)?.role === 'gnd') return RAIL_COLORS.gnd; }
  return PALETTE[i % PALETTE.length];
}
function nextId(type, taken = null) {
  const base = type.replace(/[^A-Za-z0-9]/g, '');
  const has = (id) => partById(id) || boardById(id) || taken?.has(id);
  for (let n = 1; ; n++) if (!has(`${base}${n}`)) return `${base}${n}`;
}
function nextBoardId() { for (let n = 1; ; n++) if (!boardById(`b${n}`) && !partById(`b${n}`)) return `b${n}`; }
const piOnly = (type) => PARTS[type]?.board === 'pi5';
const firstPi = () => model.boards.find((b) => b.type === 'pi5');
const curBoard = () => boardById(cur.board);
const curFile = () => { const fl = model.files[cur.board]; return fl?.find((f) => f.name === cur.file) || fl?.[0] || null; };
let saveT = 0;
function autosave() { clearTimeout(saveT); saveT = setTimeout(() => M.saveCurrent(model), 250); if (location.hash.length > 1) history.replaceState(null, '', location.pathname); shareUrl = ''; }

// ------------------------------------------------------------------ placement
const sizeCache = {};
function footprint(type, opts, rot = 0) {
  const k = `${type}:${rot}:${JSON.stringify(opts || {})}`;
  if (sizeCache[k]) return sizeCache[k];
  const inst = makePart(type, opts || {});
  inst.group.rotation.y = -deg(rot);
  const box = new THREE.Box3().setFromObject(inst.group);
  return (sizeCache[k] = { w: Math.max(0.6, box.max.x - box.min.x) + 0.35, d: Math.max(0.6, box.max.z - box.min.z) + 0.35 });
}
const onBreadboard = (x, z) => Math.abs(x - BB.x) < BB.w / 2 && Math.abs(z - BB.z) < BB.d / 2;
const COOLER = [-0.6, -0.15];
const mountedOn = (part) => (part.type === 'cooler' ? model.boards.find((b) => b.type === 'pi5' && Math.abs(part.x - (b.x + COOLER[0])) < 2.5 && Math.abs(part.z - (b.z + COOLER[1])) < 2.5) : null);
// A free spot for a new part: breadboard first (small parts), then the table on the right.
function place(part) {
  const pi = firstPi();
  if (pi && part.type === 'cam3') { part.x = +(pi.x + 0.5).toFixed(2); part.z = +(pi.z + 6.2).toFixed(2); return; }
  if (pi && part.type === 'aikit') { part.x = +(pi.x - 9.7).toFixed(2); part.z = +(pi.z + 0.6).toFixed(2); return; }
  if (pi && part.type === 'cooler') { part.x = +(pi.x + COOLER[0]).toFixed(2); part.z = +(pi.z + COOLER[1]).toFixed(2); return; }
  const f = footprint(part.type, part.opts, part.rot);
  const taken = model.parts.filter((p) => p !== part && p.x != null).map((p) => ({ ...footprint(p.type, p.opts, p.rot), x: p.x, z: p.z }));
  for (const b of model.boards) { const o = boardObjs[b.id]; if (o) { const box = new THREE.Box3().setFromObject(o.group); taken.push({ x: (box.min.x + box.max.x) / 2, z: (box.min.z + box.max.z) / 2, w: box.max.x - box.min.x + 0.4, d: box.max.z - box.min.z + 0.4 }); } }
  const free = (x, z) => taken.every((t) => Math.abs(t.x - x) * 2 >= t.w + f.w || Math.abs(t.z - z) * 2 >= t.d + f.d);
  const areas = TABLE.has(part.type) ? [] : [[BB.x - BB.w / 2 + f.w / 2 + 0.2, BB.x + BB.w / 2 - f.w / 2 - 0.2, BB.z - BB.d / 2 + f.d / 2 + 0.2, BB.z + BB.d / 2 - f.d / 2 - 0.2]];
  areas.push([10.8 + f.w / 2, 34, -4.8 + f.d / 2, 7.5 - f.d / 2], [10.8 + f.w / 2, 40, -16 + f.d / 2, 18 - f.d / 2]);
  for (const [x0, x1, z0, z1] of areas) {
    for (let x = x0; x <= x1; x += 0.5) for (let z = z0; z <= z1; z += 0.5) if (free(x, z)) { part.x = +x.toFixed(2); part.z = +z.toFixed(2); return; }
  }
  part.x = 40; part.z = 0;
}
// A free spot for a new board: left of the breadboard, then above / below.
function placeBoard(b) {
  const spots = [[-4.2, 0.6], [-6.5, 9], [-6.5, -9], [-18, 0.6], [-18, 9], [-18, -9], [-30, 0.6], [-30, 9]];
  for (const [x, z] of spots) if (model.boards.every((o) => o === b || Math.hypot(o.x - x, o.z - z) > 7.5)) { b.x = x; b.z = z; return; }
  b.x = -30; b.z = -9;
}

// ------------------------------------------------------------------ scene
let bbTop = 0;
function boardPoint(ref) {
  const [bid, pin] = splitB(ref);
  const b = boardById(bid), o = boardObjs[bid];
  const p = b && boardPin(b.type, pin);
  if (!p || !o) return null;
  const local = p.phys ? o.physPoint(p.phys) : o.pinPoint(pin);
  return local ? worldOf(o.group, local) : null;
}
function endPoint(ref) {
  if (isB(ref)) return boardPoint(ref);
  const [id, pin] = splitP(ref);
  const inst = insts[id];
  return inst?.pins[pin] ? worldOf(inst.group, inst.pins[pin]) : null;
}
const dotGeo = new THREE.SphereGeometry(1, 14, 10);
function addDot(ref, point, r) {
  const m = new THREE.Mesh(dotGeo, new THREE.MeshBasicMaterial({ color: dotHex(ref), transparent: true, opacity: 0.9, depthTest: false }));
  m.renderOrder = 5;
  m.scale.setScalar(r);
  m.position.copy(point).add(new THREE.Vector3(0, 0.06, 0));
  m.userData.pick = { pin: ref };
  m.userData.info = { title: refLabel(ref), hint: 'Click to start a wire' };
  m.userData.base = { color: dotHex(ref), r };
  stage.content.add(m);
  dots[ref] = m;
  (owners[ownerOf(ref)] ||= []).push(m);
}
function paintDots() {
  for (const [ref, m] of Object.entries(dots)) {
    const on = ref === pending;
    m.material.color.setHex(on ? 0x00b3ff : m.userData.base.color);
    m.scale.setScalar(m.userData.base.r * (on ? 1.8 : 1));
    m.userData.info.hint = pending ? (on ? 'Click again to cancel' : 'Click to finish the wire') : 'Click to start a wire';
  }
  hint.textContent = pending ? `Wiring from ${refLabel(pending)} — click any other pin (Esc cancels)` : '';
  hint.classList.toggle('is-on', !!pending);
}
function boardInfo(b) {
  const T = M.BOARD_TYPES[b.type];
  const desc = b.type === 'pi5' ? 'BCM2712, 4 × Cortex-A76. GPIO is 3.3 V logic. Programmed in Python (gpiozero or RPi.GPIO).'
    : b.type === 'esp32s3' ? 'Dual-core 240 MHz with Wi-Fi, BLE and AI vector instructions. 3.3 V logic. Arduino C++ or MicroPython.'
      : 'Dual-core 240 MHz with Wi-Fi and Bluetooth. 3.3 V logic; GPIO 34–39 are input-only. Arduino C++ or MicroPython.';
  return { title: `${T.name}${model.boards.length > 1 ? ` · ${b.id}` : ''}`, desc: `${desc} Drag to move it; click a pin to start a wire.`, rows: [['Id', b.id], ['Language', langLabel(b)], ['Files', (model.files[b.id] || []).map((f) => f.name).join(', ')]] };
}
const langLabel = (b) => (b.lang === 'cpp' ? 'Arduino C++' : b.type === 'pi5' ? 'Python 3' : 'MicroPython');
function buildBoard(b) {
  const o = b.type === 'pi5' ? buildPi5() : buildEsp32({ s3: b.type === 'esp32s3' });
  o.group.position.set(b.x, 0, b.z);
  o.group.rotation.y = -deg(b.rot || 0);
  o.group.traverse((x) => { if (x.userData.info && !x.userData.pick) x.userData.pick = { board: b.id }; });
  o.group.userData.pick = { board: b.id };
  o.group.userData.info = boardInfo(b);
  stage.content.add(o.group);
  boardObjs[b.id] = o;
  o.resetPins?.();
}
function buildScene() {
  stage.clearTicks();
  stage.clear();
  sfx.stopAll();
  insts = {}; boardObjs = {}; dots = {}; owners = {}; selBox = null;
  const bb = buildBreadboard(BB.w, BB.d);
  bb.group.position.set(BB.x, 0, BB.z);
  stage.content.add(bb.group);
  bbTop = bb.top;
  for (const b of model.boards) buildBoard(b);
  for (const part of model.parts) {
    if (part.x == null || part.z == null) place(part);
    const inst = makePart(part.type, part.opts || {});
    inst.group.position.set(part.x, mountedOn(part) ? PI.t + 0.02 : onBreadboard(part.x, part.z) ? bbTop : 0, part.z);
    inst.group.rotation.y = -deg(part.rot || 0);
    const def = PARTS[part.type];
    inst.group.userData.info = { title: partName(part), desc: def.desc, rows: [['Part', def.name], ['Id', part.id], ['Buy', def.buy]] };
    inst.group.userData.pick = { part: part.id };
    stage.content.add(inst.group);
    insts[part.id] = inst;
    if (inst.tick) stage.addTick((t, dt) => inst.tick(t, dt));
  }
  for (const b of model.boards) for (const p of pinsOf(b.type)) { const ref = `${b.id}:${p.id}`; const pt = boardPoint(ref); if (pt) addDot(ref, pt, p.phys ? 0.085 : 0.16); }
  for (const part of model.parts) for (const d of PARTS[part.type].pins) { const ref = `${part.id}.${d.n}`; const pt = endPoint(ref); if (pt) addDot(ref, pt, ['csi', 'pcie', 'fan'].includes(d.role) ? 0.16 : 0.1); }
  buildWires();
  buildTags();
  paintDots();
  paintSel();
  // a run that survived a move: put the parts back the way the program left them
  if (run) { for (const [id, st] of Object.entries(partState)) insts[id]?.set(st); for (const [id, s] of Object.entries(screens)) drawPart(id, s); }
  else applyInputVisuals();
}
function buildWires() {
  model.wires.forEach(({ a, b }, i) => {
    const pa = endPoint(a), pb = endPoint(b);
    if (!pa || !pb) return;
    const ribbon = [a, b].some((r) => isB(r) && /^(CAM0|CAM1|PCIE)$/.test(splitB(r)[1]));
    stage.addWire(pa, pb, ribbon ? 0xe8e0d0 : new THREE.Color(wireCss(a, b, i)).getHex(), {
      ribbon, width: 0.9, pick: { wire: i },
      info: { title: ribbon ? 'Ribbon cable' : 'Jumper wire', hint: 'Click to inspect or delete', desc: isB(a) && isB(b) && splitB(a)[0] !== splitB(b)[0] ? 'Joins two boards. Tie their grounds together too.' : 'Joins two points of the circuit.', rows: [['From', refLabel(a)], ['To', refLabel(b)]] },
    });
  });
}
function buildTags() {
  const tags = [];
  for (const b of model.boards) {
    const o = boardObjs[b.id];
    tags.push({ anchor: worldOf(o.group, new THREE.Vector3(0.8, 1.2, 0.4)), label: `${M.BOARD_TYPES[b.type].short}${model.boards.length > 1 ? ` · ${b.id}` : ''}`, color: BOARD_COLOR[b.type], onClick: (e) => { select('board', b.id); inspectBoard(b.id, e); } });
  }
  let k = 0;
  const many = model.parts.filter((x) => x.type === 'resistor').length > 2;
  for (const part of model.parts) {
    const inst = insts[part.id];
    if (part.type === 'resistor' && many) continue;
    tags.push({ anchor: worldOf(inst.group, inst.anchor || new THREE.Vector3(0, 1, 0)), label: partName(part), color: PALETTE[k++ % PALETTE.length], lift: 34 + (k % 2) * 16, onClick: (e) => { select('part', part.id); inspectPart(part.id, e); } });
  }
  stage.setTags(tags);
  stage.setTagsVisible(settings.labels);
}

// ------------------------------------------------------------------ selection
const selObj = () => (sel?.kind === 'part' ? insts[sel.id]?.group : sel?.kind === 'board' ? boardObjs[sel.id]?.group : null);
function paintSel() {
  if (selBox) { selBox.removeFromParent(); selBox.geometry.dispose(); selBox = null; }
  const obj = selObj();
  if (!obj) return;
  selBox = new THREE.BoxHelper(obj, 0x00a2ff);
  selBox.raycast = () => {};
  selBox.material.depthTest = false; selBox.material.transparent = true; selBox.material.opacity = 0.85;
  selBox.renderOrder = 4;
  stage.content.add(selBox);
}
function select(kind, id) {
  sel = kind && id ? { kind, id } : null;
  if (sel?.kind === 'board' && sel.id !== cur.board) { cur.board = sel.id; cur.file = null; showFile(); }
  paintSel();
}

// ------------------------------------------------------------------ drag to move
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const canvasEl = $('#board-canvas');
function setRay(e) {
  const r = canvasEl.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, stage.camera);
}
function pickAt(e) {
  setRay(e);
  const hits = ray.intersectObjects(stage.content.children, true);
  if (hits.some((h) => h.object.userData.pick?.pin)) return { pin: true };
  for (const h of hits) {
    for (let o = h.object; o; o = o.parent) {
      const p = o.userData?.pick;
      if (p?.part) return { kind: 'part', id: p.part };
      if (p?.board) return { kind: 'board', id: p.board };
    }
  }
  return null;
}
function ground(e, y) {
  setRay(e);
  return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -y), new THREE.Vector3());
}
let drag = null, wireRaf = 0;
$('#stage').addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || e.target !== canvasEl || !model) return;
  const h = pickAt(e);
  if (!h || h.pin) return;
  const obj = h.kind === 'part' ? insts[h.id]?.group : boardObjs[h.id]?.group;
  const doc = h.kind === 'part' ? partById(h.id) : boardById(h.id);
  if (!obj || !doc) return;
  if (h.kind === 'part' && mountedOn(doc)) return; // the cooler sits on the Pi; move the Pi instead
  const p0 = ground(e, obj.position.y);
  if (!p0) return;
  drag = { ...h, obj, doc, off: obj.position.clone().sub(p0), x0: e.clientX, y0: e.clientY, moved: false, start: obj.position.clone() };
  stage.controls.enabled = false;
}, true);
addEventListener('pointermove', (e) => {
  if (!drag) return;
  if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 5) return;
  drag.moved = true;
  const p = ground(e, drag.obj.position.y);
  if (!p) return;
  const x = Math.max(-LIMIT_X, Math.min(LIMIT_X, p.x + drag.off.x)), z = Math.max(-LIMIT_X, Math.min(LIMIT_X, p.z + drag.off.z));
  const before = drag.obj.position.clone();
  drag.obj.position.x = x; drag.obj.position.z = z;
  if (drag.kind === 'part') drag.obj.position.y = onBreadboard(x, z) ? bbTop : 0;
  const d = drag.obj.position.clone().sub(before);
  for (const m of owners[drag.id] || []) m.position.add(d);
  if (drag.kind === 'board') for (const p2 of model.parts) if (mountedOn(p2) && insts[p2.id]) { insts[p2.id].group.position.add(d); for (const m of owners[p2.id] || []) m.position.add(d); }
  selBox?.update();
  if (!wireRaf) wireRaf = requestAnimationFrame(() => { wireRaf = 0; stage.clearWires(); buildWires(); });
});
function endDrag() {
  if (!drag) return;
  stage.controls.enabled = true;
  const d = drag;
  drag = null;
  if (!d.moved) return;
  const nx = +d.obj.position.x.toFixed(2), nz = +d.obj.position.z.toFixed(2);
  const dx = nx - d.doc.x, dz = nz - d.doc.z;
  edit(() => {
    if (d.kind === 'board') for (const p of model.parts) if (mountedOn(p)) { p.x = +(p.x + dx).toFixed(2); p.z = +(p.z + dz).toFixed(2); }
    d.doc.x = nx; d.doc.z = nz;
  }, { keepRun: true });
  select(d.kind, d.id);
}
addEventListener('pointerup', endDrag);
addEventListener('pointercancel', endDrag);

// ------------------------------------------------------------------ checks (per board)
// Each board gets the sandbox's checks on the parts it can reach; wires between boards
// and loose parts are noted on their own.
function check() {
  const out = [];
  const adj = new Map();
  const link = (x, y) => { (adj.get(x) || adj.set(x, new Set()).get(x)).add(y); (adj.get(y) || adj.set(y, new Set()).get(y)).add(x); };
  for (const w of model.wires) link(ownerOf(w.a), ownerOf(w.b));
  const reached = new Set();
  for (const b of model.boards) {
    const seen = new Set([b.id]), q = [b.id];
    while (q.length) { const n = q.shift(); for (const m of adj.get(n) || []) if (!seen.has(m) && !boardById(m)) { seen.add(m); q.push(m); } }
    seen.forEach((x) => reached.add(x));
    const parts = model.parts.filter((p) => seen.has(p.id));
    const own = (r) => (isB(r) ? splitB(r)[0] === b.id : seen.has(splitP(r)[0]));
    const wires = model.wires.filter((w) => own(w.a) && own(w.b)).map((w) => [w.a, w.b].map((r) => (isB(r) ? splitB(r)[1] : r)));
    if (!parts.length) continue;
    let res;
    try { res = analyse({ v: 1, board: b.type, name: model.name, parts, wires }); } catch (err) { console.warn(err); continue; }
    const tag = model.boards.length > 1 ? `${boardLabel(b)}: ` : '';
    for (const i of res.issues) out.push({ ...i, msg: tag + i.msg, board: b.id, refs: i.refs?.map((r) => (r.includes('.') ? r : `${b.id}:${r}`)) });
  }
  for (const w of model.wires) {
    if (isB(w.a) && isB(w.b) && splitB(w.a)[0] !== splitB(w.b)[0]) out.push({ sev: 'info', msg: `${refLabel(w.a)} is wired straight to ${refLabel(w.b)}. Boards can signal each other this way — connect their GNDs too.`, refs: [w.a, w.b] });
  }
  const loose = model.parts.filter((p) => !reached.has(p.id));
  if (loose.length && model.boards.length) out.push({ sev: 'info', msg: `Not connected to any board yet: ${loose.slice(0, 6).map(partName).join(', ')}${loose.length > 6 ? ` and ${loose.length - 6} more` : ''}.` });
  return out;
}

// ------------------------------------------------------------------ changes + history
// Every structural edit goes through edit(): snapshot for undo, then changed().
function edit(fn, opts = {}) {
  const before = M.serialize(model);
  fn();
  if (M.serialize(model) === before) return false;
  hist.push({ m: before, files: !!opts.files, keepRun: !!opts.keepRun });
  if (hist.length > 120) hist.shift();
  redoStack.length = 0;
  changed(opts);
  return true;
}
function changed({ rebuild = true, keepRun = false } = {}) {
  const was = !!run;
  if (!keepRun) stop(false);
  else run?.hw.setModel(model);
  issues = check();
  if (rebuild === 'wires') { stage.clearWires(); buildWires(); paintDots(); }
  else if (rebuild) { const cam = stage.getView(); buildScene(); stage.setView(cam); }
  if (!boardById(cur.board)) { cur.board = model.boards[0]?.id || null; cur.file = null; }
  if (sel && !(sel.kind === 'part' ? partById(sel.id) : boardById(sel.id))) { sel = null; paintSel(); }
  showFile({ keepScroll: true });
  renderPanel();
  info.show(info.current);
  status();
  M.saveCurrent(model);
  if (location.hash.length > 1) history.replaceState(null, '', location.pathname);
  shareUrl = '';
  document.title = `${model.name} · Canvas · CircuitDeck`;
  if (was && !run) ed.print('Canvas changed — press Run again.', 'cd-dim');
}
function status() {
  const errs = issues.filter((i) => i.sev === 'error').length;
  prog.set(errs ? 0 : 1, 1);
  $('.status .progress-label').textContent = run ? 'Running' : errs ? `${errs} problem${errs > 1 ? 's' : ''}` : model.boards.length ? 'Ready to run' : 'Add a board';
  $('#progress-count').textContent = `${model.boards.length} board${model.boards.length === 1 ? '' : 's'} · ${model.parts.length} parts · ${model.wires.length} wires`;
}
function restore(entry, into) {
  const now = M.serialize(model);
  let next;
  try { next = M.validate(JSON.parse(entry.m)); } catch { return; }
  // undoing a move or a wire keeps the code you've typed since
  if (!entry.files) for (const b of next.boards) if (model.files[b.id] && model.boards.some((x) => x.id === b.id && x.lang === b.lang)) next.files[b.id] = model.files[b.id];
  into.push({ m: now, files: entry.files, keepRun: entry.keepRun });
  model = next;
  pending = null;
  insp.hide();
  changed({ keepRun: entry.keepRun });
}
function undo() { if (!hist.length) { flash('Nothing to undo.'); return; } restore(hist.pop(), redoStack); flash('Undone.'); }
function redo() { if (!redoStack.length) { flash('Nothing to redo.'); return; } restore(redoStack.pop(), hist); flash('Redone.'); }

// ------------------------------------------------------------------ loading
function load(raw, { frame = true, fresh = true } = {}) {
  const next = M.validate(raw);
  stop(false);
  model = next;
  pending = null; sel = null; notice = '';
  if (fresh) { hist = []; redoStack = []; }
  insp.hide();
  cur = { board: model.boards[0]?.id || null, file: null };
  lastErr = null; ed.setError(null);
  for (const k of Object.keys(inputs)) delete inputs[k];
  changed();
  if (frame) frameAll();
  ed.clear(); ed.closeConsole();
}
const frameAll = () => stage.frame([stage.content, stage.wires], { fill: model.boards.length + model.parts.length ? 0.72 : 0.5 });
function loadStarter(id) {
  if (!M.STARTERS.some((s) => s.id === id)) return;
  load(M.starter(id));
  const s = M.STARTERS.find((x) => x.id === id);
  notice = `Started “${s.title}”. Add or remove anything — it autosaves in this browser. Undo with Ctrl+Z.`;
  strip.setActive(id);
  info.show('overview');
}

// ------------------------------------------------------------------ boards, parts, wires
function addBoard(type, lang) {
  const T = M.BOARD_TYPES[type];
  if (!T) return null;
  if (model.boards.length >= M.LIMITS.boards) { flash(`That is the ${M.LIMITS.boards}-board limit.`, 'warn'); return null; }
  lang = T.langs.includes(lang) ? lang : T.langs[0];
  const b = { id: nextBoardId(), type, lang, x: 0, z: 0, rot: 0 };
  edit(() => {
    placeBoard(b);
    model.boards.push(b);
    model.files[b.id] = M.defaultFiles(type, lang, false);
  }, { files: true });
  cur = { board: b.id, file: null };
  select('board', b.id);
  showFile();
  flash(`Added ${T.name} (${b.id}) — its code is in the editor.`);
  return b.id;
}
function removeBoard(id) {
  const b = boardById(id);
  if (!b) return;
  edit(() => {
    model.boards = model.boards.filter((x) => x.id !== id);
    model.wires = model.wires.filter((w) => !(isB(w.a) && splitB(w.a)[0] === id) && !(isB(w.b) && splitB(w.b)[0] === id));
    delete model.files[id];
    if (!firstPi()) { const gone = new Set(model.parts.filter((p) => piOnly(p.type)).map((p) => p.id)); model.parts = model.parts.filter((p) => !gone.has(p.id)); model.wires = model.wires.filter((w) => ![w.a, w.b].some((r) => !isB(r) && gone.has(splitP(r)[0]))); }
  }, { files: true });
  insp.hide();
  flash(`Removed ${M.BOARD_TYPES[b.type].name} (${id}). Ctrl+Z brings it back.`);
}
function addPart(type, opts = {}, at = null) {
  if (!PARTS[type]) return null;
  if (piOnly(type) && !firstPi()) { flash(`${PARTS[type].name} needs a Raspberry Pi 5 on the canvas.`, 'warn'); return null; }
  if (model.parts.length >= M.LIMITS.parts) { flash(`That is the ${M.LIMITS.parts}-part limit.`, 'warn'); return null; }
  const part = { id: nextId(type), type, opts: { ...opts }, rot: at?.rot || 0 };
  for (const [k, ch] of Object.entries(PARTS[type].props || {})) if (!part.opts[k]) part.opts[k] = k === 'ohms' ? '330' : ch[0];
  edit(() => {
    if (at) { part.x = Math.max(-LIMIT_X, Math.min(LIMIT_X, at.x)); part.z = Math.max(-LIMIT_X, Math.min(LIMIT_X, at.z)); } else place(part);
    model.parts.push(part);
  });
  return part.id;
}
function removePart(id) {
  edit(() => {
    model.parts = model.parts.filter((p) => p.id !== id);
    model.wires = model.wires.filter((w) => [w.a, w.b].every((r) => isB(r) || splitP(r)[0] !== id));
  });
  insp.hide();
}
function addWire(a, b) {
  if (a === b) return false;
  if (model.wires.some((w) => (w.a === a && w.b === b) || (w.a === b && w.b === a))) { flash('Those two pins are already wired.'); return false; }
  if (model.wires.length >= M.LIMITS.wires) { flash(`That is the ${M.LIMITS.wires}-wire limit.`, 'warn'); return false; }
  edit(() => { model.wires.push({ a, b }); }, { rebuild: 'wires' });
  const mine = issues.filter((i) => i.sev !== 'info' && i.refs?.some((r) => r === a || r === b));
  flash(mine.length ? `${mine[0].sev === 'error' ? '⚠ ' : ''}${mine[0].msg}` : `Wired ${refLabel(a)} → ${refLabel(b)}`, mine[0]?.sev);
  return true;
}
function removeWire(i) { if (!model.wires[i]) return; edit(() => { model.wires.splice(i, 1); }, { rebuild: 'wires' }); insp.hide(); }
function rotateSel(dir = 1) {
  if (!sel) { flash('Select a part or board first (click it).'); return; }
  const doc = sel.kind === 'part' ? partById(sel.id) : boardById(sel.id);
  if (!doc || (sel.kind === 'part' && mountedOn(doc))) return;
  edit(() => { doc.rot = (((doc.rot || 0) + 90 * dir) % 360 + 360) % 360; }, { keepRun: true });
}
function removeSel() {
  if (!sel) return;
  if (sel.kind === 'part') removePart(sel.id); else removeBoard(sel.id);
  sel = null; paintSel();
}
function copySel() {
  if (!sel) { flash('Select a part or board to copy.'); return false; }
  const doc = sel.kind === 'part' ? partById(sel.id) : boardById(sel.id);
  if (!doc) return false;
  clip = sel.kind === 'part' ? { kind: 'part', type: doc.type, opts: { ...doc.opts }, rot: doc.rot, x: doc.x, z: doc.z }
    : { kind: 'board', type: doc.type, lang: doc.lang, rot: doc.rot, files: JSON.parse(JSON.stringify(model.files[doc.id] || [])) };
  flash(`Copied ${sel.kind === 'part' ? partName(doc) : boardLabel(doc)}.`);
  return true;
}
function paste() {
  if (!clip) { flash('Nothing copied yet — select something and press Ctrl+C.'); return; }
  if (clip.kind === 'part') {
    const id = addPart(clip.type, clip.opts, { x: clip.x + 1, z: clip.z + 1, rot: clip.rot });
    if (id) { clip.x += 1; clip.z += 1; select('part', id); flash(`Pasted ${partName(partById(id))}.`); }
    return;
  }
  const id = addBoard(clip.type, clip.lang);
  if (id) edit(() => { model.files[id] = JSON.parse(JSON.stringify(clip.files)); boardById(id).rot = clip.rot || 0; }, { files: true, keepRun: true });
  showFile();
}
function duplicateSel() { const keep = clip; if (copySel()) paste(); clip = keep; }

// ------------------------------------------------------------------ files + code
function showFile({ keepScroll = false } = {}) {
  const b = curBoard();
  const files = b ? model.files[b.id] || [] : [];
  if (!files.some((f) => f.name === cur.file)) cur.file = files[0]?.name || null;
  ed.setTabs({ boards: model.boards.map((x) => ({ id: x.id, label: `${M.BOARD_TYPES[x.type].short} · ${x.id}`, lang: x.lang })), board: b?.id, files, file: cur.file, langs: b ? M.BOARD_TYPES[b.type].langs.map((l) => [l, l === 'cpp' ? 'Arduino C++' : b.type === 'pi5' ? 'Python' : 'MicroPython']) : [] });
  const f = curFile();
  const lang = b?.lang === 'cpp' ? 'cpp' : 'py';
  ed.set(f ? f.code : '// Add a board (sidebar → Boards) to write code for it.', lang, { keepScroll });
  ed.setReadOnly(!f);
  const errHere = lastErr && lastErr.board === b?.id && lastErr.file === f?.name;
  if (errHere) { if (ed.error !== lastErr) ed.setError(lastErr); } else if (ed.error) ed.setError(lastErr && lastErr.board === b?.id ? { ...lastErr, line: null, msg: `${lastErr.msg} (in ${lastErr.file})` } : null);
  $('.code-card header h2').textContent = b ? `Code · ${boardLabel(b)}` : 'Code';
}
const FILE_OK = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,39}$/;
function addFile() {
  const b = curBoard();
  if (!b) return;
  const fl = model.files[b.id];
  if (fl.length >= M.LIMITS.files) { flash(`That is the ${M.LIMITS.files}-file limit per board.`, 'warn'); return; }
  const ext = b.lang === 'cpp' ? '.h' : '.py';
  let n = 1; while (fl.some((f) => f.name === `helpers${n > 1 ? n : ''}${ext}`)) n++;
  const def = `helpers${n > 1 ? n : ''}${ext}`;
  const name = (prompt(`New file name (${b.lang === 'cpp' ? '.h / .cpp' : '.py'}):`, def) || '').trim();
  if (!name) return;
  if (!FILE_OK.test(name) || fl.some((f) => f.name === name)) { flash('Use a new name with letters, digits, _ . or - only.', 'warn'); return; }
  const code = b.lang === 'cpp' ? `// ${name}: add #include "${name}" in ${M.mainFile(b)} to use it\n\n` : `# ${name}: use it from main.py with  from ${name.replace(/\.py$/, '')} import *\n\n`;
  edit(() => { fl.push({ name, code }); }, { files: true, rebuild: false });
  cur.file = name; showFile();
}
function renameFile(name) {
  const fl = model.files[cur.board];
  const f = fl?.find((x) => x.name === name);
  if (!f || f === fl[0]) return;
  const to = (prompt('Rename file:', name) || '').trim();
  if (!to || to === name) return;
  if (!FILE_OK.test(to) || fl.some((x) => x.name === to)) { flash('That name is taken or has odd characters.', 'warn'); return; }
  edit(() => { f.name = to; }, { files: true, rebuild: false });
  cur.file = to; showFile();
}
function deleteFile(name) {
  const fl = model.files[cur.board];
  const i = fl?.findIndex((x) => x.name === name);
  if (!(i > 0)) return;
  if (fl[i].code.trim().split('\n').length > 3 && !confirm(`Delete ${name}? (Ctrl+Z brings it back)`)) return;
  edit(() => { fl.splice(i, 1); }, { files: true, rebuild: false });
  if (cur.file === name) cur.file = null;
  showFile();
}
function setLang(bid, lang) {
  const b = boardById(bid);
  if (!b || b.lang === lang || !M.BOARD_TYPES[b.type].langs.includes(lang)) { showFile(); return; }
  const fresh = M.defaultFiles(b.type, lang, false);
  edit(() => { b.lang = lang; model.files[b.id] = fresh; }, { files: true, rebuild: false });
  cur.file = null; showFile();
  flash(`${boardLabel(b)} now runs ${langLabel(b)}. Ctrl+Z restores your previous code.`);
}
function genCode() {
  const b = curBoard();
  if (!b) { flash('Add a board first.'); return; }
  let g;
  try { g = generateFromWiring(model, b.id); } catch (err) { flash(`Could not generate code: ${err.message}`, 'warn'); return; }
  const fl = model.files[b.id];
  const main = fl.find((f) => f.name === g.file) || fl[0];
  const blank = M.defaultFiles(b.type, b.lang, false)[0].code.trim();
  if (main.code.trim() && main.code.trim() !== blank && !confirm(`Replace ${main.name} with starter code generated from your wiring? (Ctrl+Z undoes it)`)) return;
  edit(() => { main.code = g.code; }, { files: true, rebuild: false });
  cur.file = main.name; showFile();
  flash(`Generated ${main.name} from the wiring of ${boardLabel(b)}.`);
}

// ------------------------------------------------------------------ build + run
// Files are joined into one source: helper files first, then the main file. A user
// #include "x.h" / from x import … line becomes blank (the code is already there), and
// line numbers are mapped back to the file they came from.
function buildSource(b) {
  const fl = model.files[b.id] || [];
  const main = fl[0];
  const names = new Set(fl.map((f) => f.name));
  const strip = (code) => (b.lang === 'cpp'
    ? code.replace(/^[ \t]*#include\s*"([^"]+)"[^\n]*$/gm, (m, n) => (names.has(n) ? '' : m))
    : code.replace(/^[ \t]*(?:from\s+([A-Za-z_]\w*)\s+import\s+[^\n]*|import\s+([A-Za-z_]\w*)[ \t]*)$/gm, (m, a, c) => (names.has(`${a || c}.py`) ? '' : m)));
  const extra = fl.slice(1).filter((f) => (b.lang === 'cpp' ? /\.(h|hpp|c|cpp|ino)$/i.test(f.name) : /\.py$/i.test(f.name)));
  const segs = [];
  let src = '', line = 1;
  for (const f of [...extra, main]) {
    const code = strip(f.code);
    const n = code.split('\n').length;
    segs.push({ file: f.name, start: line, n });
    src += `${code}\n`;
    line += n;
  }
  const map = (l) => { for (const s of segs) if (l >= s.start && l < s.start + s.n) return { file: s.file, line: l - s.start + 1 }; return { file: main.name, line: null }; };
  return { src, map };
}
function compile(b) {
  const { src, map } = buildSource(b);
  try {
    return { prog: b.lang === 'cpp' ? arduinoProgram(compileCpp(src)) : pythonProgram(src), map };
  } catch (e) {
    if (e?.kind !== 'compile' && e?.line == null) throw e;
    const at = e.line ? map(e.line) : { file: model.files[b.id][0].name, line: null };
    return { error: { kind: 'compile', msg: e.message, line: at.line, file: at.file, board: b.id } };
  }
}
function showError(e) {
  lastErr = e;
  if (!e) { ed.setError(null); return; }
  cur.board = e.board; cur.file = e.file;
  showFile();
  ed.setError(e);
  if (e.line) ed.jump(e.line);
  issues = issues.filter((i) => !i.code);
  info.show(info.current);
}
function start() {
  if (run) return;
  if (!model.boards.length) { flash('Add a board first (sidebar → Boards).', 'warn'); return; }
  const errs = issues.filter((i) => i.sev === 'error');
  if (errs.length) {
    ed.openConsole(); ed.clear();
    ed.print(`Fix ${errs.length > 1 ? 'these wiring problems' : 'this wiring problem'} first (Checks tab):`, 'cd-err');
    for (const i of errs) ed.print(`• ${i.msg}`, 'cd-err');
    info.show('checks');
    return;
  }
  const builds = [];
  for (const b of model.boards) {
    const c = compile(b);
    if (c.error) { ed.openConsole(); ed.clear(); ed.print(`${boardLabel(b)} · ${c.error.file}${c.error.line ? `:${c.error.line}` : ''} — ${c.error.msg}`, 'cd-err'); showError(c.error); return; }
    builds.push({ b, ...c });
  }
  showError(null);
  ed.clear(); ed.openConsole();
  for (const k of Object.keys(partState)) delete partState[k];
  for (const k of Object.keys(screens)) delete screens[k];
  const hw = new Hardware(model, { setPart: (id, s) => { partState[id] = { ...(partState[id] || {}), ...s }; insts[id]?.set(s); } });
  for (const [id, v] of Object.entries(inputs)) if (hw.inputs[id]) hw.setInput(id, v);
  const multi = model.boards.length > 1;
  const r = { hw, machines: [], raf: 0, last: performance.now() };
  run = r;
  for (const { b, prog, map } of builds) {
    const tag = multi ? `[${b.id}] ` : '';
    const cls = `cv-b${model.boards.indexOf(b) + 1}`;
    let buf = '';
    const print = multi ? (t) => { buf += t; const i = buf.lastIndexOf('\n'); if (i < 0) { if (buf.length > 400) { ed.print(tag + buf, cls); buf = ''; } return; } buf.slice(0, i).replace(/\r/g, '').split('\n').forEach((l) => ed.print(tag + l, cls)); buf = buf.slice(i + 1); } : (t) => ed.print(t);
    const m = new Machine({
      hw, board: b.id, kind: b.type, print,
      note: (n) => ed.print(`${tag}ⓘ ${n}`, 'cd-dim'),
      draw: (id, data) => { screens[id] = data; drawPart(id, data); },
      onHalt: (err) => {
        if (run !== r) return;
        if (multi && buf) { ed.print(tag + buf, cls); buf = ''; }
        if (err) {
          const at = err.line ? map(err.line) : { file: model.files[b.id][0].name, line: null };
          const e = { kind: 'runtime', msg: err.msg, line: at.line, file: at.file, board: b.id };
          ed.print(`${tag}${err.py ? 'Traceback: ' : 'Error: '}${at.file}${at.line ? ` line ${at.line}` : ''} — ${err.msg}`, 'cd-err');
          showError(e);
        } else ed.print(`${tag}(program finished)`, 'cd-dim');
        if (r.machines.every((x) => !x.m.running)) { stop(false, true); }
      },
    });
    r.machines.push({ b, m, map });
    m.load(prog);
  }
  for (const x of r.machines) x.m.start();
  for (const [id, v] of Object.entries(inputs)) if (hw.inputs[id]) hw.setInput(id, v);
  if (multi) ed.print(`Running ${r.machines.length} boards: ${r.machines.map((x) => `${x.b.id} = ${M.BOARD_TYPES[x.b.type].short} (${langLabel(x.b)})`).join(', ')}`, 'cd-dim');
  runBtn.classList.add('is-running');
  runBtn.setAttribute('aria-label', 'Stop'); runBtn.title = 'Stop (Ctrl+Enter)';
  ed.status('running');
  status(); renderPanel();
  const loop = (t) => {
    if (run !== r) return;
    const dt = Math.min(100, t - r.last);
    r.last = t;
    try {
      for (const x of r.machines) if (x.m.running) x.m.step(dt);
      r.hw.refresh();
    } catch (err) {
      console.warn(err);
      ed.print(`Simulator problem: ${err.message}`, 'cd-err');
      stop(false); return;
    }
    r.raf = requestAnimationFrame(loop);
  };
  r.raf = requestAnimationFrame(loop);
}
// stop(user): Stop pressed. keepOut: the program ended on its own — leave the console as is.
function stop(user = false, ended = false) {
  if (!run) return;
  const r = run;
  run = null;
  cancelAnimationFrame(r.raf);
  if (!ended) for (const x of r.machines) try { x.m.stop(); } catch { /* already halted */ }
  if (user) ed.print(model.boards.some((b) => b.type === 'pi5') ? '^C  KeyboardInterrupt — stopped' : '(stopped)', 'cd-dim');
  runBtn.classList.remove('is-running');
  runBtn.setAttribute('aria-label', 'Run'); runBtn.title = 'Run (Ctrl+Enter)';
  ed.status(ended ? 'ended' : 'stopped');
  if (ended && !model.boards.some((b) => b.type === 'pi5')) sfx.stopAll(); else resetStates();
  status(); renderPanel();
}
function resetStates() {
  sfx.stopAll();
  for (const k of Object.keys(partState)) delete partState[k];
  for (const k of Object.keys(screens)) delete screens[k];
  for (const [id, inst] of Object.entries(insts)) {
    if (inst.screen) blankScreen(id);
    if (!inst.state) continue;
    const s = {};
    for (const k of Object.keys(inst.state)) s[k] = typeof inst.state[k] === 'boolean' ? false : typeof inst.state[k] === 'number' ? 0 : Array.isArray(inst.state[k]) ? inst.state[k].map((v) => (Array.isArray(v) ? v.map(() => 0) : v === null ? null : 0)) : inst.state[k];
    inst.set(s);
  }
  applyInputVisuals();
}
function applyInputVisuals() {
  for (const p of model.parts) {
    const inst = insts[p.id];
    if (!inst) continue;
    const v = inputs[p.id];
    if (inst.pressable || p.type === 'button') inst.set?.({ pressed: !!v?.pressed });
  }
}

// ------------------------------------------------------------------ screens
function blankScreen(id) {
  const inst = insts[id];
  if (!inst?.screen) return;
  const lcd = !!inst.lcd;
  drawScreen(inst, (ctx, w, h) => { ctx.fillStyle = lcd ? '#3d6b1e' : '#05070a'; ctx.fillRect(0, 0, w, h); });
}
function drawPart(id, s) {
  const inst = insts[id];
  if (!inst?.screen || !s) return;
  if (s.kind === 'lcd') {
    drawScreen(inst, (ctx, w, h) => {
      ctx.fillStyle = s.light === false ? '#2b4a15' : '#5f9e2a';
      ctx.fillRect(0, 0, w, h);
      const cw = w / 16.6, ch = h / 2.3;
      ctx.font = `bold ${Math.floor(ch * 0.78)}px ui-monospace, Menlo, Consolas, monospace`;
      ctx.textBaseline = 'middle';
      (s.lines || []).slice(0, 2).forEach((line, r) => {
        for (let c = 0; c < 16; c++) {
          const x = w * 0.02 + c * cw, y = h * 0.08 + r * ch;
          ctx.fillStyle = s.light === false ? 'rgba(0,0,0,.08)' : 'rgba(255,255,255,.07)';
          ctx.fillRect(x + 1, y + 2, cw - 2, ch - 4);
          const k = String(line || '')[c];
          if (k && k !== ' ') { ctx.fillStyle = s.light === false ? '#13240a' : '#e9ffe0'; ctx.fillText(k, x + cw * 0.12, y + ch / 2); }
        }
      });
    });
    return;
  }
  if (s.kind === 'oled') {
    drawScreen(inst, (ctx, w, h) => {
      const sx = w / (s.w || 128), sy = h / (s.h || 64);
      const on = s.inv ? '#05070a' : '#8fe3ff', off = s.inv ? '#8fe3ff' : '#05070a';
      ctx.fillStyle = off; ctx.fillRect(0, 0, w, h);
      const col = (c) => (c === 0 ? off : c === 2 ? '#3a8ab0' : on);
      ctx.lineWidth = Math.max(1, sx);
      for (const op of s.ops || []) {
        const [k] = op;
        if (k === 'px') { ctx.fillStyle = col(op[3]); ctx.fillRect(op[1] * sx, op[2] * sy, sx, sy); }
        else if (k === 'line') { ctx.strokeStyle = col(op[5]); ctx.beginPath(); ctx.moveTo((op[1] + 0.5) * sx, (op[2] + 0.5) * sy); ctx.lineTo((op[3] + 0.5) * sx, (op[4] + 0.5) * sy); ctx.stroke(); }
        else if (k === 'rect') { if (op[5]) { ctx.fillStyle = col(op[6]); ctx.fillRect(op[1] * sx, op[2] * sy, op[3] * sx, op[4] * sy); } else { ctx.strokeStyle = col(op[6]); ctx.strokeRect((op[1] + 0.5) * sx, (op[2] + 0.5) * sy, (op[3] - 1) * sx, (op[4] - 1) * sy); } }
        else if (k === 'circ') { ctx.beginPath(); ctx.arc((op[1] + 0.5) * sx, (op[2] + 0.5) * sy, op[3] * sx, 0, Math.PI * 2); if (op[4]) { ctx.fillStyle = col(op[5]); ctx.fill(); } else { ctx.strokeStyle = col(op[5]); ctx.stroke(); } }
        else if (k === 'tri') { ctx.beginPath(); ctx.moveTo(op[1] * sx, op[2] * sy); ctx.lineTo(op[3] * sx, op[4] * sy); ctx.lineTo(op[5] * sx, op[6] * sy); ctx.closePath(); if (op[7]) { ctx.fillStyle = col(op[8]); ctx.fill(); } else { ctx.strokeStyle = col(op[8]); ctx.stroke(); } }
        else if (k === 'text') {
          const size = op[3] || 1;
          ctx.fillStyle = col(op[4] ?? 1);
          ctx.font = `${Math.round(8 * size * sy)}px ui-monospace, Menlo, Consolas, monospace`;
          ctx.textBaseline = 'top';
          String(op[5]).split('').forEach((c, i) => ctx.fillText(c, (op[1] + i * 6 * size) * sx, op[2] * sy));
        }
      }
    });
  }
}

// ------------------------------------------------------------------ inputs panel
const RANGES = { value: [0, 1, 0.01, ''], light: [0, 1, 0.01, ''], moist: [0, 1, 0.01, ''], gas: [0, 1, 0.01, ''], level: [0, 1, 0.01, ''], cm: [2, 400, 1, ' cm'], t: [-10, 50, 0.5, ' °C'], h: [0, 100, 1, ' %'], p: [900, 1100, 1, ' hPa'], ax: [-2, 2, 0.05, ' g'], ay: [-2, 2, 0.05, ' g'], az: [-2, 2, 0.05, ' g'] };
const RNAME = { value: 'Knob', light: 'Light', moist: 'Moisture', gas: 'Gas', level: 'Sound level', cm: 'Distance', t: 'Temperature', h: 'Humidity', p: 'Pressure', ax: 'Tilt X', ay: 'Tilt Y', az: 'Tilt Z' };
const inputOf = (p) => ({ ...(defaultInput(p.type) || {}), ...(inputs[p.id] || {}) });
function setInput(id, patch) {
  inputs[id] = { ...inputOf(partById(id)), ...patch };
  run?.hw.setInput(id, patch);
  const inst = insts[id];
  if ('pressed' in patch && inst) inst.set?.({ pressed: !!patch.pressed });
}
function renderPanel() {
  const ins = model.parts.filter((p) => defaultInput(p.type));
  if (!ins.length) { panel.hidden = true; panel.innerHTML = ''; return; }
  panel.hidden = false;
  const rows = ins.map((p) => {
    const v = inputOf(p);
    const name = esc(partName(p));
    if (p.type === 'button') return `<button type="button" class="cd-btn cd-press${v.pressed ? ' is-on' : ''}" data-press="${esc(p.id)}" data-key="pressed" aria-pressed="${!!v.pressed}">${ICONS.hand}<span>Hold: ${name}</span></button>`;
    if (p.type === 'pir') return `<button type="button" class="cd-btn cd-press${v.motion ? ' is-on' : ''}" data-press="${esc(p.id)}" data-key="motion" aria-pressed="${!!v.motion}">${ICONS.hand}<span>${v.motion ? 'Motion on' : 'Motion off'}: ${name}</span></button>`;
    if (p.type === 'keypad') return `<div class="cv-in-name">${name}</div><div class="sb-keys" role="group" aria-label="Keypad">${['1', '2', '3', 'A', '4', '5', '6', 'B', '7', '8', '9', 'C', '*', '0', '#', 'D'].map((k) => `<button type="button" class="cd-btn" data-kp="${esc(p.id)}" data-k="${k}">${k}</button>`).join('')}</div>`;
    const ks = Object.keys(v).filter((k) => RANGES[k]);
    return `${ks.length > 1 || ins.length > 1 ? `<div class="cv-in-name">${name}</div>` : ''}${ks.map((k) => { const [lo, hi, st, u] = RANGES[k]; return `<label class="cd-in"><span>${RNAME[k]}</span><input type="range" min="${lo}" max="${hi}" step="${st}" value="${v[k]}" data-in="${esc(p.id)}" data-k="${k}" aria-label="${name} ${RNAME[k]}"><output>${fmt(v[k], k)}${u}</output></label>`; }).join('')}`;
  }).join('');
  panel.innerHTML = `<header><h3>Inputs</h3><small>${run ? 'Live' : 'Simulated'}</small></header>${rows}`;
}
const fmt = (x, k) => (RANGES[k][1] === 1 ? `${Math.round(x * 100)}%` : String(x));
panel.addEventListener('input', (e) => {
  const r = e.target.closest('[data-in]');
  if (!r) return;
  const k = r.dataset.k;
  setInput(r.dataset.in, { [k]: +r.value });
  r.nextElementSibling.textContent = fmt(+r.value, k) + RANGES[k][3];
});
panel.addEventListener('pointerdown', (e) => {
  const b = e.target.closest('[data-press]');
  if (!b || b.dataset.key !== 'pressed') return;
  e.preventDefault();
  setInput(b.dataset.press, { pressed: true }); b.classList.add('is-on'); b.setAttribute('aria-pressed', 'true');
  const up = () => { setInput(b.dataset.press, { pressed: false }); b.classList.remove('is-on'); b.setAttribute('aria-pressed', 'false'); removeEventListener('pointerup', up); removeEventListener('pointercancel', up); };
  addEventListener('pointerup', up); addEventListener('pointercancel', up);
});
panel.addEventListener('click', (e) => {
  const b = e.target.closest('[data-press]');
  if (b && b.dataset.key === 'motion') { const on = !inputOf(partById(b.dataset.press)).motion; setInput(b.dataset.press, { motion: on }); renderPanel(); return; }
  if (b && e.detail === 0) { setInput(b.dataset.press, { pressed: true }); setTimeout(() => setInput(b.dataset.press, { pressed: false }), 200); }
  const k = e.target.closest('[data-kp]');
  if (k) { setInput(k.dataset.kp, { key: k.dataset.k }); setTimeout(() => setInput(k.dataset.kp, { key: '' }), 150); }
});
