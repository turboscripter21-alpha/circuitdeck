// M8 suite: AI tutor, editor AI help, failure hints, recommendations, TinyML track,
// sandbox wiring checks + Explain with AI, and the in-browser ML camera.
// /api/ai is always mocked (Playwright route) — no key and no network needed.
// Usage: node tests/m8-ai.mjs [ids,comma,separated]   BASE=http://127.0.0.1:8080
//        QR_Y4M=/path/to/qr.y4m (a fake-camera video showing a QR code; the QR check is skipped without it)
import { chromium } from 'playwright';
import fs from 'fs';
import { createRequire } from 'module';
const BASE = process.env.BASE || 'http://127.0.0.1:8080';
const LOCAL = BASE.includes('127.0.0.1');
const ONLY = process.argv[2] ? process.argv[2].split(',') : null;
const O = process.env.OUT || new URL('../_compare/m8/', import.meta.url).pathname; fs.mkdirSync(O, { recursive: true });
const QR = process.env.QR_Y4M || '/workspace/pw/qr.y4m';
const ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'];
const b = await chromium.launch({ args: ARGS });
const R = {}; const errs = []; const posts = [];
const NOT_CFG = (r) => r.request().method() === 'GET' ? r.fulfill({ json: { configured: false, model: 'x' } }) : r.fulfill({ status: 503, json: { configured: false, error: 'AI not configured yet.' } });
const CFG_OK = (r) => {
  if (r.request().method() === 'GET') return r.fulfill({ json: { configured: true, model: 'mock' } });
  const body = JSON.parse(r.request().postData() || '{}'); posts.push(body);
  return r.fulfill({ json: { ok: true, text: `Mocked ${body.mode} answer: **check the resistor**.\n\n- step one\n- step two` } });
};
async function ctx(api = NOT_CFG, opt = {}) {
  const c = await (opt.browser || b).newContext({ viewport: { width: opt.w || 1440, height: opt.h || 900 } });
  c.setDefaultTimeout(120000);
  if (opt.init) await c.addInitScript(opt.init);
  if (LOCAL) await c.route(() => true, (r) => { const u = r.request().url(); if (u.startsWith(BASE) || /^(blob|data):/.test(u)) return r.continue(); return r.abort(); });
  await c.route('**/api/ai', api);
  return c;
}
async function page(c, tag) {
  const p = await c.newPage();
  p.on('pageerror', (e) => errs.push(tag + ' pageerror ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(tag + ' console ' + m.text().slice(0, 200)); });
  return p;
}
const ready = (p) => p.waitForFunction(() => !document.documentElement.classList.contains('is-loading'), null, { timeout: 120000 }).then(() => p.waitForTimeout(1200));
async function t(id, fn) {
  if (ONLY && !ONLY.includes(id)) return;
  const t0 = Date.now();
  try { const r = await fn(); R[id] = { pass: !!r.pass, ...r, ms: Date.now() - t0 }; }
  catch (e) { R[id] = { pass: false, error: String(e.message).slice(0, 300) }; }
  console.log(R[id].pass ? 'PASS' : 'FAIL', id, JSON.stringify(R[id]).slice(0, 400));
}

// 1. the serverless function itself: no key → GET configured:false, POST 503 (never calls out)
await t('api-no-key', async () => {
  const require = createRequire(import.meta.url);
  const saved = process.env.GEMINI_API_KEY; delete process.env.GEMINI_API_KEY;
  const h = require('../api/ai.js');
  const call = (method, body) => new Promise((res) => {
    const out = { headers: {} };
    const resp = { statusCode: 0, setHeader: (k, v) => { out.headers[k] = v; }, end: (s) => res({ status: resp.statusCode, json: JSON.parse(s), headers: out.headers }) };
    h({ method, headers: { host: 'x' }, body }, resp);
  });
  const g = await call('GET'); const p = await call('POST', { mode: 'chat', question: 'hi' });
  const pr = h._test.buildPrompt({ mode: 'wiring', context: { track: 'Sandbox', issues: 'LED has no resistor' } });
  if (saved !== undefined) process.env.GEMINI_API_KEY = saved;
  const src = fs.readFileSync(new URL('../api/ai.js', import.meta.url), 'utf8');
  const client = ['shared/ai.js', 'shared/chrome.js'].map((f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')).join('');
  return { pass: g.status === 200 && g.json.configured === false && p.status === 503 && p.json.configured === false && pr.mode === 'wiring' && /wiring_checks/.test(pr.contents.at(-1).parts[0].text) && src.includes('process.env.GEMINI_API_KEY') && !/AIza|GEMINI_API_KEY/.test(client), get: g.json, post: p.status };
});

// 2. tutor, not configured: friendly banner + note, nothing breaks
await t('tutor-not-configured', async () => {
  const c = await ctx(NOT_CFG); const p = await page(c, 'notcfg');
  await p.goto(BASE + '/pi5/#blink'); await ready(p);
  await p.click('[data-cd-ai]');
  await p.waitForSelector('aside.cd-ai:not([hidden]) .cd-ai-banner:not([hidden])');
  const banner = await p.textContent('.cd-ai-banner');
  await p.fill('aside.cd-ai textarea', 'Why does the LED need a resistor?'); await p.keyboard.press('Enter');
  await p.waitForSelector('.cd-ai-msg.is-note');
  const note = await p.textContent('.cd-ai-msg.is-note');
  await p.screenshot({ path: O + 'tutor-not-configured.png' });
  await c.close();
  return { pass: /AI not configured yet/.test(banner) && /AI not configured yet/.test(note), banner: banner.slice(0, 60) };
});

// 3. tutor + editor AI help, configured (mocked): answer rendered as markdown, context sent
await t('editor-ai-help', async () => {
  posts.length = 0;
  const c = await ctx(CFG_OK); const p = await page(c, 'editor');
  await p.goto(BASE + '/pi5/#blink'); await ready(p);
  await p.click('.cd-ai-btn');
  const items = await p.$$eval('.cd-ai-menu:not([hidden]) [role=menuitem]', (a) => a.map((x) => x.textContent));
  await p.click('.cd-ai-menu [data-mode=explain]');
  await p.waitForFunction(() => /Mocked explain answer/.test(document.querySelector('.cd-ai-log')?.innerText || ''));
  const html = await p.$eval('.cd-ai-log', (e) => e.innerHTML);
  const banner = await p.$eval('.cd-ai-banner', (e) => e.hidden);
  await p.screenshot({ path: O + 'editor-explain.png' });
  await c.close();
  const body = posts[0] || {};
  return { pass: items.length === 3 && /<b>check the resistor<\/b>/.test(html) && /<ul>/.test(html) && banner && body.mode === 'explain' && /LED|led/.test(body.context?.code || '') && body.context?.track === 'Pi 5' && body.context?.lang === 'python', items, track: body.context?.track };
});

// 4. a failing run raises the hint toast; "Get a hint" asks in hint mode
await t('failure-toast', async () => {
  posts.length = 0;
  const c = await ctx(CFG_OK); const p = await page(c, 'toast');
  await p.goto(BASE + '/pi5/#blink'); await ready(p);
  await p.evaluate(() => { const l = document.querySelector('.console-lines'); const d = document.createElement('div'); d.className = 'cd-err'; d.textContent = 'Traceback: GPIOZeroError: pin GPIO17 is already in use'; l.appendChild(d); });
  await p.waitForSelector('.cd-ai-toast:not([hidden])', { timeout: 5000 });
  const txt = await p.textContent('.cd-ai-toast');
  await p.click('.cd-ai-toast [data-t=hint]');
  await p.waitForFunction(() => /Mocked hint answer/.test(document.querySelector('.cd-ai-log')?.innerText || ''));
  await c.close();
  return { pass: /hit a problem/.test(txt) && posts[0]?.mode === 'hint' && /already in use/.test(posts[0]?.context?.output || ''), toast: txt.slice(0, 80) };
});

// 5. "Recommended next" on the ESP32 home, the gallery and a track page
await t('recommended-next', async () => {
  const c = await ctx(NOT_CFG, { init: () => { try { if (!sessionStorage.getItem('m8')) { sessionStorage.setItem('m8', 1); localStorage.setItem('circuitdeck:pi5:done', JSON.stringify(['blink'])); localStorage.removeItem('circuitdeck:rec-hidden'); } } catch {} } });
  const p = await page(c, 'rec');
  await p.goto(BASE + '/'); await ready(p);
  await p.waitForSelector('.lessons .cd-rec a', { timeout: 15000 });
  const home = await p.textContent('.lessons .cd-rec');
  await p.goto(BASE + '/gallery/'); await p.waitForSelector('.cd-rec-g .cd-rec-main', { timeout: 15000 });
  const gal = await p.textContent('.cd-rec-g');
  const galHref = await p.getAttribute('.cd-rec-g .cd-rec-main', 'href');
  await p.screenshot({ path: O + 'gallery-rec.png' });
  await p.goto(BASE + '/tinyml/'); await ready(p);
  await p.waitForSelector('.lessons .cd-rec a', { timeout: 15000 });
  const tmHref = await p.getAttribute('.lessons .cd-rec a', 'href');
  await c.close();
  return { pass: /Recommended next/.test(home) && /Recommended next/.test(gal) && /Also good/.test(gal) && /^\/(pi5\/|tinyml\/)?#/.test(galHref) && /^\/(pi5\/|tinyml\/)?#[\w-]+$/.test(tmHref) && tmHref !== '/tinyml/#hello-tinyml', home: home.slice(0, 90), galHref, tmHref };
});

// 6. TinyML track: six projects run (0 errors) and are marked done; gallery filter
await t('tinyml-track', async () => {
  const c = await ctx(NOT_CFG); const p = await page(c, 'tinyml');
  await p.goto(BASE + '/tinyml/'); await ready(p);
  const ids = await p.evaluate(() => __pi5.PROJECTS.map((x) => x.id));
  const out = {};
  for (const id of ids) {
    await p.evaluate((id) => { location.hash = id; }, id); await p.waitForTimeout(900);
    await p.evaluate(() => { __pi5.start(); }); await p.waitForTimeout(3200);
    out[id] = await p.evaluate(() => [...document.querySelectorAll('.console-lines > *')].map((d) => d.textContent).filter(Boolean).slice(-1)[0] || '');
    await p.evaluate(() => __pi5.stop());
  }
  const done = await p.evaluate(() => JSON.parse(localStorage.getItem('circuitdeck:tinyml:done') || '[]'));
  const ai = await p.evaluate(() => window.__cdAIContext());
  const sw = await p.$$eval('.cd-tracks a', (a) => a.map((x) => x.textContent.trim()));
  await p.evaluate(() => { location.hash = 'keyword-spotting'; }); await p.waitForTimeout(900);
  await p.evaluate(() => { __pi5.start(); }); await p.waitForTimeout(800);
  await p.selectOption('[data-input=word]', 'yes'); await p.waitForTimeout(2500);
  const kws = await p.evaluate(() => [...document.querySelectorAll('.console-lines > *')].map((d) => d.textContent).join('\n'));
  await p.screenshot({ path: O + 'tinyml-keyword.png' });
  await p.goto(BASE + '/gallery/?track=tinyml'); await p.waitForFunction(() => window.__gallery);
  const cnt = await p.textContent('#g-count');
  await c.close();
  return { pass: ids.length === 6 && done.length === 6 && ai.track === 'tinyml' && ai.id === 'quantize-int8' && ai.lang === 'python' && sw.includes('TinyML') && /Heard: yes/.test(kws) && cnt.startsWith('6 of'), ids, done: done.length, track: ai.track, lang: ai.lang, kws: /Heard: yes/.test(kws), last: out, count: cnt };
});

// 7. sandbox: extended wiring checks + Explain with AI (issues reach the tutor)
await t('sandbox-explain', async () => {
  posts.length = 0;
  const c = await ctx(CFG_OK); const p = await page(c, 'sandbox');
  await p.goto(BASE + '/sandbox/'); await ready(p);
  const issues = await p.evaluate(() => {
    __sb.load({ v: 1, board: 'pi5', name: 'Bad', parts: [{ id: 'led', type: 'led', opts: { color: 'red' } }, { id: 'r', type: 'resistor', opts: { ohms: '10k' } }, { id: 'b', type: 'button' }, { id: 'oled', type: 'oled' }], wires: [['GPIO17', 'r.1'], ['r.2', 'led.A'], ['led.K', 'GND@9'], ['GPIO27', 'b.1'], ['b.2', '5V@2'], ['oled.SDA', 'GPIO3'], ['oled.SCL', 'GPIO2'], ['oled.VCC', '3V3@1'], ['oled.GND', 'GND@14']] });
    return __sb.issues.map((i) => `${i.sev}: ${i.msg}`);
  });
  await p.evaluate(() => document.querySelector('[data-act="checks"]')?.click()); await p.waitForTimeout(300);
  await p.click('.cd-ai-explain');
  await p.waitForFunction(() => /Mocked wiring answer/.test(document.querySelector('.cd-ai-log')?.innerText || ''));
  await p.screenshot({ path: O + 'sandbox-explain.png' });
  await c.close();
  const errN = issues.filter((x) => x.startsWith('error')).length;
  return { pass: errN >= 2 && issues.some((x) => /5 ?V/.test(x)) && issues.some((x) => /SDA|SCL/.test(x)) && posts[0]?.mode === 'wiring' && typeof posts[0]?.context?.issues === 'string' && posts[0].context.issues.length > 20, issues };
});

// 8. ML camera: MediaPipe on the fake webcam in the TinyML person detector and the sandbox AI camera
await t('ml-camera', async () => {
  const c = await ctx(NOT_CFG); const p = await page(c, 'mlcam');
  await p.goto(BASE + '/tinyml/#person-detection'); await ready(p);
  await p.click('.cd-ml-btn');
  await p.waitForFunction(() => (__pi5.live?.frames || 0) > 5, null, { timeout: 60000 });
  await p.evaluate(() => { __pi5.start(); });
  await p.waitForFunction(() => [...document.querySelectorAll('.console-lines > *')].some((d) => /from your webcam/.test(d.textContent)), null, { timeout: 30000 }).catch(() => {});
  const lines = await p.evaluate(() => [...document.querySelectorAll('.console-lines > *')].map((d) => d.textContent).slice(-3));
  const live = await p.evaluate(() => ({ ready: __pi5.live.ready, frames: __pi5.live.frames, mode: __pi5.live.mode }));
  await p.screenshot({ path: O + 'tinyml-webcam.png' });
  await p.goto(BASE + '/sandbox/'); await ready(p);
  await p.evaluate(() => __sb.loadTemplate('ai-camera'));
  await p.waitForSelector('.cd-ml-btn'); await p.click('.cd-ml-btn');
  await p.waitForFunction(() => (__sb.inputs.__live?.frames || 0) > 5, null, { timeout: 60000 });
  await c.close();
  return { pass: live.ready && live.frames > 5 && lines.some((l) => /from your webcam/.test(l)), live, lines };
});

// 9. QR decoding (jsQR) from a fake-camera video in the Pi 5 QR project
await t('ml-qr', async () => {
  if (!fs.existsSync(QR)) return { pass: true, skipped: `no ${QR}` };
  const bq = await chromium.launch({ args: [...ARGS, `--use-file-for-fake-video-capture=${QR}`] });
  const c = await ctx(NOT_CFG, { browser: bq }); const p = await page(c, 'qr');
  await p.goto(BASE + '/pi5/#qr'); await ready(p);
  await p.click('.cd-ml-btn');
  await p.waitForFunction(() => !!__pi5.live?.qr, null, { timeout: 60000 });
  const qr = await p.evaluate(() => __pi5.live.qr);
  await p.evaluate(() => { __pi5.start(); });
  await p.waitForFunction(() => /circuitdeck\.vercel\.app/.test(document.querySelector('.console-lines')?.textContent || ''), null, { timeout: 30000 }).catch(() => {});
  const lines = await p.evaluate(() => [...document.querySelectorAll('.console-lines > *')].map((d) => d.textContent).join('\n'));
  await bq.close();
  return { pass: qr === 'https://circuitdeck.vercel.app' && /circuitdeck\.vercel\.app/.test(lines), qr };
});

await b.close();
const ok = Object.values(R).every((r) => r.pass) && !errs.length;
fs.writeFileSync(O + 'm8-results.json', JSON.stringify({ R, errs }, null, 1));
console.log(`\n${Object.values(R).filter((r) => r.pass).length}/${Object.keys(R).length} passed · console/page errors: ${errs.length}`);
if (errs.length) console.log(errs.slice(0, 20).join('\n'));
process.exit(ok ? 0 : 1);
