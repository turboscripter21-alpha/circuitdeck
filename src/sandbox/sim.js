// Browser simulation of the generated program. Follows the same rules as codegen.js tick by tick
// (100 ms per tick), reading sensor values from the sandbox's input panel.
import { roles } from './roles.js';
import { RULES } from './codegen.js';
import { drawScreen } from '../core/parts.js';

const DEFAULTS = { distance: 80, temp: 22.5, hum: 45, pressure: 1013, value: 50, light: 60, moisture: 55, gas: 10 };
const RANGES = { distance: [2, 200, 1], temp: [-10, 45, 0.5], hum: [0, 100, 1], pressure: [950, 1050, 1], value: [0, 100, 1], light: [0, 100, 1], moisture: [0, 100, 1], gas: [0, 100, 1] };

// The controls the input panel shows for a circuit.
export function inputSpec(c, conn) {
  const R = roles(c, conn);
  const out = [];
  for (const b of R.buttons) out.push({ id: b.id, kind: 'hold', label: `Hold ${b.id}` });
  for (const p of R.pirs) out.push({ id: p.id, kind: 'hold', label: 'Wave at the PIR' });
  if (R.keypad) out.push({ id: R.keypad.id, kind: 'keys', label: 'Keypad' });
  for (const r of R.readings) { const [min, max, step] = RANGES[r.key]; out.push({ id: `${r.p.id}:${r.key}`, kind: 'range', label: `${r.label} (${r.p.id})`, min, max, step, value: DEFAULTS[r.key], unit: r.unit }); }
  if (R.cams.length && R.ais.length) out.push({ id: 'scene', kind: 'select', label: 'In front of the camera', options: ['person', 'cat', 'cup', 'nothing'], value: 'person' });
  return out;
}
export function defaultInputs(spec) { const o = {}; for (const s of spec) if ('value' in s) o[s.id] = s.value; return o; }

const fmtNum = (x) => (Math.round(x * 10) / 10).toFixed(1);

export function runSim({ c, conn, insts, inputs, print, beep, mark, codeLines }) {
  const R = roles(c, conn);
  const T = RULES;
  const set = (p, patch) => insts[p.id]?.set(patch);
  const val = (r) => +(inputs[`${r.p.id}:${r.key}`] ?? DEFAULTS[r.key]);
  const rv = (key) => { const r = R.readings.find((x) => x.key === key); return r ? val(r) : null; };
  const lineOf = (snip) => { const i = codeLines.findIndex((l) => l.includes(snip)); return i >= 0 ? i + 1 : 0; };
  const loopLine = lineOf(c.board === 'pi5' ? 'while True' : 'void loop');
  const st = { tick: 0, was: false, entered: '', unlock: 0, wrong: 0, phase: '', walk: false, backing: 0, ringMode: 0, wasPressed: false, stepPos: 0, ledOn: {}, labels: [], keysSeen: 0, relay: false };
  const pressed = (p) => !!inputs[p.id];
  const S = (t) => (t === '°C' ? 'C' : t === '%' ? '%' : ` ${t}`);
  const textLines = () => (R.readings.length ? R.readings.slice(0, 3).map((r) => `${r.label} ${fmtNum(val(r))}${S(r.unit)}`) : ['CircuitDeck', `up ${Math.floor(st.tick / 10)} s`]);
  let buzzing = false;

  function tick() {
    const t = st.tick;
    const trig = R.hasTrigger ? R.buttons.some(pressed) || R.pirs.some(pressed) : false;
    if (R.hasTrigger) { if (trig && !st.was) print(R.pirs.length ? 'Motion detected!' : 'Button pressed'); st.was = trig; }
    for (const p of R.pirs) set(p, { motion: pressed(p) });
    for (const p of R.buttons) set(p, { pressed: pressed(p) });
    // keypad: keys typed into the panel arrive in inputs.__keys
    if (R.keypad) {
      const q = inputs.__keys || [];
      if (q.length) {
        const key = q.shift();
        if (key === '*') { st.entered = ''; print('Cleared'); }
        else { st.entered += key; print(c.board === 'pi5' ? `Key ${key} → ${'*'.repeat(st.entered.length)}` : `Key ${key}`); }
        if (st.entered.length === T.code.length) {
          if (st.entered === T.code) { print('Unlocked!', 'cd-ok'); st.unlock = T.unlockTicks; } else { print('Wrong code', 'cd-err'); st.wrong = 12; }
          st.entered = '';
        }
      }
    }
    // camera / AI
    if (R.cams.length && R.ais.length && t % T.printEvery === 0) {
      const s = inputs.scene || 'person';
      st.labels = s === 'nothing' ? [] : [s];
      if (st.labels.length) print(`Detected: ${st.labels.join(', ')}`);
      for (const a of R.ais) set(a, { busy: true });
    } else if (R.cams.length && !R.ais.length && t % 50 === 0) print(`Saved capture-${t / 50}.jpg`);
    if (R.coolers.length && t % T.printEvery === 0) {
      const cpu = R.ais.length ? 61.5 + Math.sin(t / 30) * 2 : 47 + Math.sin(t / 40);
      const rpm = cpu > 60 ? 4300 : cpu > 50 ? 2700 : 1400;
      print(`CPU ${fmtNum(cpu)} °C  fan ${rpm} rpm`);
      for (const f of R.coolers) set(f, { speed: rpm / 6000 });
    }
    // conditions
    const cond = { trigger: trig, dark: rv('light') != null && rv('light') < T.dark, dry: rv('moisture') != null && rv('moisture') < T.dry, gas: rv('gas') != null && rv('gas') > T.gas, near: rv('distance') != null && rv('distance') < T.near, detect: st.labels.includes('person'), motion: R.pirs.some(pressed) };
    // traffic light
    if (R.lights.length) {
      const tr = T.traffic, cyc = tr.red + tr.green + tr.amber, step = t % cyc;
      const now = step < tr.red ? 'red' : step < tr.red + tr.green ? 'green' : 'amber';
      if (now !== st.phase) { st.phase = now; print(c.board === 'pi5' ? now.toUpperCase() : now); }
      for (const L of R.lights) set(L, { r: now === 'red', y: now === 'amber', g: now === 'green' });
      if (R.trafficButton && trig && now !== 'red' && !st.walk) { st.walk = true; print('Walk requested'); }
    }
    // leds
    if (R.ledRule === 'lock') {
      if (R.okLed) set(R.okLed, { on: st.unlock > 0 });
      if (R.badLed) set(R.badLed, { on: st.wrong > 0 && Math.floor(st.wrong / 2) % 2 === 0 });
      for (const l of R.leds.filter((x) => x !== R.okLed && x !== R.badLed)) set(l, { on: st.unlock > 0 });
    } else for (const l of R.leds) {
      if (R.ledRule === 'blink') { if (t % T.blinkEvery === 0) st.ledOn[l.id] = !st.ledOn[l.id]; set(l, { on: !!st.ledOn[l.id] }); }
      else set(l, { on: !!cond[R.ledRule] });
    }
    // buzzers
    let buzz = false;
    if (R.buzzers.length) {
      buzz = { lock: st.unlock > T.unlockTicks - 2 || st.wrong > 2, walk: st.phase === 'red' && st.walk && t % 5 === 0, motion: cond.motion, trigger: trig, gas: cond.gas, near: cond.near, chirp: t % T.chirpEvery === 0 }[R.buzzRule];
      for (const b of R.buzzers) set(b, { on: !!buzz });
    }
    if (buzz !== buzzing) { beep(!!buzz); buzzing = !!buzz; }
    if (R.trafficButton && st.phase === 'red' && t % (T.traffic.red + T.traffic.green + T.traffic.amber) === T.traffic.red - 1) st.walk = false;
    // rgb
    const COLORS = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 0], [0, 1, 1], [1, 0, 1]];
    for (const p of R.rgbs) { const k = COLORS[Math.floor(t / 10) % 6]; set(p, { r: k[0], g: k[1], b: k[2] }); }
    // servos
    for (const s of R.servos) {
      const a = R.servoRule === 'lock' ? (st.unlock > 0 ? 90 : 0) : R.servoRule === 'pot' ? rv('value') / 100 * 180 : (Math.floor(t / 10) % 7) * 30;
      set(s, { angle: a - 90 });
    }
    // motors
    if (R.motors.length) {
      let speeds;
      if (rv('distance') != null) {
        if (st.backing === 0 && rv('distance') < T.robotNear) { print('Obstacle! Backing up', 'cd-err'); st.backing = 15; }
        speeds = st.backing > 5 ? R.motors.map(() => -0.6) : st.backing > 0 ? R.motors.map((_, i) => (i === 0 ? 0.6 : -0.6)) : R.motors.map(() => 0.6);
        st.backing = Math.max(0, st.backing - 1);
      } else speeds = R.motors.map(() => (t % 40 < 30 ? 0.6 : 0));
      R.motors.forEach((m, i) => set(m.motor, { speed: speeds[i] }));
    }
    for (const p of R.steppers) { st.stepPos += T.stepsPerTick; set(p, { angle: (st.stepPos / T.stepsPerRev) * 360, phase: 1 << (Math.floor(st.stepPos / 2) % 4) }); }
    if (R.relay) {
      const on = { trigger: trig, dark: cond.dark, toggle: Math.floor(t / 20) % 2 === 1 }[R.relayRule];
      set(R.relay, { on: !!on });
      if (R.lampOnRelay) set(R.lampOnRelay, { on: !!on });
      if (!!on !== st.relay) { st.relay = !!on; insts.__click?.(); }
    }
    for (const p of R.rings) {
      if (R.ringButton) { const pr = pressed(R.buttons[0]); if (pr && !st.wasPressed) { st.ringMode = (st.ringMode + 1) % 3; print(c.board === 'pi5' ? `Mode ${['rainbow', 'chase', 'warm'][st.ringMode]}` : `Mode ${st.ringMode}`); } st.wasPressed = pr; }
      const px = [];
      for (let i = 0; i < 12; i++) {
        if (st.ringMode === 0) { const h = ((i + t) % 12) / 12; const f = (n) => { const k = (n + h * 6) % 6; return Math.round(255 * (1 - Math.max(0, Math.min(k, 4 - k, 1)))); }; px.push([f(5), f(3), f(1)]); }
        else if (st.ringMode === 1) px.push(i === t % 12 ? [0, 120, 255] : null);
        else px.push([255, 140, 40]);
      }
      set(p, { pixels: px });
    }
    for (const p of R.matrices) {
      const heart = R.hasTrigger ? trig : rv('distance') != null ? cond.near : Math.floor(t / 10) % 2 === 1;
      set(p, { rows: heart ? [0x00, 0x66, 0xff, 0xff, 0x7e, 0x3c, 0x18, 0x00] : [0x3c, 0x42, 0xa5, 0x81, 0xa5, 0x99, 0x42, 0x3c] });
    }
    // slow block: displays + console line
    if (t % T.printEvery === 0) {
      const lines = textLines();
      for (const p of R.oleds) drawScreen(insts[p.id], (g, w, h) => { g.fillStyle = '#04070c'; g.fillRect(0, 0, w, h); g.fillStyle = '#bfe8ff'; g.font = `600 ${Math.round(h / 5)}px "Courier New", monospace`; lines.forEach((s, i) => g.fillText(s, w * 0.05, h * (0.28 + i * 0.3))); });
      for (const p of R.lcds) drawScreen(insts[p.id], (g, w, h) => { g.fillStyle = '#7fb33f'; g.fillRect(0, 0, w, h); g.fillStyle = '#1d3410'; g.font = `700 ${Math.round(h / 3)}px "Courier New", monospace`; lines.slice(0, 2).forEach((s, i) => g.fillText(s.padEnd(16).slice(0, 16), w * 0.03, h * (0.4 + i * 0.45))); });
      if (t % 600 === 0) for (const p of R.epapers) drawScreen(insts[p.id], (g, w, h) => { g.fillStyle = '#f2f0e8'; g.fillRect(0, 0, w, h); g.fillStyle = '#111'; g.font = `700 ${Math.round(h / 6)}px sans-serif`; lines.forEach((s, i) => g.fillText(s, w * 0.05, h * (0.25 + i * 0.28))); });
      if (R.readings.length) print(R.readings.map((r) => `${r.label} ${fmtNum(val(r))} ${r.unit}`).join('  |  '));
      mark(loopLine);
    }
    for (const r of R.readings) if (r.key === 'distance' && t % 5 === 0) set(r.p, { ping: true });
    for (const r of R.readings) if (r.key === 'value') set(r.p, { value: val(r) / 100 });
    for (const r of R.readings) if (r.key === 'gas') set(r.p, { gas: val(r) / 100 });
    if (R.keypad) { st.unlock = Math.max(0, st.unlock - 1); st.wrong = Math.max(0, st.wrong - 1); }
    st.tick++;
  }
  tick();
  const id = setInterval(tick, T.tickMs);
  return { stop() { clearInterval(id); if (buzzing) beep(false); }, state: st };
}
