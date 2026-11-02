// M10: TensorFlow.js in the browser (vendored). Camera = frozen MobileNet V2 0.35 features
// + dense head; mic = small 2D CNN on the spectrogram; motion = small 1D-conv net.
import { IMG, EMBED, inputShape, SENSOR_CODE, ACTIONS } from './spec.js';
import { crc32 } from './zip.js';

let tf = null, mobilenet = null;
export async function loadTf() {
  if (tf) return tf;
  tf = await import('/vendor/tfjs/tf.fesm.min.js');
  try { if (!(await tf.setBackend('webgl'))) throw new Error('no webgl'); } catch { await tf.setBackend('cpu'); }
  await tf.ready();
  return tf;
}
export const backend = () => tf?.getBackend() || '';

export async function loadMobilenet() {
  await loadTf();
  if (mobilenet) return mobilenet;
  const full = await tf.loadLayersModel('/vendor/mobilenet-v2/model.json');
  const out = full.getLayer('out_relu').output;
  mobilenet = tf.model({ inputs: full.inputs, outputs: out });
  tf.tidy(() => mobilenet.predict(tf.zeros([1, IMG, IMG, 3])));   // warm up
  return mobilenet;
}
// one 224×224 canvas → 1280 pooled features (pixel scaling matches Keras' preprocess_input: [-1, 1])
export async function embed(canvas) {
  const m = await loadMobilenet();
  const t = tf.tidy(() => {
    const x = tf.browser.fromPixels(canvas).toFloat().div(127.5).sub(1).expandDims(0);
    return m.predict(x).mean([1, 2]).reshape([EMBED]);
  });
  const d = await t.data(); t.dispose();
  return Float32Array.from(d);
}

export function build(sensor, n) {
  const L = tf.layers, m = tf.sequential();
  if (sensor === 'camera') {
    m.add(L.dense({ inputShape: [EMBED], units: 64, activation: 'relu', name: 'h1' }));
    m.add(L.dropout({ rate: 0.3 }));
    m.add(L.dense({ units: n, activation: 'softmax', name: 'out' }));
  } else if (sensor === 'mic') {
    m.add(L.conv2d({ inputShape: inputShape('mic'), filters: 8, kernelSize: 3, activation: 'relu', name: 'c1' }));
    m.add(L.maxPooling2d({ poolSize: 2, strides: 2 }));
    m.add(L.conv2d({ filters: 16, kernelSize: 3, activation: 'relu', name: 'c2' }));
    m.add(L.maxPooling2d({ poolSize: 2, strides: 2 }));
    m.add(L.flatten());
    m.add(L.dropout({ rate: 0.25 }));
    m.add(L.dense({ units: n, activation: 'softmax', name: 'out' }));
  } else {
    m.add(L.conv1d({ inputShape: inputShape('motion'), filters: 16, kernelSize: 5, activation: 'relu', name: 'c1' }));
    m.add(L.maxPooling1d({ poolSize: 2, strides: 2 }));
    m.add(L.flatten());
    m.add(L.dense({ units: 24, activation: 'relu', name: 'h1' }));
    m.add(L.dense({ units: n, activation: 'softmax', name: 'out' }));
  }
  m.compile({ optimizer: tf.train.adam(sensor === 'camera' ? 0.001 : 0.003), loss: 'categoricalCrossentropy', metrics: ['accuracy'] });
  return m;
}

// stratified split: ~valFrac of each class (at least 1 when a class has ≥ 3 samples)
export function split(samples, classIds, valFrac = 0.2, seed = 7) {
  let s = seed; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const train = [], val = [];
  for (const c of classIds) {
    const mine = samples.filter((x) => x.cls === c).map((x) => [rnd(), x]).sort((a, b) => a[0] - b[0]).map((p) => p[1]);
    const k = mine.length >= 3 ? Math.max(1, Math.round(mine.length * valFrac)) : 0;
    val.push(...mine.slice(0, k)); train.push(...mine.slice(k));
  }
  return { train, val };
}
function tensors(sensor, list, classIds) {
  const shape = inputShape(sensor), size = shape.reduce((a, b) => a * b, 1);
  const buf = new Float32Array(list.length * size);
  list.forEach((x, i) => buf.set(x.data, i * size));
  const xs = tf.tensor(buf, [list.length, ...shape]);
  const ys = tf.oneHot(tf.tensor1d(list.map((x) => classIds.indexOf(x.cls)), 'int32'), classIds.length).toFloat();
  return { xs, ys };
}

// train with per-epoch callbacks; yields to the page between batches so the UI stays live
export async function train(sensor, samples, classIds, { epochs = 30, batchSize = 16, onEpoch, shouldStop } = {}) {
  await loadTf();
  const { train: tr, val } = split(samples, classIds);
  const model = build(sensor, classIds.length);
  const a = tensors(sensor, tr, classIds);
  const v = val.length ? tensors(sensor, val, classIds) : null;
  const history = [];
  try {
    await model.fit(a.xs, a.ys, {
      epochs, batchSize, shuffle: true, validationData: v ? [v.xs, v.ys] : undefined,
      callbacks: {
        onBatchEnd: async () => { await tf.nextFrame(); },
        onEpochEnd: async (epoch, logs) => {
          const h = { epoch: epoch + 1, loss: logs.loss, acc: logs.acc ?? logs.accuracy, valLoss: logs.val_loss, valAcc: logs.val_acc ?? logs.val_accuracy };
          history.push(h); onEpoch?.(h);
          if (shouldStop?.()) model.stopTraining = true;
          await tf.nextFrame();
        },
      },
    });
    const evalSet = val.length ? val : tr;
    const cm = await confusion(model, sensor, evalSet, classIds);
    return { model, history, cm, nTrain: tr.length, nVal: val.length, evalOn: val.length ? 'validation' : 'training' };
  } finally {
    a.xs.dispose(); a.ys.dispose(); v?.xs.dispose(); v?.ys.dispose();
  }
}
export async function confusion(model, sensor, list, classIds) {
  const n = classIds.length, m = Array.from({ length: n }, () => new Array(n).fill(0));
  if (!list.length) return m;
  const { xs } = tensors(sensor, list, classIds);
  const p = model.predict(xs); const am = p.argMax(-1); const pred = await am.data();
  xs.dispose(); p.dispose(); am.dispose();
  list.forEach((x, i) => { m[classIds.indexOf(x.cls)][pred[i]]++; });
  return m;
}
export async function predict(model, sensor, data) {
  const t = tf.tidy(() => model.predict(tf.tensor(data, [1, ...inputShape(sensor)])));
  const d = await t.data(); t.dispose();
  return Array.from(d);
}
export async function save(model, sensor) { await model.save(`indexeddb://circuitdeck-train-${sensor}`); }
export async function restore(sensor) {
  await loadTf();
  try { return await tf.loadLayersModel(`indexeddb://circuitdeck-train-${sensor}`); } catch { return null; }
}

// ---------------------------------------------------------------- export
// The CircuitDeck model format ("CDM1"): the same layer list as JSON (float32, for the
// Pi 5 / numpy) and as a compact binary blob (int8 weights + float32 biases, for the ESP32).
const LT = { Dense: 1, Conv1D: 2, Conv2D: 3, MaxPooling1D: 4, MaxPooling2D: 5, Flatten: 6 };
const ACT = { linear: 0, relu: 1, softmax: 2 };
function layerList(model) {
  const out = [];
  for (const l of model.layers) {
    const cls = l.getClassName(), cfg = l.getConfig();
    if (cls === 'Dropout' || cls === 'InputLayer') continue;
    if (!LT[cls]) throw new Error(`Layer ${cls} is not supported by the exporter`);
    const w = l.getWeights();
    const one = (v) => (Array.isArray(v) ? v : [v, v]);
    const e = { type: cls, act: cfg.activation || 'linear' };
    if (cls === 'Dense') e.units = cfg.units;
    if (cls === 'Conv1D') { e.filters = cfg.filters; e.kernel = one(cfg.kernelSize)[0]; e.stride = one(cfg.strides)[0]; }
    if (cls === 'Conv2D') { e.filters = cfg.filters; e.kernel = one(cfg.kernelSize); e.stride = one(cfg.strides); }
    if (cls === 'MaxPooling1D') { e.pool = one(cfg.poolSize)[0]; e.stride = one(cfg.strides ?? cfg.poolSize)[0]; }
    if (cls === 'MaxPooling2D') { e.pool = one(cfg.poolSize); e.stride = one(cfg.strides ?? cfg.poolSize); }
    if (w.length) { e.wShape = w[0].shape; e.w = w[0].dataSync().slice(); e.b = w[1].dataSync().slice(); }
    out.push(e);
  }
  return out;
}
const b64 = (f32) => { const u = new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };

export function exportJSON(model, sensor, classes, actions = []) {
  return {
    format: 'circuitdeck-model', version: 1, sensor, classes, actions,
    input: inputShape(sensor), features: sensor === 'camera' ? 'mobilenet_v2_0.35_224 global-average-pooled (Keras preprocess_input scaling)' : sensor,
    layers: layerList(model).map(({ w, b, ...rest }) => (w ? { ...rest, w: b64(w), b: b64(b) } : rest)),
  };
}
export function exportBlob(model, sensor, classes, actions = []) {
  const layers = layerList(model); const enc = new TextEncoder(); const bytes = [];
  const u8 = (v) => bytes.push(v & 255); const u16 = (v) => { u8(v); u8(v >> 8); }; const u32 = (v) => { u16(v & 0xffff); u16(v >>> 16); };
  const f32 = (v) => { const b = new Uint8Array(new Float32Array([v]).buffer); bytes.push(...b); };
  const shape = inputShape(sensor);
  u8(1); u8(SENSOR_CODE[sensor]); u8(classes.length); u8(shape.length);
  for (let i = 0; i < 3; i++) u16(shape[i] || 1);
  classes.forEach((c, i) => { const b = enc.encode(c).slice(0, 31); u8(b.length); bytes.push(...b); u8(Math.max(0, ACTIONS.findIndex((a) => a.id === actions[i]))); });
  u8(layers.length);
  let quantErr = 0;
  for (const l of layers) {
    u8(LT[l.type]); u8(ACT[l.act] ?? 0);
    const p = l.type === 'Dense' ? [l.units, 0, 0, 0] : l.type === 'Conv1D' ? [l.filters, l.kernel, l.stride, 0] : l.type === 'Conv2D' ? [l.filters, l.kernel[0], l.kernel[1], l.stride[0]]
      : l.type === 'MaxPooling1D' ? [l.pool, l.stride, 0, 0] : l.type === 'MaxPooling2D' ? [l.pool[0], l.pool[1], l.stride[0], l.stride[1]] : [0, 0, 0, 0];
    p.forEach(u16);
    if (l.w) {
      let max = 0; for (const v of l.w) max = Math.max(max, Math.abs(v));
      const scale = max / 127 || 1;
      u32(l.w.length); f32(scale);
      for (const v of l.w) { const q = Math.max(-127, Math.min(127, Math.round(v / scale))); quantErr = Math.max(quantErr, Math.abs(q * scale - v)); u8(q); }
      u32(l.b.length); for (const v of l.b) f32(v);
    } else { u32(0); }
  }
  const payload = Uint8Array.from(bytes);
  const out = new Uint8Array(12 + payload.length);
  out.set(enc.encode('CDM1'), 0);
  const dv = new DataView(out.buffer); dv.setUint32(4, payload.length, true); dv.setUint32(8, crc32(payload), true);
  out.set(payload, 12);
  return { blob: out, quantErr };
}
export function blobToHeader(blob, name = 'cd_model') {
  const rows = [];
  for (let i = 0; i < blob.length; i += 16) rows.push('  ' + Array.from(blob.subarray(i, i + 16), (b) => `0x${b.toString(16).padStart(2, '0')}`).join(', '));
  return `// Generated by the CircuitDeck Train panel: ${new Date().toISOString()}
// The CDM1 model blob (int8 weights, float32 biases). The sketch uses this copy when
// the "cdmodel" flash partition is empty, so the browser's "Compile & flash" can overwrite the model later.
#pragma once
#include <stdint.h>
alignas(4) const uint8_t ${name}[] = {
${rows.join(',\n')}
};
const unsigned int ${name}_len = ${blob.length};
`;
}
