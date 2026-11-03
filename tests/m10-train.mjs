// M10: Train panel end-to-end. Fake camera (y4m) + fake mic (wav) + synthetic DeviceMotion events.
// Usage: node m10-train.mjs [only]   (only = camera|mic|motion|persist|serial|mobile|tinyml)
// Writes /tmp/m10/*.zip + cases.json and runs tests/m10-verify.py on them.
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const BASE = process.env.BASE || 'http://127.0.0.1:8080';
const OUT = process.env.OUT || '/tmp/m10';
const SHOTS = process.env.SHOTS || '';
const Y4M = process.env.Y4M || '/workspace/pw/qr.y4m', WAV = process.env.WAV || '/workspace/pw/tone.wav';
const VERIFY = process.env.VERIFY || new URL('./m10-verify.py', import.meta.url).pathname;
const only = process.argv[2];
mkdirSync(OUT, { recursive: true });
let fails = 0, passes = 0;
const ok = (c, msg) => { if (c) { passes++; console.log('  ✓', msg); } else { fails++; console.log('  ✗', msg); } };
const args = ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
  `--use-file-for-fake-video-capture=${Y4M}`, `--use-file-for-fake-audio-capture=${WAV}`, '--autoplay-policy=no-user-gesture-required'];
const browser = await chromium.launch({ args });

async function page({ mobile = false, theme = 'light', noSerial = false, mockSerial = false } = {}) {
  const ctx = await browser.newContext(mobile ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36' } : { viewport: { width: 1600, height: 900 } });
  await ctx.route('**/*', (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
  await ctx.addInitScript((t) => { try { localStorage.setItem('circuitdeck:theme', t); } catch {} }, theme);
  if (noSerial) await ctx.addInitScript(() => { try { delete Navigator.prototype.serial; } catch {} Object.defineProperty(navigator, 'serial', { value: undefined, configurable: true }); });
  if (mockSerial) await ctx.addInitScript(() => { const s = navigator.serial || {}; s.requestPort = async () => { throw new DOMException('No port selected by the user.', 'NotFoundError'); }; if (!navigator.serial) Object.defineProperty(navigator, 'serial', { value: s }); });
  await ctx.grantPermissions(['accelerometer', 'gyroscope', 'microphone', 'camera'], { origin: BASE }).catch(() => {});
  const p = await ctx.newPage();
  p.errors = [];
  p.on('console', (m) => { if (m.type() === 'error') p.errors.push(m.text()); });
  p.on('pageerror', (e) => p.errors.push('pageerror: ' + e.message));
  p.on('dialog', (d) => d.accept());
  return p;
}
async function openTrain(p, sensor) {
  await p.goto(`${BASE}/sandbox/#train=${sensor}`);
  await p.waitForFunction(() => window.__train?.state?.meta && window.__sb, null, { timeout: 90000 });
  await throttle3d(p, true);
}
// Headless swiftshader spends ~0.7 s per 3D frame, which starves timers (sensor sampling, training).
// Test-only: draw the 3D scene on every 12th frame while working; full rate again before screenshots.
const throttle3d = (p, on) => p.evaluate((on) => {
  const c = window.__sb.stage.composer; c.__render ||= c.render.bind(c); let n = 0;
  c.render = on ? (...a) => { if (n++ % 12 === 0) c.__render(...a); } : c.__render;
}, on);
const until = (p, fn, arg, timeout = 120000) => p.waitForFunction(fn, arg, { timeout, polling: 250 }).catch(async () => {
  const d = await p.evaluate(() => { const t = window.__train?.state; return t && JSON.stringify({ tab: t.tab, live: t.src?.live, ev: t.src?.events, ring: t.src?.ring?.length, testing: t.testing, probs: t.probs, last: window.__train.lastAction, n: t.samples.length, training: t.training, notice: t.notice, err: t.srcErr }); }).catch(() => '?');
  throw new Error(`timed out (${timeout} ms) waiting for ${String(fn).slice(0, 140)} | state ${d} | errors ${p.errors.join(' | ')}`); });
const shot = async (p, name) => { if (!SHOTS) return; await throttle3d(p, false); await p.waitForTimeout(1500); await p.screenshot({ path: `${SHOTS}/${name}.png` }); await throttle3d(p, true); };

// synthetic data, generated in the page (same normalisation as the sensors)
const GEN = () => {
  let seed = 1;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  window.__m10 = {
    motion(cls) { // left: tilted left and turning one way; right: the mirror image
      const sgn = cls ? 1 : -1, ph = rnd() * 6, out = new Float32Array(240);
      for (let t = 0; t < 40; t++) { const r = [sgn * 0.5 + 0.15 * Math.sin(t / 3 + ph) + (rnd() - 0.5) * 0.1, (rnd() - 0.5) * 0.2, 0.8 + (rnd() - 0.5) * 0.1, (rnd() - 0.5) * 0.1, (rnd() - 0.5) * 0.1, sgn * 0.3 + (rnd() - 0.5) * 0.1]; out.set(r, t * 6); }
      return out;
    },
    mic(cls) { // clap: broadband bursts; quiet: low noise floor
      const out = new Float32Array(1280);
      for (let f = 0; f < 40; f++) { const burst = cls === 0 && f % 10 < 3; for (let b = 0; b < 32; b++) out[f * 32 + b] = Math.min(1, Math.max(0, (burst ? 0.75 - b * 0.01 : 0.12) + (rnd() - 0.5) * 0.15)); }
      return out;
    },
    image(cls) { // camera: red-ish vs blue-ish scenes with random blobs
      const c = document.createElement('canvas'); c.width = c.height = 224; const g = c.getContext('2d');
      g.fillStyle = cls ? `rgb(${30 + rnd() * 40},${60 + rnd() * 50},${170 + rnd() * 70})` : `rgb(${180 + rnd() * 60},${40 + rnd() * 50},${30 + rnd() * 40})`; g.fillRect(0, 0, 224, 224);
      for (let i = 0; i < 4; i++) { g.fillStyle = `hsla(${rnd() * 360},50%,${40 + rnd() * 30}%,.5)`; g.beginPath(); g.arc(rnd() * 224, rnd() * 224, 15 + rnd() * 30, 0, 7); g.fill(); }
      return c;
    },
    // live phone motion matching a class, same noise as motion() (DeviceMotion units: m/s² and °/s)
    shake(cls, ms = 99999) {
      clearInterval(this.timer); const sgn = cls ? 1 : -1; let t = 0;
      this.timer = setInterval(() => { t++; window.dispatchEvent(new DeviceMotionEvent('devicemotion', { accelerationIncludingGravity: { x: (sgn * 0.5 + 0.15 * Math.sin(t / 3) + (rnd() - 0.5) * 0.1) * 9.81, y: (rnd() - 0.5) * 0.2 * 9.81, z: (0.8 + (rnd() - 0.5) * 0.1) * 9.81 }, rotationRate: { alpha: (rnd() - 0.5) * 0.1 * 250, beta: (rnd() - 0.5) * 0.1 * 250, gamma: (sgn * 0.3 + (rnd() - 0.5) * 0.1) * 250 }, interval: 16 })); }, 16);
      setTimeout(() => clearInterval(this.timer), ms);
    },
    stop() { clearInterval(this.timer); },
  };
};
async function seed(p, kind, n) {
  await p.evaluate(GEN);
  await p.evaluate(async ({ kind, n }) => {
    for (let i = 0; i < n; i++) for (const cls of [0, 1]) {
      if (kind === 'camera') await window.__train.addImage(cls, window.__m10.image(cls));
      else await window.__train.addSample(cls, window.__m10[kind](cls));
    }
  }, { kind, n });
}
async function train(p, epochs) {
  await p.selectOption('select[data-epochs]', String(epochs)).catch(() => {});
  await p.click('[data-act=train]');
  await until(p, () => !window.__train.state.training && window.__train.state.result && document.querySelector('.tr-cm'), null, 600000);
  return p.evaluate(() => { const r = window.__train.state.result; return { acc: r.accuracy, cm: r.cm, evalOn: r.evalOn, nVal: r.nVal, cells: document.querySelectorAll('.tr-cm td').length, epochs: r.history.length, txt: document.querySelector('.tr-epoch')?.textContent, bar: document.querySelector('.tr-progress')?.getAttribute('aria-valuenow') }; });
}
const tab = (p, t) => p.click(`.tr-tabs [data-tab=${t}]`);

// ------------------------------------------------------------------ motion: the full loop
async function motion() {
  console.log('motion (synthetic DeviceMotion): record, train, confusion matrix, live test → LED/relay, wrong → retrain, zips');
  const p = await page();
  await openTrain(p, 'motion');
  ok(await p.isVisible('#train-panel') && await p.getAttribute('[data-sensor=motion]', 'aria-checked') === 'true', 'panel opens from #train=motion with Motion selected');
  await p.evaluate(GEN);
  // rename a class, add + delete a class
  await p.fill('[data-rename]:nth-of-type(1)', 'tilt left'); await p.press('[data-rename]:nth-of-type(1)', 'Tab');
  await p.click('[data-act=addclass]');
  await until(p, () => document.querySelectorAll('.tr-class').length === 3, null, 10000);
  ok(true, 'add class → 3 classes');
  await p.locator('.tr-class').nth(2).locator('[data-delclass]').click();
  await until(p, () => document.querySelectorAll('.tr-class').length === 2, null, 10000);
  ok(true, 'delete class → back to 2 (with confirm)');
  ok(await p.evaluate(() => window.__train.state.meta.classes[0].name) === 'tilt left', 'rename persists in meta');
  await p.click('[data-act=start]');
  await until(p, () => window.__train.state.src?.live, null, 10000);
  await p.evaluate(() => window.__m10.shake(0));
  await until(p, () => window.__train.state.src.events > 20 && document.querySelector('canvas.tr-live'), null, 10000);
  ok(!(await p.isVisible('.tr-badge')), 'real DeviceMotion events: not marked simulated');
  await p.click('.tr-class >> nth=0 >> [data-record]');
  await until(p, () => window.__train.state.samples.length === 1, null, 20000);
  const s0 = await p.evaluate(() => Array.from(window.__train.state.samples[0].data.slice(-6)).map((v) => +v.toFixed(2)));
  ok(Math.abs(s0[0] + 0.5) < 0.3 && Math.abs(s0[5] + 0.3) < 0.1, `Record 2 s captures the live window (latest row ${s0.join(', ')})`);
  // hold to record
  const hold = p.locator('.tr-class >> nth=1 >> [data-hold]');
  await p.evaluate(() => window.__m10.shake(1));
  await p.waitForTimeout(2200);
  const box = await hold.boundingBox();
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await p.mouse.down(); await p.waitForTimeout(1800); await p.mouse.up();
  await until(p, () => !document.querySelector('.tr-hold.is-recording'), null, 10000);
  const nHold = await p.evaluate(() => window.__train.state.samples.filter((s) => s.cls === window.__train.state.meta.classes[1].id).length);
  ok(nHold >= 2, `Hold to record adds samples while held (${nHold})`);
  // delete one sample
  const before = await p.locator('.tr-thumb').count();
  await p.locator('.tr-thumb').first().click();
  await until(p, (n) => document.querySelectorAll('.tr-thumb').length === n - 1, before, 10000);
  ok(true, 'click a thumbnail deletes that sample');
  await seed(p, 'motion', 14);
  const counts = await p.$$eval('.tr-count', (els) => els.map((e) => e.textContent));
  ok(counts.every((c) => parseInt(c) >= 14), `sample counts per class shown (${counts.join(' / ')})`);
  await p.evaluate(() => window.__m10.stop());
  await tab(p, 'train');
  const r = await train(p, 30);
  ok(r.acc >= 0.9 && r.evalOn === 'validation' && r.nVal >= 4, `trained: validation accuracy ${(r.acc * 100).toFixed(0)}% on ${r.nVal} held-out`);
  ok(r.cells === 4 && /Epoch 30\/30 · loss [\d.]+ · acc \d+% · val loss [\d.]+ · val acc \d+%/.test(r.txt) && r.bar === '30', `confusion matrix 2×2 ${JSON.stringify(r.cm)}; epoch readout "${r.txt}"`);
  await shot(p, 'm10-motion-train');
  // live test → outputs in the 3D scene
  const ids = await p.evaluate(() => window.__sb.trainHost.addOutputs());
  await tab(p, 'deploy');
  await until(p, () => document.querySelector('.tr-bars'), null, 10000);
  ok((await p.textContent('.tr-hint')).includes('1 LED, 1 relay'), 'deploy tab lists the LED and relay that were added');
  await p.selectOption('select[data-action="1"]', 'relay');
  await p.evaluate(() => window.__m10.shake(0));
  await p.waitForTimeout(2300);
  await p.click('[data-act=test]');
  await until(p, () => window.__train.lastAction === 'led', null, 30000);
  const ledOn = await p.evaluate(([, led, rel]) => [window.__sb.insts[led].state.on, window.__sb.insts[rel].state.on], ids);
  ok(ledOn[0] && !ledOn[1], `left motion → LED on, relay off in the 3D scene (${await p.textContent('[data-pred]')})`);
  const bars = await p.$$eval('.tr-bar-pct', (e) => e.map((x) => x.textContent));
  ok(parseInt(bars[0]) >= 60, `confidence bars update (${bars.join(' / ')})`);
  await shot(p, 'm10-motion-test');
  await p.evaluate(() => window.__m10.shake(1));
  await until(p, () => window.__train.lastAction === 'relay', null, 30000);
  const relOn = await p.evaluate(([, led, rel]) => [window.__sb.insts[led].state.on, window.__sb.insts[rel].state.on], ids);
  ok(!relOn[0] && relOn[1], 'right motion → relay on, LED off');
  // the loop: Wrong? → add samples for the true class → retrain
  const n0 = await p.evaluate(() => window.__train.state.samples.length);
  await p.click('[data-act=wrong]');
  await p.click('[data-fix]:nth-of-type(2)');
  await until(p, (n) => window.__train.state.samples.length === n + 2, n0, 30000);
  await until(p, () => window.__train.state.tab === 'train' && !window.__train.state.training && document.querySelector('.tr-cm'), null, 600000);
  const r2 = await p.evaluate(() => window.__train.state.result);
  ok(r2.nSamples === n0 + 2 && (await p.textContent('.tr-notice')).includes('Retraining'), `Wrong? → 2 new samples → retrained automatically (${r2.nSamples} samples, acc ${(r2.accuracy * 100).toFixed(0)}%)`);
  await p.evaluate(() => window.__m10.stop());
  // flash UI exists on desktop Chromium (Web Serial)
  await tab(p, 'deploy');
  ok(await p.isVisible('[data-act=flash]') && !(await p.isVisible('.tr-noserial')), 'desktop Chromium: "Compile & flash" shown (Web Serial present)');
  // zips + cases for the numpy / CDM1 check
  await zips(p, 'motion');
  // reload: data + model persist
  await p.reload();
  await p.waitForFunction(() => window.__sb?.openTrain, null, { timeout: 90000 });
  await p.evaluate(() => window.__sb.openTrain({ sensor: 'motion' }));
  await p.waitForFunction(() => window.__train?.state?.meta && window.__train.state.sensor === 'motion' && window.__train.state.samples.length, null, { timeout: 90000 });
  const per = await p.evaluate(() => ({ n: window.__train.state.samples.length, model: !!window.__train.state.model, name: window.__train.state.meta.classes[0].name }));
  ok(per.n === n0 + 2 && per.model && per.name === 'tilt left', `after reload: ${per.n} samples, trained model and class names restored from IndexedDB`);
  ok(p.errors.length === 0, `0 console errors (${p.errors.join(' | ')})`);
  await p.context().close();
}
async function zips(p, sensor) {
  const files = await p.evaluate(async (sensor) => {
    const toArr = (u8) => Array.from(u8);
    const inputs = [];
    for (const cls of [0, 1]) for (let i = 0; i < 3; i++) inputs.push(sensor === 'camera' ? Array.from(window.__train.state.samples.filter((s) => s.cls === window.__train.state.result.classIds[cls])[i].data) : Array.from(window.__m10[sensor](cls)));
    const probs = []; for (const x of inputs) probs.push(Array.from(await window.__train.predict(Float32Array.from(x))));
    return { esp: toArr(await window.__train.zip('esp32')), pi: toArr(await window.__train.zip('pi')), cases: { sensor, classes: window.__train.state.result.classIds.map((id) => window.__train.state.meta.classes.find((c) => c.id === id).name), inputs, probs } };
  }, sensor);
  writeFileSync(`${OUT}/${sensor}-esp32.zip`, Buffer.from(files.esp));
  writeFileSync(`${OUT}/${sensor}-pi.zip`, Buffer.from(files.pi));
  writeFileSync(`${OUT}/${sensor}-cases.json`, JSON.stringify(files.cases));
  // the download buttons produce a file too
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 30000 }), p.click('[data-act=zip-esp32]')]);
  ok(dl.suggestedFilename() === `circuitdeck-${sensor}-esp32.zip`, `"Download ESP32 zip" downloads ${dl.suggestedFilename()}`);
  try {
    const out = execFileSync('python3', [VERIFY, OUT, sensor], { encoding: 'utf8' });
    for (const line of out.trim().split('\n')) ok(!line.startsWith('FAIL'), `zip check: ${line}`);
  } catch (err) { ok(false, `zip check crashed: ${err.stdout || ''}${err.stderr || err.message}`); }
}

// ------------------------------------------------------------------ camera (fake y4m)
async function camera() {
  console.log('camera (fake y4m + synthetic red/blue frames): record, hold, transfer learning, live test');
  const p = await page();
  await openTrain(p, 'camera');
  await p.click('[data-act=start]');
  await until(p, () => window.__train.state.src?.live && !window.__train.state.busy && document.querySelector('.tr-video video')?.readyState >= 2, null, 180000);
  ok(true, 'fake camera live feed in the panel; MobileNet V2 loaded');
  await p.click('.tr-class >> nth=0 >> [data-record]');
  await until(p, () => window.__train.state.samples.length === 1, null, 60000);
  const emb = await p.evaluate(() => window.__train.state.samples[0].data.length);
  ok(emb === 1280, `Record → one 1280-d MobileNet embedding + thumbnail (${await p.locator('.tr-thumb img').count()} thumb)`);
  const hold = p.locator('.tr-class >> nth=1 >> [data-hold]'); const box = await hold.boundingBox();
  await p.mouse.move(box.x + 20, box.y + 10); await p.mouse.down(); await p.waitForTimeout(2500); await p.mouse.up();
  await until(p, () => !document.querySelector('.tr-hold.is-recording'), null, 30000);
  const nh = await p.evaluate(() => window.__train.state.samples.length - 1);
  ok(nh >= 2, `Hold to record captures frames while held (${nh})`);
  await shot(p, 'm10-camera-data');
  await p.evaluate(async () => { for (const s of [...window.__train.state.samples]) document.querySelector(`[data-delsample="${s.id}"]`)?.click(); });
  await until(p, () => window.__train.state.samples.length === 0, null, 10000);
  await seed(p, 'camera', 10);
  await tab(p, 'train');
  const r = await train(p, 20);
  ok(r.acc >= 0.9, `transfer learning: ${(r.acc * 100).toFixed(0)}% on ${r.nVal} held-out frames, cm ${JSON.stringify(r.cm)}`);
  await tab(p, 'deploy');
  ok(await p.isDisabled('[data-act=flash]') && (await p.textContent('.tr-honest')).includes('Pi 5'), 'camera: flash disabled, honest note says camera models run on the Pi 5');
  await p.click('[data-act=test]');
  await until(p, () => window.__train.state.probs && document.querySelector('[data-pred]').textContent, null, 60000);
  ok(true, `live camera inference on the fake feed → "${await p.textContent('[data-pred]')}"`);
  await p.click('[data-act=stoptest]');
  await zips(p, 'camera');
  ok(p.errors.length === 0, `0 console errors (${p.errors.join(' | ')})`);
  await p.context().close();
}

// ------------------------------------------------------------------ mic (fake wav)
async function mic() {
  console.log('mic (fake wav + synthetic spectrograms)');
  const p = await page({ theme: 'dark' });
  await openTrain(p, 'mic');
  await p.click('[data-act=start]');
  await until(p, () => window.__train.state.src?.live && window.__train.state.src.ready(), null, 30000);
  const energy = await p.evaluate(() => window.__train.state.src.snapshot().reduce((a, b) => a + b, 0));
  ok(energy > 1, `fake mic → live spectrogram has energy (${energy.toFixed(1)})`);
  await p.click('.tr-class >> nth=0 >> [data-record]');
  await until(p, () => window.__train.state.samples.length === 1, null, 20000);
  ok(await p.evaluate(() => window.__train.state.samples[0].data.length) === 1280, 'Record 1 s → a 40×32 spectrogram sample');
  // the fake wav is a gated 440 Hz tone, not a clap: drop it so the synthetic 2-class set is clean
  await p.click('.tr-thumb >> nth=0');
  await until(p, () => window.__train.state.samples.length === 0, null, 10000);
  await seed(p, 'mic', 12);
  await tab(p, 'train');
  const r = await train(p, 30);
  ok(r.acc >= 0.9, `spectrogram CNN: ${(r.acc * 100).toFixed(0)}% validation, cm ${JSON.stringify(r.cm)}`);
  await shot(p, 'm10-mic-train-dark');
  await tab(p, 'deploy');
  await zips(p, 'mic');
  ok(p.errors.length === 0, `0 console errors (${p.errors.join(' | ')})`);
  await p.context().close();
}

// ------------------------------------------------------------------ Web Serial: missing / cancelled
async function serial() {
  console.log('Web Serial fallback + cancelled port');
  const p = await page({ noSerial: true });
  await openTrain(p, 'motion');
  await seed(p, 'motion', 5); await tab(p, 'train'); await train(p, 10); await tab(p, 'deploy');
  const t = await p.textContent('.tr-noserial');
  ok(!(await p.isVisible('[data-act=flash]')) && /No Web Serial here/.test(t) && /Chrome or Edge on a desktop/.test(t), `no navigator.serial → message, no flash button: "${t.trim().slice(0, 90)}…"`);
  ok(await p.isVisible('[data-act=zip-esp32]') && await p.isVisible('[data-act=zip-pi]'), 'both zip downloads offered instead');
  ok(p.errors.length === 0, `0 console errors (${p.errors.join(' | ')})`);
  await p.context().close();
  const q = await page({ mockSerial: true });
  await openTrain(q, 'motion');
  await seed(q, 'motion', 5); await tab(q, 'train'); await train(q, 10); await tab(q, 'deploy');
  await q.click('[data-act=flash]');
  await until(q, () => /✗/.test(document.querySelector('.tr-log')?.textContent || ''), null, 30000);
  const log = await q.textContent('.tr-log');
  ok(/CDM1, int8 weights\) → 0x3c0000/.test(log) && /No port selected/.test(log), `Compile & flash: blob built, port picker cancelled → logged (${log.trim().split('\n').join(' ⏎ ').slice(0, 120)})`);
  ok(q.errors.length === 0, `0 console errors (${q.errors.join(' | ')})`);
  await q.context().close();
}

// ------------------------------------------------------------------ mobile 390x844 (Android UA, dark)
async function mobile() {
  console.log('mobile 390x844, Android Chrome UA, dark theme');
  const p = await page({ mobile: true, theme: 'dark', noSerial: true }); // Android Chrome: no navigator.serial
  await p.goto(`${BASE}/sandbox/`);
  await p.waitForFunction(() => window.__sb && !document.documentElement.classList.contains('is-loading'), null, { timeout: 90000 });
  await p.waitForTimeout(800);
  await throttle3d(p, true);
  ok(await p.isVisible('[data-nav=train]'), 'Train item in the phone nav bar');
  await p.click('[data-nav=train]');
  await until(p, () => window.__train?.state?.meta, null, 60000);
  await p.click('[data-sensor=motion]');
  await until(p, () => window.__train.state.sensor === 'motion' && window.__train.state.meta?.classes, null, 20000);
  const g = await p.evaluate(() => { const r = document.querySelector('#train-panel').getBoundingClientRect(); return { w: r.width, h: r.height, sw: document.querySelector('#train-panel').scrollWidth }; });
  ok(g.w === 390 && g.h === 844 && g.sw <= 390, `full-screen sheet ${g.w}×${g.h}, no sideways scroll`);
  await seed(p, 'motion', 6); await tab(p, 'train'); await train(p, 10); await tab(p, 'deploy');
  const t = await p.textContent('.tr-noserial');
  ok(/Android Chrome has no Web Serial/.test(t), 'Android: clear "no Web Serial" message + zips');
  await p.evaluate(() => document.querySelector('.tr-noserial').scrollIntoView({ block: 'center' }));
  await shot(p, 'm10-mobile-deploy-dark');
  await p.click('[data-act=close]');
  ok(!(await p.isVisible('#train-panel')), 'close button hides the panel');
  ok(p.errors.length === 0, `0 console errors (${p.errors.join(' | ')})`);
  await p.context().close();
}

async function tinyml() {
  console.log('TinyML page links to the Train panel');
  const p = await page();
  await p.goto(`${BASE}/tinyml/`);
  await p.waitForSelector('a[href="/sandbox/#train"]', { timeout: 60000 });
  await p.click('a[href="/sandbox/#train"]');
  await until(p, () => window.__train?.isOpen(), null, 90000);
  ok(true, 'TinyML sidebar "Train" → /sandbox/#train opens the panel');
  ok(p.errors.length === 0, `0 console errors (${p.errors.join(' | ')})`);
  await p.context().close();
}

const all = { motion, camera, mic, serial, mobile, tinyml };
for (const [k, f] of Object.entries(all)) {
  if (only && only !== k) continue;
  try { await f(); } catch (err) { fails++; console.log('  ✗', k, 'threw:', err.message.split('\n')[0]); }
}
await browser.close();
console.log(`\nm10-train: ${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
