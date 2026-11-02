// CircuitDeck · Circuit sandbox. Build an ESP32 or Raspberry Pi 5 circuit in 3D,
// wire it pin to pin, check it, generate its code, simulate it, save and share it.
import * as THREE from 'three';
import { createFit, startClock, storeGet, storeSet, esc } from '../core/layout.js';
import { createStage } from '../core/stage.js';
import { PI } from '../core/pi5model.js';
import { sfx, isSoundOn, setSound } from '../core/sound.js';
import { buildPi5, buildEsp32, buildBreadboard } from '../core/boards.js';
import { makePart, PARTS } from '../core/parts.js';
import { ICONS, codeCard, tabs, flyout, inspector, lessonStrip, progress } from '../core/ui.js';
import { BOARDS, pinsOf, boardPin, isBoardRef, splitRef, partPinDef, refLabel, partName, analyse } from './circuit.js';
import { TEMPLATES, templateCircuit } from './templates.js';
import { generate } from './codegen.js';
import { inputSpec, defaultInputs, runSim } from './sim.js';
import * as store from './store.js';

const $ = (s, r = document) => r.querySelector(s);
const SET_KEY = 'circuitdeck:sandbox:settings';
const BB = { x: 4.5, z: 0.6, w: 11, d: 6.6 };
const BOARD_POS = { pi5: new THREE.Vector3(-6.5, 0, 0), esp32: new THREE.Vector3(-4.2, 0, 0.6) };
const BOARD_TOP = PI.t; // the Pi 5's PCB top (only the Pi takes board-mounted parts)
const FIXED = { cam3: [-6, 6.2], aikit: [-16.2, 0.6] }; // Pi-only parts that live off the breadboard
const TABLE = new Set(['motor', 'battery', 'stepper', 'lamp', 'psu12', 'keypad', 'relay', 'drv8833', 'uln2003', 'cam3', 'aikit', 'epaper']);
const PALETTE = ['#f0a53a', '#3d6fc4', '#2fa36b', '#8f45b8', '#e05a8a', '#1aa3b8', '#c9842b', '#6b7cff'];
const RAIL_COLORS = { power5: '#d83a34', power3: '#f08a24', gnd: '#2f3547' };
const ROLE_DOT = { gnd: 0x2f3547, vcc: 0xd83a34, v5: 0xd83a34, v3: 0xf08a24 };

// ------------------------------------------------------------------ state
const settings = { labels: true, ...storeGet(SET_KEY, {}) };
delete settings.sound;
let circ = null;        // the circuit (plain JSON, see circuit.js)
let result = { issues: [], conn: null };
let insts = {};         // part id -> part instance
let board = null;       // built board
let dots = {};          // endpoint ref -> dot mesh
let pending = null;     // first pin of a wire being made
let notice = '';        // one-off message shown on the Circuit tab
let shareUrl = '';
let spec = [];          // input panel spec
let inputs = {};
let run = null;
let genOut = { lang: 'py', file: 'main.py', code: '' };

// ------------------------------------------------------------------ layout
const app = $('#app');
startClock($('#clock-date'), $('#clock-time'));
let stage = null;
createFit(app, () => stage?.resize());
stage = createStage({ canvas: $('#board-canvas'), tagsEl: $('#tags'), leadersEl: $('#leaders'), tipEl: $('#tip'), viewbar: $('#viewbar'), rigEl: $('#rig') });
const cc = codeCard($('.code-card'), { onRun: start, onStop: () => stop(true), consoleTitle: 'Terminal' });
const TAB_LABELS = ['Circuit', 'Wiring', 'Checks', 'Parts list'];
document.querySelectorAll('.info-card [role=tab]').forEach((b, i) => { b.textContent = TAB_LABELS[i]; });
const info = tabs($('.info-card'), renderTab);
const fly = flyout($('#flyout'), $('.sidebar'));
const insp = inspector($('#inspector'));
const prog = progress($('.status'), 'Sandbox');
const strip = lessonStrip($('.lessons'), { items: TEMPLATES.map((t) => ({ id: t.id, title: t.title, thumb: `/sandbox/thumbs/${t.id}.png` })), onPick: (id) => loadTemplate(id) });
const panel = $('#cd-panel');
const hint = document.createElement('div');
hint.className = 'sb-hint';
hint.setAttribute('role', 'status');
$('#stage').append(hint);
const fileIn = Object.assign(document.createElement('input'), { type: 'file', accept: '.json,application/json', hidden: true });
document.body.append(fileIn);

// ------------------------------------------------------------------ helpers
const worldOf = (obj, v) => { obj.updateMatrixWorld(true); return obj.localToWorld(v.clone()); };
const partById = (id) => circ.parts.find((p) => p.id === id);
const dotHex = (ref) => {
  if (isBoardRef(ref)) {
    const p = boardPin(circ.board, ref);
    if (!p) return 0xb8a35a;
    return p.kind === 'gnd' ? ROLE_DOT.gnd : p.kind === 'power' ? (p.volts > 4 ? ROLE_DOT.v5 : ROLE_DOT.v3) : p.kind === 'gpio' ? 0xd9b44a : 0x8a94a3;
  }
  const [id, pin] = splitRef(ref);
  const d = partPinDef(partById(id)?.type, pin);
  return d?.role === 'gnd' ? ROLE_DOT.gnd : d?.role === 'vcc' ? ROLE_DOT.vcc : 0x3d8fe0;
};
function wireCss(a, b, i) {
  for (const r of [a, b]) {
    if (!isBoardRef(r)) continue;
    const p = boardPin(circ.board, r);
    if (p?.kind === 'gnd') return RAIL_COLORS.gnd;
    if (p?.kind === 'power') return p.volts > 4 ? RAIL_COLORS.power5 : RAIL_COLORS.power3;
  }
  for (const r of [a, b]) if (!isBoardRef(r)) { const [id, pin] = splitRef(r); if (partPinDef(partById(id)?.type, pin)?.role === 'gnd') return RAIL_COLORS.gnd; }
  return PALETTE[i % PALETTE.length];
}
function nextId(type) {
  const base = type.replace(/[^A-Za-z0-9]/g, '');
  for (let n = 1; ; n++) if (!partById(`${base}${n}`)) return `${base}${n}`;
}
const piOnly = (type) => PARTS[type]?.board === 'pi5';

// ------------------------------------------------------------------ placement
const sizeCache = {};
function footprint(type, opts, rot = 0) {
  const k = `${type}:${rot}:${JSON.stringify(opts || {})}`;
  if (sizeCache[k]) return sizeCache[k];
  const inst = makePart(type, opts || {});
  inst.group.rotation.y = -THREE.MathUtils.degToRad(rot);
  const box = new THREE.Box3().setFromObject(inst.group);
  return (sizeCache[k] = { w: Math.max(0.6, box.max.x - box.min.x) + 0.35, d: Math.max(0.6, box.max.z - box.min.z) + 0.35 });
}
const onBreadboard = (x, z) => Math.abs(x - BB.x) < BB.w / 2 && Math.abs(z - BB.z) < BB.d / 2;
// Finds a free spot for a new part: breadboard first (small parts), then the table on the right.
function place(part) {
  if (FIXED[part.type]) { [part.x, part.z] = FIXED[part.type]; return; }
  if (part.type === 'cooler') { part.x = BOARD_POS.pi5.x - 0.6; part.z = BOARD_POS.pi5.z - 0.15; return; }
  const f = footprint(part.type, part.opts, part.rot);
  const taken = circ.parts.filter((p) => p !== part && p.x != null).map((p) => ({ ...footprint(p.type, p.opts, p.rot), x: p.x, z: p.z }));
  const free = (x, z) => taken.every((t) => Math.abs(t.x - x) * 2 >= t.w + f.w || Math.abs(t.z - z) * 2 >= t.d + f.d);
  const areas = TABLE.has(part.type) ? [] : [[BB.x - BB.w / 2 + f.w / 2 + 0.2, BB.x + BB.w / 2 - f.w / 2 - 0.2, BB.z - BB.d / 2 + f.d / 2 + 0.2, BB.z + BB.d / 2 - f.d / 2 - 0.2]];
  areas.push([10.8 + f.w / 2, 30, -4.8 + f.d / 2, 7.5 - f.d / 2]);
  for (const [x0, x1, z0, z1] of areas) {
    for (let x = x0; x <= x1; x += 0.5) for (let z = z0; z <= z1; z += 0.5) if (free(x, z)) { part.x = +x.toFixed(2); part.z = +z.toFixed(2); return; }
  }
  part.x = 32; part.z = 0;
}

// ------------------------------------------------------------------ scene
function boardPoint(ref) {
  const p = boardPin(circ.board, ref);
  if (!p) return null;
  const local = p.phys ? board.physPoint(p.phys) : board.pinPoint(ref);
  return local ? worldOf(board.group, local) : null;
}
function endPoint(ref) {
  if (isBoardRef(ref)) return boardPoint(ref);
  const [id, pin] = splitRef(ref);
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
  m.userData.info = { title: refLabel(circ, ref), hint: pending ? (pending === ref ? 'Click again to cancel' : 'Click to finish the wire') : 'Click to start a wire' };
  m.userData.base = { color: dotHex(ref), r };
  stage.content.add(m);
  dots[ref] = m;
}
function paintDots() {
  for (const [ref, m] of Object.entries(dots)) {
    const sel = ref === pending;
    m.material.color.setHex(sel ? 0x00b3ff : m.userData.base.color);
    m.scale.setScalar(m.userData.base.r * (sel ? 1.8 : 1));
    m.userData.info.hint = pending ? (sel ? 'Click again to cancel' : 'Click to finish the wire') : 'Click to start a wire';
  }
  hint.textContent = pending ? `Wiring from ${refLabel(circ, pending)} — click another pin (Esc cancels)` : '';
  hint.classList.toggle('is-on', !!pending);
}

function buildScene() {
  stage.clearTicks();
  stage.clear();
  sfx.stopAll();
  insts = {}; dots = {};
  board = circ.board === 'pi5' ? buildPi5() : buildEsp32();
  board.group.position.copy(BOARD_POS[circ.board]);
  stage.content.add(board.group);
  const B = BOARDS[circ.board];
  board.group.traverse((o) => { if (o.userData.info && !o.userData.pick) o.userData.pick = { board: true }; });
  const bb = buildBreadboard(BB.w, BB.d);
  bb.group.position.set(BB.x, 0, BB.z);
  stage.content.add(bb.group);
  for (const part of circ.parts) {
    if (part.x == null) place(part);
    const inst = makePart(part.type, part.opts || {});
    const mount = part.type === 'cooler' && circ.board === 'pi5';
    inst.group.position.set(part.x, mount ? BOARD_TOP + 0.02 : onBreadboard(part.x, part.z) ? bb.top : 0, part.z);
    inst.group.rotation.y = -THREE.MathUtils.degToRad(part.rot || 0);
    const def = PARTS[part.type];
    inst.group.userData.info = { title: partName(circ, part), desc: def.desc, rows: [['Part', def.name], ['Id in code', part.id], ['Buy', def.buy]] };
    inst.group.userData.pick = { part: part.id };
    stage.content.add(inst.group);
    insts[part.id] = inst;
    if (inst.tick) stage.addTick((t, dt) => inst.tick(t, dt));
  }
  // dots on every board pin and part pin
  for (const p of pinsOf(circ.board)) { const pt = boardPoint(p.id); if (pt) addDot(p.id, pt, p.phys ? 0.085 : 0.16); }
  for (const part of circ.parts) for (const d of PARTS[part.type].pins) { const ref = `${part.id}.${d.n}`; const pt = endPoint(ref); if (pt) addDot(ref, pt, ['csi', 'pcie', 'fan'].includes(d.role) ? 0.16 : 0.1); }
  buildWires();
  board.resetPins?.();
  buildTags();
  paintDots();
}
// wires on their own, so adding or removing one doesn't rebuild every part (perf)
function buildWires() {
  circ.wires.forEach(([a, b], i) => {
    const pa = endPoint(a), pb = endPoint(b);
    if (!pa || !pb) return;
    const ribbon = [a, b].some((r) => ['CAM0', 'CAM1', 'PCIE'].includes(r));
    const css = wireCss(a, b, i);
    stage.addWire(pa, pb, ribbon ? 0xe8e0d0 : new THREE.Color(css).getHex(), {
      ribbon, width: 0.9, pick: { wire: i },
      info: { title: ribbon ? 'Ribbon cable' : 'Jumper wire', hint: 'Click to inspect or delete', desc: ribbon ? 'Pi 5 camera/PCIe ports use small FPC connectors and flat cables.' : 'Joins two points of the circuit.', rows: [['From', refLabel(circ, a)], ['To', refLabel(circ, b)]] },
    });
  });
}
function buildTags() {
  const B = BOARDS[circ.board];
  const tags = [{ anchor: worldOf(board.group, new THREE.Vector3(0.8, 1.2, 0.4)), label: B.name, color: circ.board === 'pi5' ? '#c51a4a' : '#2f6fd0', onClick: (e) => inspectAt(boardInfo(), e) }];
  let k = 0;
  for (const part of circ.parts) {
    const inst = insts[part.id];
    if (part.type === 'resistor' && circ.parts.filter((x) => x.type === 'resistor').length > 2) continue;
    tags.push({ anchor: worldOf(inst.group, inst.anchor || new THREE.Vector3(0, 1, 0)), label: partName(circ, part), color: PALETTE[k++ % PALETTE.length], lift: 34 + (k % 2) * 16, onClick: (e) => inspectPart(part.id, e) });
  }
  stage.setTags(tags);
  stage.setTagsVisible(settings.labels);
}
function boardInfo() {
  return circ.board === 'pi5'
    ? { title: 'Raspberry Pi 5', desc: 'BCM2712, 4 × Cortex-A76 @ 2.4 GHz. GPIO is 3.3 V logic — never feed it 5 V. Click any header pin to start a wire.', rows: [['Power in', '5 V / 5 A USB-C'], ['GPIO', '28 pins, 3.3 V'], ['Ports', '2 × CSI/DSI, PCIe ×1, fan']] }
    : { title: 'ESP32 DevKit (WROOM-32)', desc: 'Dual-core 240 MHz with Wi-Fi and Bluetooth. 3.3 V logic; GPIO 34–39 are input-only. Click any header pin to start a wire.', rows: [['Power in', '5 V USB / VIN'], ['GPIO', '3.3 V, ADC on many pins'], ['Flash', '4 MB']] };
}

// ------------------------------------------------------------------ changes
// Every edit goes through here: re-check, regenerate code, rebuild the scene, autosave.
function changed({ rebuild = true, keepCam = true, undo = null } = {}) {
  const was = !!run;
  undoBoard = undo;
  stop(false);
  result = analyse(circ);
  genOut = generate(circ, result.conn);
  cc.setCode(genOut.code, genOut.lang);
  $('.code-card header h2').textContent = `Generated code · ${genOut.file}`;
  if (rebuild === 'wires') { stage.clearWires(); buildWires(); board.resetPins?.(); paintDots(); }
  else if (rebuild) {
    const cam = keepCam ? stage.getView() : null;
    buildScene();
    if (cam) { stage.setView(cam); }
  }
  renderPanel();
  info.show(info.current);
  const errs = result.issues.filter((i) => i.sev === 'error').length;
  prog.set(errs ? 0 : 1, 1);
  $('.status .progress-label').textContent = errs ? `${errs} problem${errs > 1 ? 's' : ''}` : 'Ready to run';
  $('#progress-count').textContent = `${circ.parts.length} parts · ${circ.wires.length} wires`;
  store.saveCurrent(circ);
  if (location.hash.length > 1) history.replaceState(null, '', location.pathname);
  shareUrl = '';
  document.title = `${circ.name} · Sandbox · CircuitDeck`;
  if (was) cc.print('Circuit changed — press Run again.', 'cd-dim');
}
// M1: before a template, share link, import or save replaces the circuit, keep
// the current autosave in My saves unless it is already there or is an
// untouched template. Returns the name it was kept under, or ''.
const sameCircuit = (a, b) => { try { return store.serialize(store.validate(a)) === store.serialize(store.validate(b)); } catch { return false; } };
const PRISTINE_KEY = 'circuitdeck:sandbox:pristine';
function keepUnsaved() {
  const cur = store.loadCurrent();
  if (!cur || (!cur.parts.length && !cur.wires.length)) return '';
  if (store.listSaves().some((s) => sameCircuit(s.circuit, cur))) return '';
  if (TEMPLATES.some((t) => { try { return sameCircuit(templateCircuit(t), cur); } catch { return false; } })) return '';
  // untouched since it was loaded (templates get part positions laid out on load)
  try { if (localStorage.getItem(PRISTINE_KEY) === store.serialize(cur)) return ''; } catch { /* storage off */ }
  const d = new Date();
  const name = `${cur.name.slice(0, 40)} (autosave ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })})`;
  return store.saveNamed({ ...cur, name }) ? name : '';
}
let kept = '';
const keptNote = () => (kept ? ` Your previous circuit was kept in My saves as “${kept}”.` : '');
function load(c, { frame = true, keep = true } = {}) {
  const next = store.validate(c);
  kept = keep ? keepUnsaved() : '';
  circ = next;
  pending = null;
  notice = '';
  insp.hide();
  changed({ keepCam: false });
  if (keep) { try { localStorage.setItem(PRISTINE_KEY, store.serialize(circ)); } catch { /* storage off */ } }
  if (frame) stage.frame([stage.content, stage.wires], { fill: 0.7 });
  cc.clear(); cc.closeConsole();
}
function loadTemplate(id) {
  const t = TEMPLATES.find((x) => x.id === id);
  if (!t) return;
  load(templateCircuit(t));
  notice = `Loaded the “${t.title}” template. Change anything — it autosaves in this browser.${keptNote()}`;
  strip.setActive(id);
  info.show('overview');
}
function addPart(type, opts = {}) {
  if (!PARTS[type]) return null;
  if (piOnly(type) && circ.board !== 'pi5') { notice = `${PARTS[type].name} only works with the Raspberry Pi 5.`; info.show('overview'); return null; }
  if (circ.parts.length >= 60) { notice = 'That is the 60-part limit.'; info.show('overview'); return null; }
  const part = { id: nextId(type), type, opts: { ...opts } };
  for (const [k, ch] of Object.entries(PARTS[type].props || {})) if (!part.opts[k]) part.opts[k] = k === 'ohms' ? '330' : ch[0];
  circ.parts.push(part);
  place(part);
  changed();
  return part.id;
}
function removePart(id) {
  circ.parts = circ.parts.filter((p) => p.id !== id);
  circ.wires = circ.wires.filter((w) => w.every((r) => isBoardRef(r) || splitRef(r)[0] !== id));
  insp.hide();
  changed();
}
function addWire(a, b) {
  if (a === b) return false;
  if (circ.wires.some(([x, y]) => (x === a && y === b) || (x === b && y === a))) { flash('Those two pins are already wired.'); return false; }
  if (circ.wires.length >= 300) { flash('That is the 300-wire limit.'); return false; }
  circ.wires.push([a, b]);
  changed({ rebuild: 'wires' });
  const mine = result.issues.filter((i) => i.sev !== 'info' && i.refs?.some((r) => r === a || r === b));
  flash(mine.length ? `${mine[0].sev === 'error' ? '⚠ ' : ''}${mine[0].msg}` : `Wired ${refLabel(circ, a)} → ${refLabel(circ, b)}`, mine[0]?.sev);
  return true;
}
function removeWire(i) { circ.wires.splice(i, 1); insp.hide(); changed({ rebuild: 'wires' }); }
let flashT = 0;
function flash(msg, sev) {
  hint.textContent = msg;
  hint.className = `sb-hint is-on${sev ? ` is-${sev}` : ''}`;
  clearTimeout(flashT);
  flashT = setTimeout(() => { hint.className = 'sb-hint'; paintDots(); }, 3200);
}
// Switching boards keeps every part and wire that still makes sense.
function remapRef(ref, to) {
  if (!isBoardRef(ref)) return ref;
  const p = boardPin(circ.board, ref);
  if (!p) return null;
  const pins = pinsOf(to);
  if (p.kind === 'gpio') return pins.some((x) => x.id === p.name) ? p.name : null;
  if (p.kind === 'gnd') return pins.find((x) => x.kind === 'gnd').id;
  if (p.kind === 'power') return (p.volts > 4 ? pins.find((x) => x.kind === 'power' && x.volts > 4) : pins.find((x) => x.kind === 'power' && x.volts < 4))?.id || null;
  return pins.some((x) => x.id === ref) ? ref : null;
}
let undoBoard = null;
function setBoard(to) {
  if (to === circ.board || !BOARDS[to]) return;
  const before = JSON.parse(store.serialize(circ));
  const dropped = circ.parts.filter((p) => to !== 'pi5' && piOnly(p.type));
  const gone = new Set(dropped.map((p) => p.id));
  let lost = 0;
  const wires = [];
  for (const w of circ.wires) {
    const m = w.map((r) => (isBoardRef(r) ? remapRef(r, to) : gone.has(splitRef(r)[0]) ? null : r));
    if (m.some((r) => !r)) { lost++; continue; }
    if (m[0] !== m[1] && !wires.some(([x, y]) => (x === m[0] && y === m[1]) || (x === m[1] && y === m[0]))) wires.push(m);
  }
  circ = { ...circ, board: to, parts: circ.parts.filter((p) => !gone.has(p.id)), wires };
  if (to === 'pi5') for (const p of circ.parts) if (p.type === 'cooler') place(p);
  notice = `Switched to the ${BOARDS[to].name}.${dropped.length ? ` Removed ${dropped.map((p) => PARTS[p.type].name).join(', ')} (Pi 5 only).` : ''}${lost ? ` Dropped ${lost} wire${lost > 1 ? 's' : ''} that had no matching pin.` : ''} Power and ground wires moved to the nearest equivalent pins — run the checks again.`;
  pending = null;
  changed({ keepCam: false, undo: dropped.length || lost ? before : null });
  stage.frame([stage.content, stage.wires], { fill: 0.7 });
}
function undoBoardSwitch() {
  if (!undoBoard) return;
  const c = undoBoard;
  load(c, { keep: false });
  notice = `Board switch undone — back on the ${BOARDS[circ.board].name} with every part and wire.`;
  info.show('overview');
}

// ------------------------------------------------------------------ picking + inspector
function stagePoint(e) {
  const r = $('#stage').getBoundingClientRect();
  const sc = r.width / $('#stage').offsetWidth || 1;
  return { x: (e.clientX - r.left) / sc, y: (e.clientY - r.top) / sc };
}
function inspectAt(data, e, actions = '') { insp.show(data, { ...(e ? stagePoint(e) : { x: 60, y: 120 }), actions }); }
function inspectPart(id, e) {
  const part = partById(id);
  const inst = insts[id];
  if (!part || !inst) return;
  const props = Object.entries(PARTS[part.type].props || {}).map(([k, ch]) => `<label class="sb-prop"><span>${esc(k === 'ohms' ? 'Resistance' : k[0].toUpperCase() + k.slice(1))}</span><select data-prop="${esc(k)}" data-id="${esc(id)}">${ch.map((v) => `<option ${part.opts?.[k] === v ? 'selected' : ''} value="${esc(v)}">${esc(k === 'ohms' ? `${v} Ω` : v)}</option>`).join('')}</select></label>`).join('');
  const act = `<div class="cd-insp-act sb-act">${props}
    <div class="sb-nudge" aria-label="Move"><button type="button" class="cd-btn" data-nudge="-1,0" data-id="${esc(id)}" aria-label="Move left">←</button><button type="button" class="cd-btn" data-nudge="0,-1" data-id="${esc(id)}" aria-label="Move back">↑</button><button type="button" class="cd-btn" data-nudge="0,1" data-id="${esc(id)}" aria-label="Move forward">↓</button><button type="button" class="cd-btn" data-nudge="1,0" data-id="${esc(id)}" aria-label="Move right">→</button><button type="button" class="cd-btn" data-rot="${esc(id)}" aria-label="Rotate 90 degrees">⟳</button></div>
    <button type="button" class="cd-btn cd-danger" data-remove="${esc(id)}">Remove part</button></div>`;
  inspectAt(inst.group.userData.info, e, act);
}
$('#inspector').addEventListener('click', (e) => {
  const t = e.target.closest('button');
  if (!t) return;
  if (t.dataset.remove) removePart(t.dataset.remove);
  else if (t.dataset.wire != null) removeWire(+t.dataset.wire);
  else if (t.dataset.nudge) { const p = partById(t.dataset.id); const [dx, dz] = t.dataset.nudge.split(',').map(Number); if (p.type === 'cooler') return; const nx = +(p.x + dx * 0.5).toFixed(2), nz = +(p.z + dz * 0.5).toFixed(2); if (Math.abs(nx) > 58 || Math.abs(nz) > 58) { flash('That is the edge of the workbench.'); return; } p.x = nx; p.z = nz; changed(); }
  else if (t.dataset.rot) { const p = partById(t.dataset.rot); p.rot = ((p.rot || 0) + 90) % 360; changed(); }
});
$('#inspector').addEventListener('change', (e) => {
  const s = e.target.closest('[data-prop]');
  if (!s) return;
  const p = partById(s.dataset.id);
  p.opts = { ...p.opts, [s.dataset.prop]: s.value };
  changed();
  inspectPart(p.id);
});
stage.onPick((hit, e) => {
  if (hit?.pick?.pin) {
    insp.hide();
    const ref = hit.pick.pin;
    if (!pending) { pending = ref; paintDots(); return; }
    if (pending === ref) { pending = null; paintDots(); return; }
    const a = pending;
    pending = null;
    if (!addWire(a, ref)) paintDots();
    return;
  }
  if (pending) { pending = null; paintDots(); }
  if (!hit) { insp.hide(); return; }
  if (hit.pick?.wire != null) {
    const i = hit.pick.wire;
    inspectAt(hit.info, e, `<div class="cd-insp-act"><button type="button" class="cd-btn cd-danger" data-wire="${i}">Delete wire</button></div>`);
    return;
  }
  if (hit.pick?.part) {
    const inst = insts[hit.pick.part];
    if (inst?.pressable && run) { setInput(hit.pick.part, true); setTimeout(() => setInput(hit.pick.part, false), 400); }
    inspectPart(hit.pick.part, e);
    return;
  }
  if (hit.pick?.board) { inspectAt(hit.info?.title ? hit.info : boardInfo(), e); return; }
  if (hit.info) inspectAt(hit.info, e);
});
addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && pending) { pending = null; paintDots(); }
});

// ------------------------------------------------------------------ info tabs
const SEV = { error: ['Error', 'cd-err'], warn: ['Warning', 'cd-warn'], info: ['Note', 'cd-info'] };
function renderTab(name) {
  if (!circ) return '';
  const errs = result.issues.filter((i) => i.sev === 'error'), warns = result.issues.filter((i) => i.sev === 'warn');
  if (name === 'overview') {
    return `<h2>Your circuit</h2>
      ${notice ? `<p class="sb-notice">${esc(notice)}${undoBoard ? ' <button type="button" class="cd-btn sb-undo" data-act="undo-board">Undo</button>' : ''}</p>` : ''}
      <label class="sb-name"><span>Name</span><input type="text" data-act="name" maxlength="60" value="${esc(circ.name)}"></label>
      <div class="sb-boards" role="group" aria-label="Board">${Object.entries(BOARDS).map(([k, b]) => `<button type="button" class="cd-btn${k === circ.board ? ' is-down' : ''}" data-board="${k}" aria-pressed="${k === circ.board}">${esc(b.name)}</button>`).join('')}</div>
      <p class="sb-status ${errs.length ? 'is-bad' : 'is-ok'}">${errs.length ? `${ICONS.warn}${errs.length} error${errs.length > 1 ? 's' : ''} to fix before it can run` : `${ICONS.check}No errors — press Run`}${warns.length ? ` · ${warns.length} warning${warns.length > 1 ? 's' : ''}` : ''} · <a href="#" data-act="checks">see checks</a></p>
      <div class="sb-actions">
        <button type="button" class="cd-btn" data-act="add">${ICONS.chip}Add parts</button>
        <button type="button" class="cd-btn" data-act="save">Save</button>
        <button type="button" class="cd-btn" data-act="share">Share link</button>
        <button type="button" class="cd-btn" data-act="export">Export JSON</button>
        <button type="button" class="cd-btn" data-act="import">Import JSON</button>
        <button type="button" class="cd-btn" data-act="tidy">Tidy layout</button>
        <button type="button" class="cd-btn cd-danger" data-act="clear">Clear</button>
      </div>
      ${shareUrl ? `<label class="sb-share"><span>Share link (copied)</span><input type="text" readonly value="${esc(shareUrl)}" data-act="sharebox"></label>` : ''}
      <ol class="steps sb-how"><li>Add parts from <b>Components</b> or start from a <b>template</b>.</li><li>Click a pin dot, then another pin, to run a wire. Click a wire to delete it.</li><li>Fix anything the <b>Checks</b> tab flags, then press <b>Run</b>.</li></ol>
      <p class="cd-note">Saved in this browser only. Share links hold the whole circuit in the URL — nothing is uploaded.</p>`;
  }
  if (name === 'pinout') {
    const ends = endpointsAll();
    const opts = ends.map((r) => `<option value="${esc(r)}">${esc(refLabel(circ, r))}</option>`).join('');
    const rows = circ.wires.map(([a, b], i) => `<tr><td><span class="wire-dot" style="--c:${wireCss(a, b, i)}"></span>${esc(refLabel(circ, a))}</td><td>${esc(refLabel(circ, b))}</td><td><button type="button" class="cd-btn sb-x" data-delwire="${i}" aria-label="Delete wire ${i + 1}">${ICONS.close}</button></td></tr>`).join('');
    return `<h2>Wiring list</h2><p class="sub">${circ.wires.length} wire${circ.wires.length === 1 ? '' : 's'}. Click pins in the 3D view, or pick two endpoints here.</p>
      <div class="sb-addwire"><select data-w="a" aria-label="From">${opts}</select><select data-w="b" aria-label="To">${opts}</select><button type="button" class="cd-btn" data-act="addwire">Add wire</button></div>
      ${rows ? `<table class="pin-table"><thead><tr><th>From</th><th>To</th><th></th></tr></thead><tbody>${rows}</tbody></table>` : '<p class="cd-note">No wires yet.</p>'}`;
  }
  if (name === 'example') {
    const items = result.issues.map((i) => `<li class="sb-issue ${SEV[i.sev][1]}"><b>${SEV[i.sev][0]}</b><span>${esc(i.msg)}</span></li>`).join('');
    return `<h2>Checks</h2><p class="sub">Voltage, polarity, current, pin conflicts and bus pins, re-checked on every change.</p>
      ${items ? `<ul class="sb-issues">${items}</ul><button type="button" class="cd-btn cd-ai-explain" data-act="ai-explain"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/></svg><span>Explain with AI</span></button>` : `<p class="sb-status is-ok">${ICONS.check}All checks pass.</p>`}
      <p class="cd-note">The checks catch common mistakes but are not a full electrical simulation — double-check datasheets before powering real hardware.</p>`;
  }
  // parts list (BOM)
  const counts = new Map();
  for (const p of circ.parts) {
    const k = `${p.type}|${p.type === 'resistor' ? p.opts?.ohms || '330' : p.type === 'led' ? p.opts?.color || 'red' : ''}`;
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  const lines = [[1, BOARDS[circ.board].name, circ.board === 'pi5' ? 'Raspberry Pi 5 (any RAM size) + official 27 W USB-C supply + microSD card' : 'ESP32 DevKit V1 (WROOM-32) + micro-USB data cable'], [1, 'Breadboard', 'Full-size 830-point solderless breadboard'], [circ.wires.length, 'Jumper wires', 'Dupont jumper wires (male-male and male-female)']];
  for (const [k, n] of counts) { const [type, v] = k.split('|'); lines.push([n, `${PARTS[type].name}${v ? ` (${type === 'resistor' ? `${v} Ω` : v})` : ''}`, PARTS[type].buy]); }
  bomText = lines.filter(([n]) => n).map(([n, what, buy]) => `${n} x ${what} — ${buy}`).join('\n');
  return `<h2>Parts list</h2><p class="sub">Everything to build this circuit for real.</p>
    <ul class="cd-buy">${lines.filter(([n]) => n).map(([n, what, buy]) => `<li><b>${n}×</b><span><b>${esc(what)}</b> — ${esc(buy)}</span></li>`).join('')}</ul>
    <button type="button" class="cd-btn" data-act="copybom">Copy list</button>
    <p class="cd-note">Generic parts — any electronics supplier will do. No prices or shop links here on purpose.</p>`;
}
let bomText = '';
function endpointsAll() {
  return [...pinsOf(circ.board).map((p) => p.id), ...circ.parts.flatMap((p) => PARTS[p.type].pins.map((d) => `${p.id}.${d.n}`))];
}
const infoContent = $('.info-card .info-content');
infoContent.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-act], [data-board], [data-delwire]');
  if (!b) return;
  if (b.tagName === 'A') e.preventDefault();
  if (b.dataset.board) return setBoard(b.dataset.board);
  if (b.dataset.delwire != null) return removeWire(+b.dataset.delwire);
  const act = b.dataset.act;
  if (act === 'checks') info.show('example');
  else if (act === 'ai-explain') window.CircuitDeckAI?.open({ mode: 'wiring', issues: result.issues.map((i) => `${SEV[i.sev][0]}: ${i.msg}`).join('\n') });
  else if (act === 'undo-board') undoBoardSwitch();
  else if (act === 'add') openFly('parts', $('[data-nav=parts]'));
  else if (act === 'save') {
    if (store.listSaves().some((s) => s.name === circ.name) && !confirm(`“${circ.name}” is already in My saves. Replace it?`)) { notice = 'Not saved — rename the circuit to keep both versions.'; info.show('overview'); return; }
    notice = store.saveNamed(circ) ? `Saved “${circ.name}”. Find it under Templates → My saves.` : 'Could not save — browser storage is full or blocked.'; info.show('overview'); }
  else if (act === 'share') await share();
  else if (act === 'export') store.download(circ);
  else if (act === 'import') fileIn.click();
  else if (act === 'tidy') { for (const p of circ.parts) { delete p.x; delete p.z; } for (const p of circ.parts) place(p); notice = 'Parts re-arranged.'; changed(); }
  else if (act === 'clear') { if (!circ.parts.length && !circ.wires.length) return; if (!confirm('Remove every part and wire?')) return; circ.parts = []; circ.wires = []; notice = 'Cleared. Add parts from Components.'; changed(); }
  else if (act === 'addwire') { const a = $('[data-w=a]', infoContent).value, c2 = $('[data-w=b]', infoContent).value; addWire(a, c2); }
  else if (act === 'copybom') { try { await navigator.clipboard.writeText(bomText); b.textContent = 'Copied'; } catch { b.textContent = 'Copy blocked'; } }
});
infoContent.addEventListener('change', (e) => {
  if (e.target.dataset.act === 'name') { circ.name = e.target.value.replace(/[<>]/g, '').slice(0, 60).trim() || 'My circuit'; store.saveCurrent(circ); document.title = `${circ.name} · Sandbox · CircuitDeck`; }
});
infoContent.addEventListener('focusin', (e) => { if (e.target.dataset.act === 'sharebox') e.target.select(); });
fileIn.addEventListener('change', async () => {
  const f = fileIn.files[0];
  fileIn.value = '';
  if (!f) return;
  try {
    if (f.size > 200000) throw new Error('File is too big for a circuit.');
    importJSON(await f.text());
  } catch (err) { notice = `Import failed: ${err.message}`; info.show('overview'); }
});
function importJSON(text) {
  let raw;
  try { raw = JSON.parse(text); } catch { throw new Error('Not valid JSON.'); }
  load(raw);
  notice = `Imported “${circ.name}”.${keptNote()}`;
  info.show('overview');
}
async function share() {
  const code = await store.encodeShare(circ);
  shareUrl = `${location.origin}${location.pathname}#${code}`;
  history.replaceState(null, '', `#${code}`);
  try { await navigator.clipboard.writeText(shareUrl); } catch { /* the box below still shows it */ }
  notice = shareUrl.length > 8000 ? 'This link is very long — some apps may cut it. Export JSON is safer for big circuits.' : 'Anyone with this link sees this exact circuit.';
  info.show('overview');
  return shareUrl;
}

// ------------------------------------------------------------------ inputs panel
function renderPanel() {
  spec = inputSpec(circ, result.conn);
  inputs = { ...defaultInputs(spec), ...Object.fromEntries(Object.entries(inputs).filter(([k]) => spec.some((s) => s.id === k))) };
  inputs.__keys = [];
  if (liveCam) inputs.__live = liveCam.latest;
  if (!spec.length) { stopWebcam(); panel.hidden = true; panel.innerHTML = ''; return; }
  panel.hidden = false;
  const rows = spec.map((s) => {
    if (s.kind === 'range') return `<label class="cd-in"><span>${esc(s.label)}</span><input type="range" data-input="${esc(s.id)}" min="${s.min}" max="${s.max}" step="${s.step}" value="${inputs[s.id]}"><output>${esc(`${inputs[s.id]} ${s.unit}`)}</output></label>`;
    if (s.kind === 'select') return `<label class="cd-in"><span>${esc(s.label)}</span><select data-input="${esc(s.id)}">${s.options.map((o) => `<option ${o === inputs[s.id] ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></label>`;
    if (s.kind === 'keys') return `<div class="sb-keys" role="group" aria-label="Keypad">${['1', '2', '3', 'A', '4', '5', '6', 'B', '7', '8', '9', 'C', '*', '0', '#', 'D'].map((k) => `<button type="button" class="cd-btn" data-key="${k}">${k}</button>`).join('')}</div>`;
    return `<button type="button" class="cd-btn cd-press" data-input="${esc(s.id)}">${ICONS.hand}<span>${esc(s.label)}</span></button>`;
  }).join('');
  const camScene = spec.some((s) => s.id === 'scene');
  panel.innerHTML = `<header><h3>Inputs</h3><small>${liveCam ? 'Your webcam' : 'Simulated'}</small></header>${camScene ? '<canvas class="cd-preview sb-live" width="320" height="180" aria-label="Webcam preview with detections" hidden style="display:none"></canvas><div class="cd-ml-row"></div><p class="cd-ml-note" hidden></p>' : ''}${rows}`;
  if (camScene) mountWebcam(); else stopWebcam();
}
// ---- M8: the visitor's webcam as the AI camera, run by MediaPipe in the browser
let liveCam = null, mlBtn = null, liveRaf = 0;
async function mountWebcam() {
  const row = panel.querySelector('.cd-ml-row');
  const note = panel.querySelector('.cd-ml-note');
  if (!window.CircuitDeckML) await import('/shared/ml-camera.js');
  if (!row.isConnected) return;
  if (!mlBtn) mlBtn = window.CircuitDeckML.toggleButton({
    mode: 'objects', label: 'Use my webcam (runs in your browser)',
    onStart(cam) { liveCam = cam; inputs.__live = cam.latest; syncLive(); },
    onStop() { liveCam = null; delete inputs.__live; syncLive(); },
    onError(msg) { const n = panel.querySelector('.cd-ml-note'); if (n) { n.hidden = false; n.textContent = msg; } },
  });
  row.appendChild(mlBtn);
  if (note) { note.hidden = false; note.textContent = 'Object detection runs on this device with MediaPipe — no video leaves your browser.'; }
  syncLive();
}
function syncLive() {
  const cv = panel.querySelector('.sb-live');
  const sel = panel.querySelector('[data-input="scene"]');
  const small = panel.querySelector('header small');
  if (small) small.textContent = liveCam ? 'Your webcam' : 'Simulated';
  if (sel) sel.closest('label').style.display = liveCam ? 'none' : '';
  if (!cv) return;
  cv.hidden = !liveCam; cv.style.display = liveCam ? '' : 'none';
  cancelAnimationFrame(liveRaf);
  if (!liveCam) return;
  const c = cv.getContext('2d');
  const loop = () => { if (!liveCam || !cv.isConnected) return; liveCam.draw(c, cv.width, cv.height); liveRaf = requestAnimationFrame(loop); };
  loop();
}
function stopWebcam() { if (mlBtn) { mlBtn.stopCam(); mlBtn = null; } liveCam = null; delete inputs.__live; cancelAnimationFrame(liveRaf); }
function setInput(id, v) {
  inputs[id] = v;
  if (insts[id]?.pressable) insts[id].set({ pressed: !!v });
  if (insts[id] && partById(id)?.type === 'pir') insts[id].set({ motion: !!v });
  const el = panel.querySelector(`[data-input="${CSS.escape(id)}"]`);
  if (el?.tagName === 'BUTTON') el.classList.toggle('is-down', !!v);
}
panel.addEventListener('input', (e) => {
  const el = e.target.closest('[data-input]');
  if (!el || el.tagName === 'BUTTON') return;
  const s = spec.find((x) => x.id === el.dataset.input);
  const v = el.type === 'range' ? Number(el.value) : el.value;
  setInput(s.id, v);
  if (el.type === 'range') el.nextElementSibling.textContent = `${v} ${s.unit}`;
});
panel.addEventListener('click', (e) => {
  const k = e.target.closest('[data-key]');
  if (k) { inputs.__keys.push(k.dataset.key); sfx.key(); }
});
panel.addEventListener('pointerdown', (e) => {
  const b = e.target.closest('button[data-input]');
  if (!b) return;
  setInput(b.dataset.input, true);
  const up = () => { setInput(b.dataset.input, false); removeEventListener('pointerup', up); removeEventListener('pointercancel', up); };
  addEventListener('pointerup', up); addEventListener('pointercancel', up);
});
panel.addEventListener('keydown', (e) => {
  const b = e.target.closest('button[data-input]');
  if (b && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); e.stopPropagation(); setInput(b.dataset.input, true); setTimeout(() => setInput(b.dataset.input, false), 400); }
});

// ------------------------------------------------------------------ audio
// Part sounds (buzzers, relays, servos, motors, steppers, fans, buttons) come from
// core/sound.js reacting to part state changes; these two are kept for the sim API.
function beep(on) { if (!on) return; }
function click() { sfx.shutter(); }

// ------------------------------------------------------------------ run / stop
function start() {
  if (run) return;
  cc.clear(); cc.openConsole();
  const pi = circ.board === 'pi5';
  cc.print(pi ? 'pi@raspberrypi:~ $ python3 main.py' : 'Uploading sketch.ino to the ESP32… done. Serial monitor @ 115200 baud', 'cd-cmd');
  const errs = result.issues.filter((i) => i.sev === 'error');
  if (errs.length) {
    for (const i of errs) cc.print(`✗ ${i.msg}`, 'cd-err');
    cc.print('Fix these in the Checks tab, then press Run again.', 'cd-dim');
    info.show('example');
    return;
  }
  if (!circ.parts.length) { cc.print('Nothing to run yet — add some parts first.', 'cd-dim'); return; }
  for (const w of result.issues.filter((i) => i.sev === 'warn')) cc.print(`! ${w.msg}`, 'cd-warn');
  cc.setRunning(true);
  try {
    run = runSim({ c: circ, conn: result.conn, insts: Object.assign(Object.create(null), insts, { __shutter: click, __sfx: sfx }), inputs, print: (t, cls) => cc.print(t, cls), beep: (on) => beep(on), mark: (n) => cc.mark(n), codeLines: genOut.code.split('\n') });
  } catch (err) {
    console.error(err);
    run = null; cc.setRunning(false); resetStates();
    cc.print(`Simulation error: ${err.message}`, 'cd-err');
  }
}
function stop(user) {
  if (!run) return;
  run.stop();
  run = null;
  if (user) cc.print(circ.board === 'pi5' ? '^C\nKeyboardInterrupt' : '(stopped)', 'cd-dim');
  cc.setRunning(false);
  resetStates();
}
function resetStates() {
  sfx.stopAll();
  for (const [id, inst] of Object.entries(insts)) {
    if (inst.type === 'epaper' || !inst.state) continue;
    const s = {};
    for (const k of Object.keys(inst.state)) s[k] = typeof inst.state[k] === 'boolean' ? false : typeof inst.state[k] === 'number' ? 0 : Array.isArray(inst.state[k]) ? inst.state[k].map((v) => (Array.isArray(v) ? v.map(() => 0) : v === null ? null : 0)) : inst.state[k];
    if (inst.pressable) s.pressed = !!inputs[id];
    inst.set(s);
  }
}

// ------------------------------------------------------------------ flyouts
const CATS = ['Output', 'Input', 'Sensor', 'Display', 'Motion', 'Passive', 'Interface', 'Power', 'Pi 5'];
// m5: a damaged save still gets a readable line
function saveMeta(s) {
  const board = BOARDS[s.circuit?.board]?.short || 'Unknown board';
  const d = new Date(s.at);
  return Number.isFinite(s.at) && !Number.isNaN(d.getTime()) ? `${board} · ${d.toLocaleString()}` : `${board} · date unknown`;
}
function flyHead(title, extra = '') { return `<header><h2>${title}</h2>${extra ? `<span>${extra}</span>` : ''}</header>`; }
function openFly(kind, link) {
  if (kind === 'lessons') {
    const saves = store.listSaves();
    fly.open('lessons', `${flyHead('Starter templates', `${TEMPLATES.length}`)}<ol class="fly-list">${TEMPLATES.map((t) => `
      <li><button data-tpl="${t.id}"><span class="fly-num">${t.board === 'pi5' ? 'Pi' : 'E'}</span><span class="fly-text"><b>${esc(t.title)}</b><small>${esc(BOARDS[t.board].short)} · ${esc(t.difficulty)} · ${esc(t.blurb)}</small></span></button></li>`).join('')}</ol>
      <h3 class="cd-h3">My saves</h3>${saves.length ? `<ul class="fly-list">${saves.map((s, i) => `<li class="sb-save"><button data-load="${i}"><span class="fly-text"><b>${esc(s.name)}</b><small>${esc(saveMeta(s))}</small></span></button><button class="cd-btn sb-x" data-delsave="${i}" aria-label="Delete ${esc(s.name)}">${ICONS.close}</button></li>`).join('')}</ul>` : '<p class="cd-note">Nothing saved yet — use Save on the Circuit tab.</p>'}`, link);
  } else if (kind === 'parts') {
    const by = (cat) => Object.entries(PARTS).filter(([, d]) => d.cat === cat);
    fly.open('parts', `${flyHead('Components', `${circ.parts.length} in circuit`)}
      <input type="search" class="sb-search" placeholder="Search parts…" aria-label="Search parts">
      ${CATS.map((cat) => { const list = by(cat); return list.length ? `<h3 class="cd-h3 sb-cat">${esc(cat)}</h3><ul class="fly-list sb-lib">${list.map(([type, d]) => { const off = d.board === 'pi5' && circ.board !== 'pi5'; return `<li data-name="${esc(`${d.name} ${type} ${cat}`.toLowerCase())}"><button data-add="${type}" ${off ? 'disabled title="Raspberry Pi 5 only"' : ''}><span class="fly-text"><b>${esc(d.name)}</b><small>${esc(off ? 'Pi 5 only' : d.desc.split('. ')[0])}</small></span><span class="sb-plus" aria-hidden="true">+</span></button></li>`; }).join('')}</ul>` : ''; }).join('')}
      ${circ.parts.length ? `<h3 class="cd-h3">In this circuit</h3><ul class="fly-list">${circ.parts.map((p) => `<li class="sb-save"><button data-inspect="${esc(p.id)}"><span class="fly-text"><b>${esc(partName(circ, p))}</b><small>${esc(p.id)}</small></span></button><button class="cd-btn sb-x" data-rm="${esc(p.id)}" aria-label="Remove ${esc(partName(circ, p))}">${ICONS.close}</button></li>`).join('')}</ul>` : ''}`, link);
  } else if (kind === 'settings') {
    fly.open('settings', `${flyHead('Settings')}<ul class="fly-list cd-parts">
      <li><label class="switch cd-row"><input type="checkbox" data-set="labels" ${settings.labels ? 'checked' : ''}><span class="switch-track"><span></span></span><span class="fly-text"><b>Part labels</b><small>Show the tags over the 3D view</small></span></label></li>
      <li><label class="switch cd-row"><input type="checkbox" data-set="sound" ${isSoundOn() ? 'checked' : ''}><span class="switch-track"><span></span></span><span class="fly-text"><b>Sound</b><small>Buzzers and clicks while running</small></span></label></li>
      <li><label class="switch cd-row"><input type="checkbox" data-set="dark" ${document.documentElement.dataset.theme === 'dark' ? 'checked' : ''}><span class="switch-track"><span></span></span><span class="fly-text"><b>Dark theme</b><small>Also in the header (sun/moon)</small></span></label></li>
      </ul>`, link);
  } else if (kind === 'reference') {
    fly.open('reference', `${flyHead('Reference')}<dl class="cd-ref">
      <div><dt>Click pin, then pin</dt><dd>Add a wire</dd></div><div><dt>Esc</dt><dd>Cancel a wire</dd></div><div><dt>Click a wire</dt><dd>Inspect / delete it</dd></div>
      <div><dt>Click a part</dt><dd>Move, rotate, change value, remove</dd></div>
      <div><dt>Drag · WASD / arrows</dt><dd>Pan the view (left or right button; one finger on touch)</dd></div><div><dt>Middle-drag · Q / E</dt><dd>Rotate</dd></div><div><dt>Scroll · pinch · + / −</dt><dd>Zoom</dd></div><div><dt>R</dt><dd>Reset the view</dd></div><div><dt>Space</dt><dd>Run / stop</dd></div></dl>
      <p class="cd-note">Pin dots: gold = GPIO, red = 5 V, orange = 3.3 V, dark = GND, blue = part pins. Both boards use 3.3 V logic — 5 V on a GPIO is flagged as an error.</p>`, link);
  } else if (kind === 'language') {
    fly.open('language', `${flyHead('Language')}<p class="cd-note">The sandbox is in English for now.</p>`, link);
  } else if (kind === 'home') { fly.close(); location.href = '/gallery/'; }
}
$('.sidebar').addEventListener('click', (e) => {
  const a = e.target.closest('[data-nav]');
  if (!a) return;
  e.preventDefault();
  openFly(a.dataset.nav, a);
});
$('#flyout').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.tpl) { fly.close(); loadTemplate(b.dataset.tpl); }
  else if (b.dataset.load != null) { const s = store.listSaves()[+b.dataset.load]; fly.close(); try { load(s.circuit); notice = `Opened “${circ.name}”.${keptNote()}`; info.show('overview'); } catch (err) { notice = `Could not open it: ${err.message}`; info.show('overview'); } }
  else if (b.dataset.delsave != null) { const s = store.listSaves()[+b.dataset.delsave]; if (s && confirm(`Delete “${s.name}”?`)) { store.deleteSave(s.name); openFly('lessons', $('[data-nav=lessons]')); } }
  else if (b.dataset.add) { const id = addPart(b.dataset.add); if (id) { openFly('parts', $('[data-nav=parts]')); flash(`Added ${partName(circ, partById(id))} — click its pins to wire it.`); } }
  else if (b.dataset.rm) { removePart(b.dataset.rm); openFly('parts', $('[data-nav=parts]')); }
  else if (b.dataset.inspect) { fly.close(); inspectPart(b.dataset.inspect); }
});
$('#flyout').addEventListener('input', (e) => {
  if (!e.target.matches('.sb-search')) return;
  const q = e.target.value.trim().toLowerCase();
  const fl = $('#flyout');
  fl.querySelectorAll('.sb-lib li').forEach((li) => { li.hidden = q && !li.dataset.name.includes(q); });
  // hide a category heading (and its list) when nothing in it matches
  fl.querySelectorAll('.sb-lib').forEach((ul) => {
    const any = [...ul.querySelectorAll('li')].some((li) => !li.hidden);
    ul.hidden = !any;
    const h = ul.previousElementSibling;
    if (h && h.matches('.sb-cat, h3, h4')) h.hidden = !any;
  });
  let none = fl.querySelector('.sb-none');
  const shown = fl.querySelectorAll('.sb-lib li:not([hidden])').length;
  if (!shown && q) {
    if (!none) { none = document.createElement('p'); none.className = 'cd-note sb-none'; none.setAttribute('role', 'status'); e.target.after(none); }
    none.textContent = `No parts match “${e.target.value.trim()}”. Try a part name such as LED, servo or sensor.`;
  } else none?.remove();
});
$('#flyout').addEventListener('change', (e) => {
  const c = e.target;
  if (c.dataset.set === 'labels') { settings.labels = c.checked; stage.setTagsVisible(c.checked); storeSet(SET_KEY, settings); }
  if (c.dataset.set === 'sound') { setSound(c.checked); }
  if (c.dataset.set === 'dark') window.CircuitDeck?.setTheme(c.checked ? 'dark' : 'light');
});
addEventListener('keydown', (e) => {
  if (e.target.closest('input, select, textarea, [contenteditable], .cd-chrome')) return;
  if (e.key === ' ' && !e.target.closest('button, a, [role=button], [role=tab], [role=switch]')) { e.preventDefault(); cc.running ? stop(true) : start(); }
});

// m4: readable reasons instead of raw browser errors
function shareError(err) {
  const m = String(err?.message || '');
  const why = /^(Not a CircuitDeck|Unsupported circuit|Board must|Circuit needs|Too many|Bad part|Duplicate part|Unknown part|Bad wire)/.test(m) ? m.replace(/\.$/, '')
    : 'the link looks incomplete or damaged — ask for it to be copied again';
  return `That share link could not be opened: ${why}. Your own circuit was not changed.`;
}

// ------------------------------------------------------------------ boot
async function boot() {
  const h = location.hash;
  if (/^#[cj]=/.test(h)) {
    try { load(await store.decodeShare(h)); notice = `Opened a shared circuit: “${circ.name}”. Save it to keep your own copy.${keptNote()}`; info.show('overview'); history.replaceState(null, '', h); return; } catch (err) { notice = shareError(err); }
  }
  const t = /^#t=([\w-]+)/.exec(h);
  if (t && TEMPLATES.some((x) => x.id === t[1])) { loadTemplate(t[1]); return; }
  const cur = store.loadCurrent();
  if (cur) { const n = notice; load(cur, { keep: false }); notice = n || 'Welcome back — this is the circuit you were working on.'; info.show('overview'); return; }
  const n = notice;
  loadTemplate('traffic-light');
  if (n) { notice = n; info.show('overview'); }
}
addEventListener('hashchange', async () => {
  const h = location.hash;
  if (/^#[cj]=/.test(h) && !shareUrl.endsWith(h)) { try { load(await store.decodeShare(h)); notice = `Opened a shared circuit: “${circ.name}”.${keptNote()}`; info.show('overview'); } catch (err) { notice = shareError(err); info.show('overview'); } }
  else if (/^#t=/.test(h)) loadTemplate(h.slice(3));
});
await boot();
requestAnimationFrame(() => requestAnimationFrame(() => {
  document.documentElement.classList.remove('is-loading');
  app.inert = false;
  $('#loader')?.classList.add('is-done');
  setTimeout(() => $('#loader')?.remove(), 700);
}));
// for tests and the thumbnail script
// M8: what the AI tutor sees on this page
window.__cdAIContext = () => ({
  track: 'sandbox', id: circ?.name || 'circuit', title: `Sandbox · ${circ?.name || 'My circuit'} (${BOARDS[circ?.board]?.name || ''})`,
  lesson: circ ? `Parts: ${circ.parts.map((p) => `${p.id} (${PARTS[p.type]?.name || p.type}${p.opts?.ohms ? `, ${p.opts.ohms} Ω` : ''}${p.opts?.color ? `, ${p.opts.color}` : ''})`).join('; ')}\nWires: ${circ.wires.map(([a, b]) => `${refLabel(circ, a)} → ${refLabel(circ, b)}`).join('; ')}` : '',
  code: genOut.code, lang: genOut.lang,
  issues: result.issues.map((i) => `${SEV[i.sev][0]}: ${i.msg}`).join('\n'),
});
window.__sb = {
  stage, TEMPLATES, loadTemplate, load, addPart, addWire, removePart, removeWire, setBoard, inspectPart, start, stop: () => stop(true), share, importJSON,
  exportJSON: () => store.serialize(circ), decode: store.decodeShare, setInput,
  get circuit() { return circ; }, get issues() { return result.issues; }, get code() { return genOut; }, get running() { return !!run; }, get insts() { return insts; }, get inputs() { return inputs; }, get dots() { return dots; },
};
