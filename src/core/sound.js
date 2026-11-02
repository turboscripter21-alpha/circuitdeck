// CircuitDeck sound effects, synthesised with the Web Audio API (no audio files).
// Muted/unmuted state lives in localStorage `circuitdeck:sound` ('1' / '0', default on)
// and is shared with the speaker toggle in shared/chrome.js through the `cd-sound` event.
// Browsers only allow audio after a user gesture, so nothing is created until the
// first pointerdown/keydown on the page.
const KEY = 'circuitdeck:sound';
const hasWin = typeof window !== 'undefined';
let enabled = true;
try { enabled = localStorage.getItem(KEY) !== '0'; } catch {}
let unlocked = false, ac = null, master = null, noiseBuf = null;
const voices = new Map(); // continuous sounds: key -> { stop(), ... }
const lastAt = new Map();

function ctx() {
  if (!enabled || !unlocked || !hasWin) return null;
  if (!ac) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { ac = new AC(); } catch { return null; }
    master = ac.createGain(); master.gain.value = 0.55; master.connect(ac.destination);
  }
  if (ac.state === 'suspended') ac.resume().catch(() => {});
  return ac;
}
function noise() {
  if (!noiseBuf) {
    noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const s = ac.createBufferSource(); s.buffer = noiseBuf; return s;
}
function env(g, t0, vol, attack, decay) {
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
}
// a short one-shot tone
export function tone(freq, dur = 0.12, { type = 'sine', vol = 0.06, delay = 0, slide = 0 } = {}) {
  const a = ctx(); if (!a) return;
  const t0 = a.currentTime + delay;
  const o = a.createOscillator(), g = a.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t0);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t0 + dur);
  env(g, t0, vol, 0.006, dur);
  o.connect(g).connect(master); o.start(t0); o.stop(t0 + dur + 0.05);
}
// a filtered noise burst (clicks, shutters, contacts)
function burst(dur, { freq = 2000, q = 1, vol = 0.08, delay = 0, type = 'bandpass' } = {}) {
  const a = ctx(); if (!a) return;
  const t0 = a.currentTime + delay;
  const s = noise(), f = a.createBiquadFilter(), g = a.createGain();
  f.type = type; f.frequency.value = freq; f.Q.value = q;
  env(g, t0, vol, 0.002, dur);
  s.connect(f).connect(g).connect(master); s.start(t0, Math.random() * 0.5); s.stop(t0 + dur + 0.05);
}
const throttle = (key, ms) => { const now = performance.now(); if (now - (lastAt.get(key) || 0) < ms) return false; lastAt.set(key, now); return true; };

export const sfx = {
  press() { burst(0.025, { freq: 3800, q: 2, vol: 0.07 }); tone(1700, 0.02, { type: 'square', vol: 0.012 }); },
  release() { burst(0.02, { freq: 3000, q: 2, vol: 0.035 }); },
  key() { burst(0.02, { freq: 3200, q: 2, vol: 0.06 }); tone(1320, 0.07, { type: 'square', vol: 0.02 }); },
  relay(on) { burst(0.03, { freq: on ? 1400 : 1100, q: 1.5, vol: 0.12 }); burst(0.02, { freq: 2600, q: 3, vol: 0.06, delay: 0.012 }); },
  shutter() { burst(0.04, { freq: 2400, q: 1, vol: 0.12 }); burst(0.07, { freq: 1500, q: 0.8, vol: 0.09, delay: 0.09 }); },
  accept() { tone(1046, 0.1, { type: 'square', vol: 0.025 }); tone(1568, 0.16, { type: 'square', vol: 0.025, delay: 0.12 }); },
  deny() { tone(300, 0.22, { type: 'sawtooth', vol: 0.03 }); tone(220, 0.3, { type: 'sawtooth', vol: 0.03, delay: 0.25 }); },
  step(key = 'step') { if (throttle(key, 45)) burst(0.012, { freq: 5200, q: 4, vol: 0.045 }); },
  servo(key, ms) {
    const a = ctx(); if (!a) return;
    const v = voices.get(key);
    const end = a.currentTime + Math.min(0.7, Math.max(0.06, ms / 1000));
    if (v?.kind === 'servo') { v.g.gain.cancelScheduledValues(a.currentTime); v.g.gain.setTargetAtTime(0.022, a.currentTime, 0.01); v.g.gain.setTargetAtTime(0.0001, end, 0.02); v.until = end; return; }
    const o = a.createOscillator(), lfo = a.createOscillator(), lg = a.createGain(), f = a.createBiquadFilter(), g = a.createGain();
    o.type = 'sawtooth'; o.frequency.value = 210; lfo.frequency.value = 23; lg.gain.value = 18;
    lfo.connect(lg).connect(o.frequency);
    f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 1.2;
    g.gain.value = 0.0001; g.gain.setTargetAtTime(0.022, a.currentTime, 0.01); g.gain.setTargetAtTime(0.0001, end, 0.02);
    o.connect(f).connect(g).connect(master); o.start(); lfo.start();
    const voice = { kind: 'servo', g, until: end, stop() { try { o.stop(); lfo.stop(); } catch {} } };
    voices.set(key, voice);
    const reap = () => { if (voices.get(key) !== voice) return; if (a.currentTime > voice.until + 0.2) { voice.stop(); voices.delete(key); } else setTimeout(reap, 250); };
    setTimeout(reap, 400);
  },
  // continuous: buzzer tone (on/off + frequency)
  buzz(key, on, freq = 2300) {
    const v = voices.get(key);
    if (!on) { if (v) { v.stop(); voices.delete(key); } return; }
    const a = ctx(); if (!a) return;
    if (v) { v.o.frequency.setTargetAtTime(freq, a.currentTime, 0.005); return; }
    const o = a.createOscillator(), f = a.createBiquadFilter(), g = a.createGain();
    o.type = 'square'; o.frequency.value = freq; f.type = 'lowpass'; f.frequency.value = 4200;
    g.gain.value = 0.0001; g.gain.setTargetAtTime(0.028, a.currentTime, 0.004);
    o.connect(f).connect(g).connect(master); o.start();
    voices.set(key, { o, stop() { g.gain.setTargetAtTime(0.0001, a.currentTime, 0.006); o.stop(a.currentTime + 0.06); } });
  },
  // continuous: motor hum, pitch and level follow |speed| (0..1)
  hum(key, speed, { base = 70, span = 150, vol = 0.03, fan = false } = {}) {
    const v = voices.get(key), s = Math.min(1, Math.abs(speed || 0));
    if (s < 0.02) { if (v) { v.stop(); voices.delete(key); } return; }
    const a = ctx(); if (!a) return;
    const level = vol * (0.35 + 0.65 * s);
    if (v) { v.o.frequency.setTargetAtTime(base + span * s, a.currentTime, 0.15); v.g.gain.setTargetAtTime(level, a.currentTime, 0.15); if (v.f) v.f.frequency.setTargetAtTime(400 + 1400 * s, a.currentTime, 0.2); return; }
    const g = a.createGain(); g.gain.value = 0.0001; g.gain.setTargetAtTime(level, a.currentTime, 0.15); g.connect(master);
    const o = a.createOscillator(); o.type = fan ? 'triangle' : 'sawtooth'; o.frequency.value = base + span * s;
    const lp = a.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = fan ? 300 : 700;
    o.connect(lp).connect(g); o.start();
    let n = null, f = null;
    if (fan) { n = noise(); n.loop = true; f = a.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 400 + 1400 * s; f.Q.value = 0.7; const ng = a.createGain(); ng.gain.value = 0.9; n.connect(f).connect(ng).connect(g); n.start(); }
    voices.set(key, { o, g, f, stop() { g.gain.setTargetAtTime(0.0001, a.currentTime, 0.08); o.stop(a.currentTime + 0.4); n?.stop(a.currentTime + 0.4); } });
  },
  stopAll() { for (const v of voices.values()) v.stop(); voices.clear(); },
};

// Map a part's state change to the sound that part would make.
let uid = 0;
export function react(inst, prev, next) {
  if (!enabled || !unlocked) return;
  const key = (inst.__sid ??= `p${++uid}`);
  switch (inst.type) {
    case 'buzzer':
      if (!!next.on !== !!prev.on || (next.on && next.freq !== prev.freq)) sfx.buzz(key, !!next.on, next.freq || 2300);
      break;
    case 'button':
      if (!!next.pressed !== !!prev.pressed) (next.pressed ? sfx.press() : sfx.release());
      break;
    case 'relay':
      if (!!next.on !== !!prev.on) sfx.relay(!!next.on);
      break;
    case 'servo': {
      const d = Math.abs((next.angle ?? 0) - (prev.angle ?? 0));
      if (d > 0.5) sfx.servo(key, 60 + d * 5);
      break;
    }
    case 'motor':
      if ((next.speed ?? 0) !== (prev.speed ?? 0)) sfx.hum(key, next.speed ?? 0);
      break;
    case 'cooler':
      if ((next.speed ?? 0) !== (prev.speed ?? 0)) sfx.hum(key, next.speed ?? 0, { base: 55, span: 60, vol: 0.012, fan: true });
      break;
    case 'stepper':
      if ((next.angle ?? 0) !== (prev.angle ?? 0)) sfx.step(key);
      break;
    default:
  }
}

export const isSoundOn = () => enabled;
export function setSound(on) {
  enabled = !!on;
  try { localStorage.setItem(KEY, enabled ? '1' : '0'); } catch {}
  if (!enabled) { sfx.stopAll(); ac?.suspend?.().catch(() => {}); }
  if (hasWin) window.dispatchEvent(new CustomEvent('cd-sound', { detail: { on: enabled } }));
}
if (hasWin) {
  const unlock = () => { unlocked = true; if (enabled) ctx(); };
  window.addEventListener('pointerdown', unlock, { capture: true, passive: true });
  window.addEventListener('keydown', unlock, { capture: true });
  window.addEventListener('cd-sound', (e) => { if (e.detail?.on !== enabled) { enabled = !!e.detail?.on; if (!enabled) sfx.stopAll(); } });
  window.addEventListener('storage', (e) => { if (e.key === KEY) { enabled = e.newValue !== '0'; if (!enabled) sfx.stopAll(); } });
  document.addEventListener('visibilitychange', () => { if (document.hidden) sfx.stopAll(); });
}
