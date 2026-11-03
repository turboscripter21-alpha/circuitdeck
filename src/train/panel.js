// M10: the Train panel, a left sidebar in the sandbox with Data, Train and Test & deploy tabs.
// Everything runs in the browser: capture → IndexedDB → TF.js training → live test → export / flash.
import { esc } from '../core/layout.js';
import { SENSORS, ACTIONS, MIC, MOTION } from './spec.js';
import * as db from './db.js';
import { makeSource } from './sensors.js';
import * as M from './model.js';
import { esp32Zip, piZip, download } from './export.js';
import { hasSerial, whyNoSerial, flash, MODEL_ADDR } from './flash.js';

const X = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"></path></svg>';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (v) => `${Math.round((v || 0) * 100)}%`;
const WINDOW_MS = { camera: 0, mic: (MIC.frames * MIC.hopMs), motion: (MOTION.steps * 1000) / MOTION.hz };
const HOLD_MS = { camera: 160, mic: 500, motion: 500 };
const TABS = [['data', 'Data'], ['train', 'Train'], ['deploy', 'Test & deploy']];

let host = null, root = null, st = null;

function fresh(sensor) {
  return { sensor, tab: st?.tab || 'data', meta: null, samples: [], src: null, srcErr: '', model: null, result: null, training: false, stop: false,
    epoch: null, testing: false, probs: null, wrong: false, flashLog: '', flashing: false, notice: '', firmware: null, raf: 0, busy: 0 };
}

export async function open(h, { sensor, tab } = {}) {
  host = h;
  if (!root) mount();
  root.hidden = false; root.classList.add('is-open');
  document.documentElement.classList.add('train-open');
  if (!st || (sensor && sensor !== st.sensor)) await switchSensor(sensor || st?.sensor || 'camera');
  if (tab) st.tab = tab;
  render();
  return api;
}
export function close() {
  if (!root) return;
  stopTest(); st?.src?.stop(); if (st) st.src = null;
  cancelAnimationFrame(st?.raf || 0);
  root.classList.remove('is-open'); root.hidden = true;
  document.documentElement.classList.remove('train-open');
  host?.onClose?.();
}
export const isOpen = () => !!root && !root.hidden;

function mount() {
  root = document.createElement('aside');
  root.className = 'tr-panel'; root.id = 'train-panel';
  root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', 'Train a model');
  (document.getElementById('app') || document.body).append(root);
  root.addEventListener('click', onClick);
  root.addEventListener('change', onChange);
  root.addEventListener('pointerdown', onHold);
  root.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
}

async function switchSensor(sensor) {
  stopTest();
  st?.src?.stop();
  const tab = st?.tab;
  st = fresh(sensor); if (tab) st.tab = tab;
  st.meta = await db.getMeta(sensor);
  st.samples = await db.listSamples(sensor);
  if (st.meta.trained) {
    st.model = await M.restore(sensor).catch(() => null);
    if (st.model) st.result = st.meta.trained;
  }
}

// ---------------------------------------------------------------- render
const classes = () => st.meta.classes;
const count = (id) => st.samples.filter((s) => s.cls === id).length;
const trainedNames = () => st.result?.classIds.map((id) => classes().find((c) => c.id === id)?.name ?? '(deleted)') || [];
const stale = () => !!st.result && (st.result.classIds.join() !== classes().map((c) => c.id).join() || st.result.nSamples !== st.samples.length);
function actions() { st.meta.actions ||= {}; return (st.result?.classIds || []).map((id, i) => st.meta.actions[id] || (i === 0 ? 'led' : 'none')); }

function render() {
  const sensor = st.sensor;
  root.innerHTML = `
    <header class="tr-head"><div><h2>Train a model</h2><small>Runs entirely in this browser with TensorFlow.js${M.backend() ? ` (${esc(M.backend())})` : ''}</small></div>
      <button class="cd-btn tr-x" data-act="close" aria-label="Close the Train panel">${X}</button></header>
    <div class="tr-seg" role="radiogroup" aria-label="Sensor">${Object.entries(SENSORS).map(([k, s]) => `<button role="radio" aria-checked="${k === sensor}" data-sensor="${k}">${esc(s.label)}</button>`).join('')}</div>
    <div class="tr-tabs" role="tablist">${TABS.map(([k, l]) => `<button role="tab" aria-selected="${st.tab === k}" data-tab="${k}">${l}</button>`).join('')}</div>
    ${st.notice ? `<p class="tr-notice" role="status">${esc(st.notice)}</p>` : ''}
    <section class="tr-body" data-body="${st.tab}">${st.tab === 'data' ? dataTab() : st.tab === 'train' ? trainTab() : deployTab()}</section>`;
  placePreview();
}

function previewHTML() {
  const s = st.sensor, live = st.src?.live;
  const sim = s === 'motion' && live && !st.src.events ? '<p class="tr-hint">No motion events yet. On a phone, move it. On a desktop, move the pointer over the graph to simulate tilt (shown as simulated).</p>' : '';
  return `<div class="tr-preview" data-preview="${s}">
    ${s === 'camera' ? '<div class="tr-video" data-slot="video"></div>' : `<canvas class="tr-live" width="360" height="150" aria-label="${s === 'mic' ? 'Live waveform and spectrogram' : 'Live motion axes'}"></canvas>`}
    ${live ? '' : `<div class="tr-off"><button class="cd-btn tr-primary" data-act="start">Turn on the ${s === 'camera' ? 'camera' : s === 'mic' ? 'microphone' : 'motion sensor'}</button>${st.srcErr ? `<p class="tr-err" role="alert">${esc(st.srcErr)}</p>` : ''}</div>`}
    ${live && st.src.simulated ? '<span class="tr-badge">simulated from the pointer</span>' : ''}
  </div>${sim}`;
}
function placePreview() {
  const slot = root.querySelector('[data-slot=video]');
  if (slot && st.src?.video) slot.append(st.src.video);
  cancelAnimationFrame(st.raf);
  const cv = root.querySelector('canvas.tr-live');
  if (cv && st.src?.live) {
    const loop = () => { if (!cv.isConnected) return; st.src.draw(cv); st.raf = requestAnimationFrame(loop); };
    loop();
    if (st.sensor === 'motion') cv.onpointermove = (e) => { if (st.src.events) return; const r = cv.getBoundingClientRect(); st.src.simulate(((e.clientX - r.left) / r.width) * 2 - 1, ((e.clientY - r.top) / r.height) * 2 - 1, Math.min(1, Math.hypot(e.movementX, e.movementY) / 30)); };
  }
}

function dataTab() {
  const s = st.sensor;
  return `<p class="tr-desc">${esc(SENSORS[s].desc)}</p>${previewHTML()}
    <ol class="tr-classes">${classes().map((c) => {
      const mine = st.samples.filter((x) => x.cls === c.id);
      return `<li class="tr-class" data-cls="${c.id}">
        <div class="tr-class-head"><input class="tr-name" value="${esc(c.name)}" data-rename="${c.id}" aria-label="Class name" maxlength="24">
          <span class="tr-count" data-count="${c.id}">${mine.length} ${mine.length === 1 ? 'sample' : 'samples'}</span>
          <button class="cd-btn tr-x" data-delclass="${c.id}" aria-label="Delete class ${esc(c.name)}" ${classes().length <= 2 ? 'disabled title="Keep at least two classes"' : ''}>${X}</button></div>
        <div class="tr-rec"><button class="cd-btn" data-record="${c.id}" ${st.src?.live ? '' : 'disabled'}>${s === 'camera' ? 'Record' : `Record ${s === 'mic' ? '1 s' : '2 s'}`}</button>
          <button class="cd-btn tr-hold" data-hold="${c.id}" ${st.src?.live ? '' : 'disabled'}>Hold to record</button></div>
        <div class="tr-thumbs">${mine.map((x, i) => `<button class="tr-thumb" data-delsample="${x.id}" aria-label="Delete ${esc(c.name)} sample ${i + 1}" title="Delete this sample"><img src="${x.thumb}" alt=""><span>${X}</span></button>`).join('')}</div>
      </li>`;
    }).join('')}</ol>
    <div class="tr-row"><button class="cd-btn" data-act="addclass" ${classes().length >= 8 ? 'disabled' : ''}>+ Add class</button>
      <span class="tr-spacer"></span><button class="cd-btn tr-ghost" data-act="clear">Clear ${esc(SENSORS[s].label.toLowerCase())} data</button></div>
    <p class="tr-hint">Saved in this browser (IndexedDB) and never uploaded.</p>`;
}

function canTrain() {
  const short = classes().filter((c) => count(c.id) < 3);
  if (classes().length < 2) return 'Add at least two classes.';
  if (short.length) return `Each class needs at least 3 samples (${short.map((c) => `${c.name}: ${count(c.id)}`).join(', ')}).`;
  return '';
}
function trainTab() {
  const why = canTrain(), r = st.result, e = st.epoch;
  const total = st.training ? st.epochsPlanned : r?.history?.length || 0;
  return `<p class="tr-desc">${esc(st.sensor === 'camera' ? 'Transfer learning: MobileNet V2 (0.35, frozen) features → dense 64 → softmax.' : st.sensor === 'mic' ? 'Conv2D 8 → pool → Conv2D 16 → pool → dense softmax, on the 40×32 spectrogram.' : 'Conv1D 16 (k=5) → pool → dense 24 → softmax, on the 40×6 window.')} 20% of each class is held out for validation.</p>
    <ul class="tr-sum">${classes().map((c) => `<li><b>${esc(c.name)}</b> ${count(c.id)}</li>`).join('')}</ul>
    <div class="tr-row"><label class="tr-field">Epochs <select data-epochs>${[10, 20, 30, 50, 80].map((n) => `<option ${n === (st.epochsPick || (st.sensor === 'camera' ? 30 : 50)) ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <span class="tr-spacer"></span>
      ${st.training ? '<button class="cd-btn" data-act="stoptrain">Stop</button>' : `<button class="cd-btn tr-primary" data-act="train" ${why ? 'disabled' : ''}>${r ? 'Retrain' : 'Train model'}</button>`}</div>
    ${why ? `<p class="tr-hint">${esc(why)}</p>` : ''}
    ${st.training || r ? `<div class="tr-progress" role="progressbar" aria-label="Training progress" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${e?.epoch || 0}"><span style="width:${total ? ((e?.epoch || 0) / total) * 100 : 0}%"></span></div>
      <p class="tr-epoch" aria-live="polite">${e ? `Epoch ${e.epoch}/${total} · loss ${e.loss.toFixed(3)} · acc ${pct(e.acc)}${e.valAcc != null ? ` · val loss ${e.valLoss.toFixed(3)} · val acc ${pct(e.valAcc)}` : ''}` : st.training ? 'Starting…' : ''}</p>
      <canvas class="tr-chart" width="360" height="110" aria-label="Accuracy and loss per epoch"></canvas>` : ''}
    ${r && !st.training ? resultHTML(r) : ''}`;
}
function resultHTML(r) {
  const names = trainedNames(), cm = r.cm, n = names.length;
  let mix = null;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (i !== j && cm[i][j] && (!mix || cm[i][j] > mix[2])) mix = [i, j, cm[i][j]];
  const max = Math.max(1, ...cm.flat());
  return `<div class="tr-result">
    <p><b>${r.evalOn === 'validation' ? 'Validation' : 'Training'} accuracy ${pct(r.accuracy)}</b> on ${r.evalOn === 'validation' ? `${r.nVal} held-out` : r.nTrain} samples (trained on ${r.nTrain}).${stale() ? ' <span class="tr-warn">The data changed since this training, so retrain.</span>' : ''}</p>
    <figure class="tr-cmwrap"><figcaption>Confusion matrix (${r.evalOn} set): rows = true class, columns = predicted</figcaption>
    <table class="tr-cm"><thead><tr><th></th>${names.map((x) => `<th scope="col">${esc(x)}</th>`).join('')}</tr></thead><tbody>
    ${cm.map((row, i) => `<tr><th scope="row">${esc(names[i])}</th>${row.map((v, j) => `<td class="${i === j ? 'is-diag' : v ? 'is-miss' : ''}" style="--a:${(v / max).toFixed(2)}">${v}</td>`).join('')}</tr>`).join('')}
    </tbody></table></figure>
    <p class="tr-mix">${mix ? `Most mixed up: <b>${esc(names[mix[0]])}</b> predicted as <b>${esc(names[mix[1]])}</b> (${mix[2]}×). Add more varied samples of both.` : 'No mix-ups on this set.'}</p>
    <button class="cd-btn tr-primary" data-tab="deploy">Test it live →</button></div>`;
}

function deployTab() {
  if (!st.model) return `<p class="tr-hint">Train a model first (Train tab).</p>`;
  const names = trainedNames(), acts = actions(), outs = host.outputs();
  const serial = hasSerial(), cam = st.sensor === 'camera';
  const byKind = (k) => outs.filter((o) => o.type === k).length;
  return `<h3 class="tr-h3">Live test</h3>
    ${previewHTML()}
    <div class="tr-row"><button class="cd-btn tr-primary" data-act="${st.testing ? 'stoptest' : 'test'}" ${st.src?.live ? '' : 'disabled'}>${st.testing ? 'Stop test' : 'Start live test'}</button>
      <span class="tr-spacer"></span><span class="tr-pred" aria-live="polite" data-pred>${st.probs ? esc(names[argmax(st.probs)]) : ''}</span></div>
    <ul class="tr-bars">${names.map((nm, i) => `<li data-bar="${i}"><span class="tr-bar-name">${esc(nm)}</span><span class="tr-bar"><span style="width:${pct(st.probs?.[i])}"></span></span><span class="tr-bar-pct">${pct(st.probs?.[i])}</span>
      <select data-action="${i}" aria-label="Action for ${esc(nm)}">${ACTIONS.map((a) => `<option value="${a.id}" ${acts[i] === a.id ? 'selected' : ''}>${a.label}</option>`).join('')}</select></li>`).join('')}</ul>
    <p class="tr-hint">The top class drives ${['led', 'relay', 'buzzer'].map((k) => `${byKind(k)} ${k === 'led' ? 'LED' : k}${byKind(k) === 1 ? '' : 's'}`).join(', ')} in the 3D scene when it's at least 60% confident.
      ${outs.length ? '' : '<button class="cd-btn" data-act="addouts">Add an LED, relay and buzzer to the circuit</button>'}</p>
    <div class="tr-wrong">${st.wrong ? `<p>What was it actually? Recording ${cam ? '5 frames' : '2 windows'} for:</p><div class="tr-row">${names.map((nm, i) => `<button class="cd-btn" data-fix="${st.result.classIds[i]}">${esc(nm)}</button>`).join('')}<button class="cd-btn tr-ghost" data-act="wrongcancel">Cancel</button></div>`
      : `<button class="cd-btn" data-act="wrong" ${st.src?.live ? '' : 'disabled'}>Wrong? Add samples</button>`}</div>

    <h3 class="tr-h3">Deploy</h3>
    <div class="tr-honest"><b>What's real and what's simulated</b><ul>
      <li><b>Real:</b> training, the confusion matrix and this live test (in your browser); int8 weight export; the zips; flashing over Web Serial with esptool-js.</li>
      <li><b>Simulated:</b> the LED, relay and buzzer above are the 3D sandbox parts, not your board.</li>
      <li><b>Not in the browser:</b> compiling C++. Flash the included <code>circuitdeck_ml</code> sketch once with the Arduino IDE. After that, “Compile & flash” turns your model into a CDM1 blob (int8) and writes it to the <code>cdmodel</code> partition at 0x${MODEL_ADDR.toString(16).toUpperCase()}. It isn't a TFLite Micro flatbuffer: the sketch has its own interpreter for these layers.</li>
      ${cam ? '<li><b>Camera models</b> need the 1.7 MB MobileNet extractor, so they run on the Pi 5 (Python zip). The ESP32 zip is for mic and motion models.</li>' : ''}</ul></div>
    ${serial ? `<div class="tr-flash"><label class="tr-field">Firmware .bin (optional, merged, flashed at 0x0) <input type="file" accept=".bin" data-firmware></label>
        <button class="cd-btn tr-primary" data-act="flash" ${cam || st.flashing ? 'disabled' : ''}>${st.flashing ? 'Flashing…' : 'Compile & flash'}</button>
        ${cam ? '<p class="tr-hint">Flashing is for mic and motion models (see above).</p>' : '<p class="tr-hint">Chrome or Edge on desktop: plug in the ESP32 or ESP32-S3 by USB, then pick its port.</p>'}
        <div class="tr-progress" data-flashbar hidden><span></span></div>
        ${st.flashLog ? `<pre class="tr-log" aria-live="polite">${esc(st.flashLog)}</pre>` : ''}</div>`
      : `<div class="tr-noserial" role="note"><b>No Web Serial here.</b> ${esc(whyNoSerial())} Flashing from the browser needs Chrome or Edge on a desktop. You can still download the project and flash it with the Arduino IDE, or run it on a Pi 5:</div>`}
    <div class="tr-row tr-dl"><button class="cd-btn" data-act="zip-esp32">Download ESP32 zip</button><button class="cd-btn" data-act="zip-pi">Download Pi 5 zip</button></div>
    <p class="tr-hint">ESP32 zip: Arduino sketch, <code>model_data.h</code> (your model as a C array), the CDM1 interpreter and partitions.csv. Pi 5 zip: <code>cd_infer.py</code>, numpy runtime and <code>model.json</code>.</p>`;
}
const argmax = (a) => a.reduce((b, v, i) => (v > a[b] ? i : b), 0);

// ---------------------------------------------------------------- events
async function onClick(e) {
  const b = e.target.closest('button'); if (!b || b.disabled) return;
  const d = b.dataset;
  try {
    if (d.act === 'close') return close();
    if (d.sensor) { if (d.sensor !== st.sensor) { await switchSensor(d.sensor); render(); } return; }
    if (d.tab) { if (st.tab === 'deploy' && d.tab !== 'deploy') stopTest(); st.tab = d.tab; st.notice = ''; render(); if (d.tab === 'train') drawChart(); return; }
    if (d.act === 'start') return startSource();
    if (d.record) return recordOnce(+d.record, b);
    if (d.delsample) { await db.deleteSample(+d.delsample); st.samples = st.samples.filter((x) => x.id !== +d.delsample); render(); return; }
    if (d.delclass) {
      const c = classes().find((x) => x.id === +d.delclass);
      if (!c || !confirm(`Delete the class “${c.name}” and its ${count(c.id)} samples?`)) return;
      await db.deleteClassSamples(st.sensor, c.id);
      st.meta.classes = classes().filter((x) => x.id !== c.id); await db.putMeta(st.meta);
      st.samples = st.samples.filter((x) => x.cls !== c.id); render(); return;
    }
    if (d.act === 'addclass') { const id = st.meta.nextClass++; st.meta.classes.push({ id, name: `Class ${id}` }); await db.putMeta(st.meta); render(); root.querySelector(`[data-rename="${id}"]`)?.select(); return; }
    if (d.act === 'clear') { if (!confirm(`Delete all ${st.sensor} samples, classes and the trained model?`)) return; await db.clearSensor(st.sensor); await switchSensor(st.sensor); render(); return; }
    if (d.act === 'train') return runTraining();
    if (d.act === 'stoptrain') { st.stop = true; return; }
    if (d.act === 'test') return startTest();
    if (d.act === 'stoptest') { stopTest(); render(); return; }
    if (d.act === 'addouts') { host.addOutputs(); render(); return; }
    if (d.act === 'wrong') { st.wrong = true; render(); return; }
    if (d.act === 'wrongcancel') { st.wrong = false; render(); return; }
    if (d.fix) return fixSamples(+d.fix);
    if (d.act === 'zip-esp32' || d.act === 'zip-pi') {
      const f = d.act === 'zip-esp32' ? esp32Zip : piZip;
      const out = await f(st.model, st.sensor, trainedNames(), actions());
      download(out.zip, out.name); st.notice = `Downloaded ${out.name}.`; render(); return;
    }
    if (d.act === 'flash') return doFlash();
  } catch (err) {
    console.warn(err); st.notice = err.message || String(err); render();
  }
}
async function onChange(e) {
  const t = e.target;
  if (t.dataset.rename) {
    const c = classes().find((x) => x.id === +t.dataset.rename);
    const name = t.value.trim().slice(0, 24);
    if (c && name) { c.name = name; await db.putMeta(st.meta); } else t.value = c?.name || '';
  } else if (t.dataset.epochs != null) st.epochsPick = +t.value;
  else if (t.dataset.action != null) { st.meta.actions ||= {}; st.meta.actions[st.result.classIds[+t.dataset.action]] = t.value; await db.putMeta(st.meta); applyOutputs(); }
  else if (t.dataset.firmware != null) st.firmware = t.files[0] ? new Uint8Array(await t.files[0].arrayBuffer()) : null;
}

async function startSource() {
  st.srcErr = '';
  try {
    st.src ||= makeSource(st.sensor);
    await st.src.start();
    if (st.sensor === 'camera') { st.busy++; render(); await M.loadMobilenet(); st.busy--; }
  } catch (err) {
    st.srcErr = err.name === 'NotAllowedError' ? 'Permission was denied. Allow it in the address bar, then try again.' : err.name === 'NotFoundError' ? `No ${st.sensor === 'camera' ? 'camera' : 'microphone'} found.` : err.message || String(err);
    st.src?.stop(); st.src = null;
  }
  render();
}

// ---------------------------------------------------------------- capture
async function capture(cls) {
  let data, thumb;
  if (st.sensor === 'camera') { const cv = st.src.snapshot(); data = await M.embed(cv); thumb = st.src.thumb(cv); }
  else { data = st.src.snapshot(); thumb = st.src.thumb(data); }
  return addSample(cls, data, thumb);
}
async function addSample(cls, data, thumb) {
  const s = { sensor: st.sensor, cls, data: Float32Array.from(data), thumb };
  s.id = await db.addSample(s); st.samples.push(s);
  const el = root.querySelector(`[data-count="${cls}"]`);
  if (el) { const n = count(cls); el.textContent = `${n} ${n === 1 ? 'sample' : 'samples'}`; }
  const strip = root.querySelector(`[data-cls="${cls}"] .tr-thumbs`);
  if (strip) strip.insertAdjacentHTML('beforeend', `<button class="tr-thumb" data-delsample="${s.id}" aria-label="Delete sample ${count(cls)}" title="Delete this sample"><img src="${thumb}" alt=""><span>${X}</span></button>`);
  return s;
}
async function waitWindow(btn) {
  const ms = WINDOW_MS[st.sensor]; if (!ms) return;
  const t0 = performance.now(), label = btn?.textContent;
  while (performance.now() - t0 < ms) { if (btn) btn.textContent = `Recording… ${((ms - (performance.now() - t0)) / 1000).toFixed(1)} s`; await sleep(100); }
  if (btn) btn.textContent = label;
}
async function recordOnce(cls, btn) {
  if (!st.src?.live) return;
  btn.disabled = true;
  try { await waitWindow(btn); await capture(cls); } finally { btn.disabled = false; }
}
let holding = false;
async function onHold(e) {
  const b = e.target.closest('button[data-hold]'); if (!b || b.disabled || !st.src?.live) return;
  e.preventDefault();
  holding = true; b.classList.add('is-recording');
  const up = () => { holding = false; };
  addEventListener('pointerup', up, { once: true }); addEventListener('pointercancel', up, { once: true });
  const cls = +b.dataset.hold;
  if (st.sensor !== 'camera' && !st.src.ready()) await waitWindow();
  do { await capture(cls); await sleep(HOLD_MS[st.sensor]); } while (holding); // a quick tap still records one
  b.classList.remove('is-recording');
}

// ---------------------------------------------------------------- training
async function runTraining({ auto = false } = {}) {
  if (st.training || canTrain()) return;
  stopTest();
  st.training = true; st.stop = false; st.epoch = null; st.history = [];
  st.epochsPlanned = st.epochsPick || (st.sensor === 'camera' ? 30 : 50);
  st.tab = 'train'; if (!auto) st.notice = ''; render();
  try {
    await M.loadTf();
    const ids = classes().map((c) => c.id);
    const out = await M.train(st.sensor, st.samples, ids, {
      epochs: st.epochsPlanned,
      onEpoch: (h) => { st.epoch = h; st.history.push(h); updateEpoch(); },
      shouldStop: () => st.stop,
    });
    st.model?.dispose?.();
    st.model = out.model;
    const correct = out.cm.reduce((s, row, i) => s + row[i], 0), total = out.cm.flat().reduce((a, b) => a + b, 0);
    st.result = { classIds: ids, cm: out.cm, history: st.history, nTrain: out.nTrain, nVal: out.nVal, evalOn: out.evalOn, accuracy: total ? correct / total : 0, nSamples: st.samples.length, at: Date.now() };
    st.meta.trained = st.result; await db.putMeta(st.meta);
    await M.save(st.model, st.sensor).catch((err) => console.warn('model not saved', err));
  } finally {
    st.training = false; render(); drawChart();
  }
  return st.result;
}
function updateEpoch() {
  const e = st.epoch, total = st.epochsPlanned;
  const p = root.querySelector('.tr-progress'); if (p) { p.setAttribute('aria-valuenow', e.epoch); p.firstElementChild.style.width = `${(e.epoch / total) * 100}%`; }
  const t = root.querySelector('.tr-epoch'); if (t) t.textContent = `Epoch ${e.epoch}/${total} · loss ${e.loss.toFixed(3)} · acc ${pct(e.acc)}${e.valAcc != null ? ` · val loss ${e.valLoss.toFixed(3)} · val acc ${pct(e.valAcc)}` : ''}`;
  drawChart();
}
function drawChart() {
  const cv = root.querySelector('.tr-chart'); const h = st.training ? st.history : st.result?.history;
  if (!cv || !h?.length) return;
  const g = cv.getContext('2d'), W = cv.width, H = cv.height, n = Math.max(h.length, st.training ? st.epochsPlanned : h.length);
  const cs = getComputedStyle(document.documentElement);
  g.clearRect(0, 0, W, H); g.fillStyle = cs.getPropertyValue('--code-bg').trim() || '#131a23'; g.fillRect(0, 0, W, H);
  const maxLoss = Math.max(0.5, ...h.map((x) => Math.max(x.loss, x.valLoss ?? 0)));
  const line = (key, color, scale, dash) => {
    g.strokeStyle = color; g.setLineDash(dash || []); g.lineWidth = 1.8; g.beginPath(); let started = false;
    h.forEach((x, i) => { const v = x[key]; if (v == null) return; const px = 8 + (i / Math.max(1, n - 1)) * (W - 16), py = H - 8 - (v / scale) * (H - 24); started ? g.lineTo(px, py) : g.moveTo(px, py); started = true; });
    g.stroke(); g.setLineDash([]);
  };
  line('acc', '#35c19f', 1); line('valAcc', '#35c19f', 1, [4, 3]); line('loss', '#f8772e', maxLoss); line('valLoss', '#f8772e', maxLoss, [4, 3]);
  g.font = '11px system-ui, sans-serif'; g.fillStyle = '#35c19f'; g.fillText('accuracy', 8, 12); g.fillStyle = '#f8772e'; g.fillText('loss', 70, 12);
  g.fillStyle = '#99a2ad'; g.fillText('dashed = validation', 104, 12);
}

// ---------------------------------------------------------------- live test
async function startTest() {
  if (!st.model || !st.src?.live || st.testing) return;
  host.stopSim();
  st.testing = true; render();
  const model = st.model;
  while (st.testing && st.model === model) {
    const x = st.sensor === 'camera' ? await M.embed(st.src.snapshot()) : st.src.snapshot();
    if (!st.testing) break;
    st.probs = await M.predict(model, st.sensor, x);
    updateBars(); applyOutputs();
    await sleep(st.sensor === 'camera' ? 100 : 200);
  }
}
function stopTest() {
  if (!st?.testing) return;
  st.testing = false; st.probs = null;
  host?.setOutputs?.({ led: false, relay: false, buzzer: false });
}
function updateBars() {
  const names = trainedNames();
  st.probs.forEach((v, i) => {
    const li = root.querySelector(`[data-bar="${i}"]`); if (!li) return;
    li.querySelector('.tr-bar > span').style.width = pct(v); li.querySelector('.tr-bar-pct').textContent = pct(v);
    li.classList.toggle('is-top', i === argmax(st.probs));
  });
  const p = root.querySelector('[data-pred]'); if (p) p.textContent = names[argmax(st.probs)] || '';
}
function applyOutputs() {
  if (!st.testing || !st.probs) return;
  const best = argmax(st.probs), act = st.probs[best] >= 0.6 ? actions()[best] : 'none';
  host.setOutputs({ led: act === 'led', relay: act === 'relay', buzzer: act === 'buzzer' });
  st.lastAction = act;
}
async function fixSamples(cls) {
  const wasTesting = st.testing; stopTest();
  const n = st.sensor === 'camera' ? 5 : 2;
  for (let i = 0; i < n; i++) {
    if (st.sensor !== 'camera') await waitWindow();
    await capture(cls);
    if (st.sensor === 'camera') await sleep(150);
  }
  st.wrong = false;
  const name = classes().find((c) => c.id === cls)?.name;
  st.notice = `Added ${n} samples to “${name}”. Retraining…`;
  void wasTesting;
  return runTraining({ auto: true });
}

// ---------------------------------------------------------------- flash
async function doFlash() {
  const { blob } = (await import('./model.js')).exportBlob(st.model, st.sensor, trainedNames(), actions());
  st.flashing = true; st.flashLog = `Model blob: ${blob.length} bytes (CDM1, int8 weights) → 0x${MODEL_ADDR.toString(16)}\n`; render();
  const bar = () => root.querySelector('[data-flashbar]');
  try {
    const chip = await flash({ blob, firmware: st.firmware, log: (s) => { st.flashLog += `${s}\n`; const pre = root.querySelector('.tr-log'); if (pre) pre.textContent = st.flashLog; },
      progress: (f) => { const b = bar(); if (b) { b.hidden = false; b.firstElementChild.style.width = pct(f); } } });
    st.flashLog += `Done: flashed to ${chip}. Open a serial monitor at 115200 baud to see predictions.\n`;
  } catch (err) {
    st.flashLog += `✗ ${err.message || err}\n`;
  } finally { st.flashing = false; render(); }
}

// ---------------------------------------------------------------- test hooks
const api = {
  get state() { return st; }, open, close, isOpen,
  async addSample(classIndex, data, thumb) { const c = classes()[classIndex]; const src = makeSource(st.sensor); return addSample(c.id, data, thumb || src.thumb(data)); },
  async addImage(classIndex, canvas) { const c = classes()[classIndex]; const data = await M.embed(canvas); const t = document.createElement('canvas'); t.width = t.height = 56; t.getContext('2d').drawImage(canvas, 0, 0, 56, 56); return addSample(c.id, data, t.toDataURL('image/jpeg', 0.7)); },
  train: (opts = {}) => { if (opts.epochs) st.epochsPick = opts.epochs; return runTraining(); },
  predict: (data) => M.predict(st.model, st.sensor, data),
  async zip(kind) { const out = await (kind === 'esp32' ? esp32Zip : piZip)(st.model, st.sensor, trainedNames(), actions()); return new Uint8Array(await out.zip.arrayBuffer()); },
  exportJSON: () => M.exportJSON(st.model, st.sensor, trainedNames(), actions()),
  exportBlob: () => M.exportBlob(st.model, st.sensor, trainedNames(), actions()).blob,
  get lastAction() { return st.lastAction; },
  render: () => render(),
};
window.__train = api;
