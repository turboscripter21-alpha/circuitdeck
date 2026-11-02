// CircuitDeck · Raspberry Pi 5 track.
// Builds each project's 3D scene from its data (projects-a/b.js), runs its
// simulation against the code card, and keeps per-project progress.
import * as THREE from 'three';
import { createFit, startClock, storeGet, storeSet, esc } from '../core/layout.js';
import { createStage } from '../core/stage.js';
import { sfx, isSoundOn, setSound } from '../core/sound.js';
import { buildPi5, buildBreadboard, PI_PIN_NUMBER, PI_ALT } from '../core/boards.js';
import { makePart, drawScreen, PARTS } from '../core/parts.js';
import { ICONS, codeCard, tabs, flyout, inspector, lessonStrip, progress } from '../core/ui.js';
import { BB } from './projects-a.js';
import { PROJECTS, byId, buyList } from './projects.js';

const $ = (s, r = document) => r.querySelector(s);
const DONE_KEY = 'circuitdeck:pi5:done';
const SET_KEY = 'circuitdeck:pi5:settings';
const PI_POS = new THREE.Vector3(-6.5, 0, 0);
const PI_TOP = 0.16; // top face of the Pi's PCB (PI.t in boards.js)
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
stage = createStage({ canvas: $('#board-canvas'), tagsEl: $('#tags'), leadersEl: $('#leaders'), tipEl: $('#tip'), viewbar: $('#viewbar') });
const cc = codeCard($('.code-card'), { onRun: start, onStop: () => stop(true), consoleTitle: 'Terminal' });
const info = tabs($('.info-card'), renderTab);
const fly = flyout($('#flyout'), $('.sidebar'));
const insp = inspector($('#inspector'));
const prog = progress($('.status'), 'Raspberry Pi 5');
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
  pi = buildPi5();
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
    const ribbon = boardEnd && ['CAM0', 'CAM1', 'PCIE'].includes(boardEnd.name);
    const gndish = [a, b].some((e) => !e.board && PARTS[e.inst.type].pins.find((x) => x.n === e.pin)?.role === 'gnd');
    let css = boardEnd ? PIN_COLORS[boardEnd.name] : gndish ? PIN_COLORS.GND : null;
    if (!css) css = PALETTE[pal++ % PALETTE.length];
    if (o.color != null) css = `#${o.color.toString(16).padStart(6, '0')}`;
    if (boardEnd && !wireColors[boardEnd.name]) wireColors[boardEnd.name] = css;
    const color = new THREE.Color(css).getHex();
    const la = a.board ? pinLabel(a.name) : partPinLabel(a), lb = b.board ? pinLabel(b.name) : partPinLabel(b);
    stage.addWire(a.point, b.point, ribbon ? 0xe8e0d0 : color, {
      ribbon, width: boardEnd?.name === 'PCIE' ? 0.8 : 0.9, radius: o.radius,
      info: { title: ribbon ? 'Ribbon cable' : 'Jumper wire', desc: ribbon ? 'A flat flexible cable. Pi 5 uses the small 22-pin connector, so standard cameras need a 22-to-15-pin cable.' : 'A jumper wire joins two points of the circuit.', rows: [['From', la], ['To', lb]] },
    });
  }
  pi.resetPins();
  // tags
  const tags = [{ anchor: worldOf(pi.group, new THREE.Vector3(1.5, 1.4, 0.6)), label: 'Raspberry Pi 5', color: '#c51a4a', onClick: (e) => inspectAt(pi.group.userData.info || { title: 'Raspberry Pi 5', desc: 'BCM2712 quad-core Arm Cortex-A76 @ 2.4 GHz, with the RP1 I/O chip handling GPIO, USB and Ethernet.', rows: [['CPU', '4 × Cortex-A76 @ 2.4 GHz'], ['Power', '5 V / 5 A USB-C (27 W)'], ['GPIO', '3.3 V logic']] }, e) }];
  let k = 0;
  for (const part of p.parts) {
    const inst = insts[part.id];
    if (!inst || part.type === 'resistor' && p.parts.filter((x) => x.type === 'resistor').length > 2) continue;
    const t = { anchor: worldOf(inst.group, inst.anchor || new THREE.Vector3(0, 1, 0)), label: part.label, color: PALETTE[k++ % PALETTE.length], lift: 38 + (k % 2) * 16, onClick: (e) => inspectPart(part.id, e) };
    tags.push(t);
  }
  stage.setTags(tags);
  stage.setTagsVisible(settings.labels);
  tags.forEach((t, i) => { if (i) tagByPart[p.parts.find((x) => x.label === t.label)?.id] = t; });
  stage.addTick((t) => drawPreview(t));
  stage.renderer.toneMappingExposure = 1.05;
  stage.frame([stage.content, stage.wires], { zoom: p.noBreadboard ? 0.8 : 0.78 });
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
  panel.innerHTML = `<header><h3>${p.preview ? 'Camera &amp; inputs' : 'Inputs'}</h3><small>Simulated</small></header>${p.preview ? '<canvas class="cd-preview" width="320" height="180" aria-label="Simulated camera preview"></canvas>' : ''}${rows}`;
  drawPreview(0, true);
}
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
  if (!cv || (!previewFn && !force)) return;
  const c = cv.getContext('2d');
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
  cc.print(p.lang === 'sh' ? `pi@raspberrypi:~ $ bash ${p.id}.sh` : `pi@raspberrypi:~ $ python3 ${p.id}.py`, 'cd-cmd');
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
    has: (id) => !!insts[id],
    readout(id, text) { const t = tagByPart[id]; if (t?.btn) t.btn.firstChild.textContent = `${t.label} · ${text}`; },
    screen(id, fn) { if (!token.stopped) drawScreen(insts[id], fn); },
    preview(fn) { previewFn = fn; },
    beep(on) { if (!token.stopped) beep(on); },
    click() { if (!token.stopped) click(); },
    ambient(k) { stage.renderer.toneMappingExposure = 0.45 + 0.6 * Math.max(0, Math.min(1, k)); },
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
  if (user) cc.print(project.lang === 'sh' ? '^C' : '^C\nKeyboardInterrupt', 'cd-dim');
  cc.setRunning(false);
  resetStates();
}
function resetStates() {
  sfx.stopAll();
  previewFn = null; drawPreview(0, true);
  stage.renderer.toneMappingExposure = 1.05;
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
    const rows = p.pinout.map(([pin, to, does]) => `<tr><td><span class="wire-dot" style="--c:${wireColors[pin] || PIN_COLORS[pin] || '#8a94a3'}"></span><code>${esc(pin.replace(/^GPIO/, 'GPIO '))}</code>${PI_PIN_NUMBER[pin] ? `<small class="cd-phys">pin ${PI_PIN_NUMBER[pin]}</small>` : ''}</td><td>${esc(to)}</td><td>${esc(does)}</td></tr>`).join('');
    return `<h2>Pinout</h2><p class="sub">How this circuit is wired to the Pi 5. GPIO numbers are BCM numbers, as gpiozero uses them.</p>
      <table class="pin-table"><thead><tr><th>Pi 5 pin</th><th>Connects to</th><th>What it does</th></tr></thead><tbody>${rows}</tbody></table>`;
  }
  if (name === 'example') return `<h2>How the code works</h2><ol class="steps">${p.steps.map((s) => `<li>${s}</li>`).join('')}</ol>`;
  const buy = buyList(p);
  return `<h2>Specifications</h2>
    <dl class="spec-grid">${p.specs.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
    <h3 class="cd-h3">${ICONS.cart}What to buy</h3>
    <ul class="cd-buy">${buy.map(([q, what]) => `<li><b>${q}×</b><span>${esc(what)}</span></li>`).join('')}</ul>
    <p class="cd-note">Generic parts — any electronics supplier will do. Already have a Pi 5 set-up? Skip the first three lines.</p>`;
}

// ------------------------------------------------------------------ flyouts
function flyHead(title, extra = '') { return `<header><h2>${title}</h2>${extra ? `<span>${extra}</span>` : ''}</header>`; }
function openFly(kind, link) {
  if (kind === 'lessons') {
    fly.open('lessons', `${flyHead('Pi 5 projects', `${done.size}/${PROJECTS.length} done`)}<ol class="fly-list">${PROJECTS.map((p, i) => `
      <li><button data-go="${p.id}" class="${p === project ? 'is-current' : ''}"><span class="fly-num">${done.has(p.id) ? ICONS.check : i + 1}</span><span class="fly-text"><b>${esc(p.title)}</b><small>${esc(p.difficulty)} · ${esc(p.time)}</small></span></button></li>`).join('')}</ol>`, link);
  } else if (kind === 'parts') {
    const items = project.parts.map((part) => {
      const on = !removed.has(part.id), req = part.required !== false;
      return `<li><label class="switch cd-row"><input type="checkbox" data-part="${part.id}" ${on ? 'checked' : ''}><span class="switch-track"><span></span></span><span class="fly-text"><b>${esc(part.label)}</b><small>${esc(PARTS[part.type].name)} · ${req ? 'required' : 'optional'}</small></span></label></li>`;
    }).join('');
    fly.open('parts', `${flyHead('Components', `${project.parts.length - removed.size}/${project.parts.length} in use`)}
      ${project.parts.length ? `<ul class="fly-list cd-parts">${items}</ul><p class="cd-note">Switch a part off to take it out of the circuit, then press Run to see what happens.</p>${removed.size ? '<button class="cd-btn" data-restore>Put everything back</button>' : ''}` : '<p class="cd-note">This project uses the Pi 5 on its own — click any part of the board to learn about it.</p>'}`, link);
  } else if (kind === 'settings') {
    fly.open('settings', `${flyHead('Settings')}<ul class="fly-list cd-parts">
      <li><label class="switch cd-row"><input type="checkbox" data-set="labels" ${settings.labels ? 'checked' : ''}><span class="switch-track"><span></span></span><span class="fly-text"><b>Part labels</b><small>Show the tags over the 3D view</small></span></label></li>
      <li><label class="switch cd-row"><input type="checkbox" data-set="sound" ${isSoundOn() ? 'checked' : ''}><span class="switch-track"><span></span></span><span class="fly-text"><b>Sound</b><small>Buzzers and clicks while running</small></span></label></li>
      <li><label class="switch cd-row"><input type="checkbox" data-set="dark" ${document.documentElement.dataset.theme === 'dark' ? 'checked' : ''}><span class="switch-track"><span></span></span><span class="fly-text"><b>Dark theme</b><small>Also in the header (sun/moon)</small></span></label></li>
      </ul><button class="cd-btn cd-danger" data-reset>Reset Pi 5 progress</button>`, link);
  } else if (kind === 'reference') {
    fly.open('reference', `${flyHead('Reference')}<dl class="cd-ref">
      <div><dt>Drag · WASD</dt><dd>Pan the view</dd></div><div><dt>Right-drag · Q / E</dt><dd>Rotate</dd></div><div><dt>Scroll · + / −</dt><dd>Zoom</dd></div>
      <div><dt>R</dt><dd>Reset the view</dd></div><div><dt>Space</dt><dd>Run / stop the program</dd></div><div><dt>[ · ]</dt><dd>Previous / next project</dd></div>
      <div><dt>Click a part</dt><dd>Inspect it (and remove it)</dd></div></dl>
      <p class="cd-note">Pi 5 facts used here: BCM2712, 4 × Cortex-A76 @ 2.4 GHz; RP1 I/O chip; 3.3 V GPIO; 5 V / 5 A USB-C; PCIe 2.0 ×1; two 4-lane MIPI CSI/DSI ports. GPIO code uses <code>gpiozero</code> (lgpio backend) — <code>RPi.GPIO</code> and <code>pigpio</code> do not work on the Pi 5.</p>`, link);
  } else if (kind === 'language') {
    fly.open('language', `${flyHead('Language')}<p class="cd-note">The Pi 5 track is in English for now. The ESP32 track has more languages.</p>`, link);
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
  if (e.target.closest('[data-reset]')) { done.clear(); storeSet(DONE_KEY, []); strip.setDone(done); prog.set(0, PROJECTS.length); }
});
$('#flyout').addEventListener('change', (e) => {
  const c = e.target;
  if (c.dataset.part) { togglePart(c.dataset.part, c.checked); const s = $('#flyout header span'); if (s) s.textContent = `${project.parts.length - removed.size}/${project.parts.length} in use`; }
  if (c.dataset.set === 'labels') { settings.labels = c.checked; stage.setTagsVisible(c.checked); storeSet(SET_KEY, settings); }
  if (c.dataset.set === 'sound') { setSound(c.checked); }
  if (c.dataset.set === 'dark') window.CircuitDeck?.setTheme(c.checked ? 'dark' : 'light');
});
function togglePart(id, on) {
  if (on) removed.delete(id); else removed.add(id);
  rebuild();
}
function rebuild() {
  const was = !!run;
  stop(false);
  const cam = { pos: stage.camera.position.clone(), target: stage.controls.target.clone() };
  buildScene(project);
  stage.camera.position.copy(cam.pos); stage.controls.target.copy(cam.target); stage.controls.update();
  if (was) cc.print('Circuit changed — press Run again.', 'cd-dim');
}

// ------------------------------------------------------------------ routing
function go(id) { if (location.hash.slice(1) !== id) location.hash = id; else show(id); }
function show(id) {
  const p = byId[id] || PROJECTS[0];
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
  document.title = `${p.title} · Raspberry Pi 5 · CircuitDeck`;
}
addEventListener('hashchange', () => show(location.hash.slice(1)));
addEventListener('keydown', (e) => {
  if (e.target.closest('input, select, textarea, [contenteditable], .cd-chrome')) return;
  const i = PROJECTS.indexOf(project);
  if (e.key === '[' && i > 0) go(PROJECTS[i - 1].id);
  else if (e.key === ']' && i < PROJECTS.length - 1) go(PROJECTS[i + 1].id);
  else if (e.key === ' ' && !e.target.closest('button, a')) { e.preventDefault(); cc.running ? stop(true) : start(); }
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
// for the thumbnail script and tests
window.__pi5 = { stage, PROJECTS, show, start, stop: () => stop(true), get project() { return project; }, get insts() { return insts; } };
