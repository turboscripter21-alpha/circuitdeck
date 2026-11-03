// M10: live sensor sources for the Train panel. Each exposes start() (call from a click
// so permission prompts are allowed), stop(), draw(canvas), snapshot() and thumb(sample).
import { IMG, MIC, MOTION, bandEdges } from './spec.js';

const css = (v, fb) => getComputedStyle(document.documentElement).getPropertyValue(v).trim() || fb;

// ---------------------------------------------------------------- camera
export function cameraSource() {
  const video = document.createElement('video');
  video.muted = true; video.playsInline = true; video.setAttribute('playsinline', '');
  const crop = document.createElement('canvas'); crop.width = crop.height = IMG;
  let stream = null;
  return {
    kind: 'camera', video, get live() { return !!stream; },
    async start() {
      if (stream) return;
      stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }, audio: false });
      video.srcObject = stream;
      await video.play().catch(() => {});
      await new Promise((r) => (video.readyState >= 2 ? r() : video.addEventListener('loadeddata', r, { once: true })));
    },
    stop() { stream?.getTracks().forEach((t) => t.stop()); stream = null; video.srcObject = null; },
    // centre square crop at 224×224 (what MobileNet sees)
    snapshot() {
      const w = video.videoWidth || IMG, h = video.videoHeight || IMG, s = Math.min(w, h);
      const g = crop.getContext('2d', { willReadFrequently: true });
      g.drawImage(video, (w - s) / 2, (h - s) / 2, s, s, 0, 0, IMG, IMG);
      return crop;
    },
    thumb(canvas = crop) { const t = document.createElement('canvas'); t.width = t.height = 56; t.getContext('2d').drawImage(canvas, 0, 0, 56, 56); return t.toDataURL('image/jpeg', 0.7); },
    draw() {},
  };
}

// ---------------------------------------------------------------- microphone
export function micSource() {
  let stream = null, ac = null, an = null, timer = 0, freq = null, wave = null;
  const edges = bandEdges();
  const ring = [];                       // last MIC.frames frames of MIC.bands values (0..1)
  function frame() {
    an.getFloatFrequencyData(freq);
    const binHz = ac.sampleRate / an.fftSize;
    const row = new Float32Array(MIC.bands);
    for (let b = 0; b < MIC.bands; b++) {
      const lo = Math.max(1, Math.floor(edges[b] / binHz)), hi = Math.max(lo + 1, Math.ceil(edges[b + 1] / binHz));
      let s = 0, n = 0;
      for (let k = lo; k < hi && k < freq.length; k++) { const v = freq[k]; s += Number.isFinite(v) ? v : MIC.dbMin; n++; }
      const db = n ? s / n : MIC.dbMin;
      row[b] = Math.min(1, Math.max(0, (db - MIC.dbMin) / (MIC.dbMax - MIC.dbMin)));
    }
    ring.push(row); if (ring.length > MIC.frames) ring.shift();
  }
  return {
    kind: 'mic', get live() { return !!stream; }, ring,
    async start() {
      if (stream) return;
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: false });
      ac = new AudioContext();
      await ac.resume().catch(() => {});
      an = ac.createAnalyser(); an.fftSize = 2048; an.smoothingTimeConstant = 0;
      ac.createMediaStreamSource(stream).connect(an);
      freq = new Float32Array(an.frequencyBinCount); wave = new Float32Array(an.fftSize);
      timer = setInterval(frame, MIC.hopMs);
    },
    stop() { clearInterval(timer); stream?.getTracks().forEach((t) => t.stop()); stream = null; ac?.close().catch(() => {}); ac = null; ring.length = 0; },
    ready() { return ring.length >= MIC.frames; },
    snapshot() {
      const out = new Float32Array(MIC.frames * MIC.bands);
      const pad = MIC.frames - ring.length;
      ring.forEach((r, i) => out.set(r, (i + pad) * MIC.bands));
      return out;
    },
    draw(cv) {
      const g = cv.getContext('2d'), W = cv.width, H = cv.height, top = Math.round(H * 0.32);
      g.fillStyle = css('--code-bg', '#131a23'); g.fillRect(0, 0, W, H);
      if (an) {
        an.getFloatTimeDomainData(wave);
        g.strokeStyle = css('--green', '#35c19f'); g.lineWidth = 1.5; g.beginPath();
        for (let x = 0; x < W; x++) { const v = wave[Math.floor((x / W) * wave.length)] || 0; const y = top / 2 - v * top * 0.9; x ? g.lineTo(x, y) : g.moveTo(x, y); }
        g.stroke();
      }
      paintSpec(g, this.snapshot(), 0, top + 2, W, H - top - 2);
    },
    thumb(data) { const t = document.createElement('canvas'); t.width = 56; t.height = 56; paintSpec(t.getContext('2d'), data, 0, 0, 56, 56); return t.toDataURL('image/png'); },
  };
}
function heat(v) { // dark → orange → yellow
  const r = Math.round(30 + 225 * Math.min(1, v * 1.6)), gg = Math.round(25 + 200 * Math.max(0, v - 0.45) * 1.8), b = Math.round(50 * (1 - v));
  return `rgb(${r},${Math.min(255, gg)},${b})`;
}
function paintSpec(g, data, x0, y0, W, H) {
  const cw = W / MIC.frames, ch = H / MIC.bands;
  for (let f = 0; f < MIC.frames; f++) for (let b = 0; b < MIC.bands; b++) {
    g.fillStyle = heat(data[f * MIC.bands + b]);
    g.fillRect(x0 + f * cw, y0 + H - (b + 1) * ch, Math.ceil(cw), Math.ceil(ch));
  }
}

// ---------------------------------------------------------------- motion
export function motionSource() {
  const ring = [];
  let latest = [0, 0, 0, 0, 0, 0], timer = 0, on = false, events = 0, simulated = false;
  const onMotion = (e) => {
    const a = e.accelerationIncludingGravity || e.acceleration || {}, r = e.rotationRate || {};
    latest = [(a.x || 0) / MOTION.gScale, (a.y || 0) / MOTION.gScale, (a.z || 0) / MOTION.gScale, (r.alpha || 0) / MOTION.rScale, (r.beta || 0) / MOTION.rScale, (r.gamma || 0) / MOTION.rScale];
    events++;
  };
  const tick = () => { ring.push(Float32Array.from(latest)); if (ring.length > MOTION.steps) ring.shift(); };
  return {
    kind: 'motion', ring, get live() { return on; }, get events() { return events; }, get simulated() { return simulated; },
    async start() {
      if (on) return;
      // iOS 13+: permission must be requested from a click
      if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
        const p = await DeviceMotionEvent.requestPermission().catch(() => 'denied');
        // phones/tablets need it; a desktop without sensors falls back to the pointer stand-in
        if (p !== 'granted' && navigator.maxTouchPoints > 0) throw new Error('Motion permission was denied. Allow motion access for this site, then try again.');
      }
      addEventListener('devicemotion', onMotion);
      timer = setInterval(tick, 1000 / MOTION.hz); on = true;
    },
    stop() { removeEventListener('devicemotion', onMotion); clearInterval(timer); on = false; ring.length = 0; },
    // desktop stand-in: pointer position over the preview acts like tilt (clearly labelled)
    simulate(nx, ny, speed) { simulated = true; latest = [nx, ny, Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny)), speed * 0.6, ny * 0.3, nx * 0.3]; },
    ready() { return ring.length >= MOTION.steps; },
    snapshot() {
      const out = new Float32Array(MOTION.steps * MOTION.ch);
      const pad = MOTION.steps - ring.length;
      ring.forEach((r, i) => out.set(r, (i + pad) * MOTION.ch));
      return out;
    },
    draw(cv) { paintAxes(cv.getContext('2d'), this.snapshot(), cv.width, cv.height, true); },
    thumb(data) { const t = document.createElement('canvas'); t.width = 56; t.height = 56; paintAxes(t.getContext('2d'), data, 56, 56, false); return t.toDataURL('image/png'); },
  };
}
const AXES = [['ax', '#f8772e'], ['ay', '#35c19f'], ['az', '#82b2ff'], ['α', '#e05a8a'], ['β', '#d6b13a'], ['γ', '#9a7cf0']];
function paintAxes(g, data, W, H, legend) {
  g.fillStyle = css('--code-bg', '#131a23'); g.fillRect(0, 0, W, H);
  g.strokeStyle = '#ffffff22'; g.beginPath(); g.moveTo(0, H / 2); g.lineTo(W, H / 2); g.stroke();
  for (let c = 0; c < MOTION.ch; c++) {
    g.strokeStyle = AXES[c][1]; g.lineWidth = legend ? 1.6 : 1; g.beginPath();
    for (let s = 0; s < MOTION.steps; s++) {
      const v = Math.max(-1.5, Math.min(1.5, data[s * MOTION.ch + c]));
      const x = (s / (MOTION.steps - 1)) * W, y = H / 2 - (v / 1.5) * (H / 2 - 3);
      s ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.stroke();
  }
  if (legend) { g.font = '11px system-ui, sans-serif'; AXES.forEach(([n, c], i) => { g.fillStyle = c; g.fillText(n, 6 + i * 26, 13); }); }
}
export function makeSource(kind) { return kind === 'camera' ? cameraSource() : kind === 'mic' ? micSource() : motionSource(); }
