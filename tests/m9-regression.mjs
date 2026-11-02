// M9 regression suite: one check per bug fixed from BUGS.md (M1-M3, m1-m20, perf).
// Usage: node tests/m9-regression.mjs [only-ids,comma,separated]   BASE=http://127.0.0.1:8080  (playwright must be resolvable, e.g. NODE_PATH)
import { chromium } from 'playwright';
import fs from 'fs';
const BASE = process.env.BASE || 'http://127.0.0.1:8080';
const LOCAL = BASE.includes('127.0.0.1');
const ONLY = process.argv[2] ? process.argv[2].split(',') : null;
const O = process.env.OUT || new URL('../_compare/m9/', import.meta.url).pathname; fs.mkdirSync(O, { recursive: true });
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const R = {}; const errs = [];
async function ctx(opt = {}) {
  const { mobile, w = 1280, h = 800, theme } = opt;
  const c = await b.newContext(mobile ? { viewport: { width: w || 390, height: h || 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : { viewport: { width: w, height: h } });
  c.setDefaultTimeout(120000);
  if (theme) await c.addInitScript((t) => { try { localStorage.setItem('circuitdeck:theme', t); } catch {} }, theme);
  if (LOCAL) await c.route(() => true, (r) => { const u = r.request().url(); if (u.startsWith(BASE) || /^(blob|data):/.test(u)) return r.continue(); return r.abort(); });
  return c;
}
async function page(c, tag) {
  const p = await c.newPage();
  p.on('pageerror', (e) => errs.push(tag + ' pageerror ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(tag + ' console ' + m.text()); });
  return p;
}
const ready = (p) => p.waitForFunction(() => !document.documentElement.classList.contains('is-loading'), null, { timeout: 120000 }).then(() => p.waitForTimeout(1200));
async function t(id, fn) {
  if (ONLY && !ONLY.includes(id)) return;
  const t0 = Date.now();
  try { const r = await fn(); R[id] = { pass: !!r.pass, ...r, ms: Date.now() - t0 }; }
  catch (e) { R[id] = { pass: false, error: String(e.message).slice(0, 300) }; }
  console.log(id, R[id].pass ? 'PASS' : 'FAIL', JSON.stringify(R[id]).slice(0, 300));
}
const sbNotice = (p) => p.evaluate(() => document.querySelector('.sb-notice')?.textContent || '');

// ---------------- Sandbox
await t('M1', async () => {
  const c = await ctx(); const p = await page(c, 'M1');
  await p.goto(BASE + '/sandbox/#t=traffic-light'); await ready(p);
  await p.locator('[data-act=name]').fill('MY PRECIOUS WORK'); await p.locator('[data-act=name]').press('Tab');
  await p.evaluate(() => window.__sb.addPart('led')); await p.waitForTimeout(500);
  const before = await p.evaluate(() => JSON.parse(localStorage.getItem('circuitdeck:sandbox:current')).name);
  // a template link (as from a gallery card), then a share link, both in a fresh load
  await p.goto(BASE + '/sandbox/#t=robot-car'); await ready(p);
  const n1 = await sbNotice(p);
  const saves1 = await p.evaluate(() => JSON.parse(localStorage.getItem('circuitdeck:sandbox:saves') || '[]').map((s) => s.name));
  const kept = saves1.find((n) => n.startsWith('MY PRECIOUS WORK (autosave'));
  const keptParts = await p.evaluate((n) => JSON.parse(localStorage.getItem('circuitdeck:sandbox:saves')).find((s) => s.name === n)?.circuit.parts.length, kept);
  // edit the robot car, then open a share link of something else via hashchange
  await p.evaluate(() => window.__sb.addPart('led')); await p.waitForTimeout(300);
  await p.evaluate(() => { location.hash = '#t=weather-station'; }); await ready(p);
  const n2 = await sbNotice(p);
  const saves2 = await p.evaluate(() => JSON.parse(localStorage.getItem('circuitdeck:sandbox:saves') || '[]').map((s) => s.name));
  // unchanged template + reopen: no extra autosave entries
  await p.evaluate(() => { location.hash = '#t=blink-esp32'; }); await ready(p);
  const saves3 = await p.evaluate(() => JSON.parse(localStorage.getItem('circuitdeck:sandbox:saves') || '[]').length);
  await p.screenshot({ path: O + 'M1-kept.png' }); await c.close();
  return { before, kept, keptParts, n1: n1.slice(0, 160), n2: n2.slice(0, 200), saves2, saves3, pass: before === 'MY PRECIOUS WORK' && !!kept && keptParts >= 4 && /kept in My saves/.test(n1) && saves2.some((n) => /^Robot car \(autosave/i.test(n)) && /kept in My saves/.test(n2) && saves3 === saves2.length };
});
await t('m2', async () => {
  const c = await ctx(); const p = await page(c, 'm2');
  await p.goto(BASE + '/sandbox/#t=traffic-light'); await ready(p);
  await p.locator('.lesson').nth(1).focus(); await p.keyboard.press('Space'); await p.waitForTimeout(2500);
  const r = await p.evaluate(() => ({ running: window.__sb.running, name: window.__sb.circuit.name, hash: location.hash }));
  await c.close(); return { ...r, pass: !r.running && /weather/i.test(r.name) };
});
await t('m3', async () => {
  const c = await ctx(); const p = await page(c, 'm3');
  await p.goto(BASE + '/sandbox/#t=traffic-light'); await ready(p);
  await p.locator('[data-nav=parts]').click(); await p.waitForTimeout(500);
  await p.locator('.sb-search').fill('zzzz'); await p.waitForTimeout(300);
  const r = await p.evaluate(() => ({ cats: [...document.querySelectorAll('#flyout .sb-cat')].filter((h) => !h.hidden && h.offsetParent).length, none: document.querySelector('#flyout .sb-none:not([hidden])')?.textContent || '' }));
  await p.screenshot({ path: O + 'm3-nomatch.png' });
  await p.locator('.sb-search').fill('led'); await p.waitForTimeout(300);
  const r2 = await p.evaluate(() => ({ cats: [...document.querySelectorAll('#flyout .sb-cat')].filter((h) => !h.hidden && h.offsetParent).length, none: !!document.querySelector('#flyout .sb-none:not([hidden])') }));
  await c.close(); return { ...r, after: r2, pass: r.cats === 0 && /No parts match/.test(r.none) && r2.cats > 0 && !r2.none };
});
await t('m1', async () => {
  const c = await ctx(); const p = await page(c, 'm1');
  await p.goto(BASE + '/sandbox/#t=traffic-light'); await ready(p);
  const dialogs = []; let accept = false;
  p.on('dialog', (d) => { dialogs.push(d.message()); accept ? d.accept() : d.dismiss(); });
  await p.locator('[data-act=save]').click(); await p.waitForTimeout(300);
  await p.evaluate(() => window.__sb.addPart('led')); await p.waitForTimeout(300);
  await p.locator('[data-act=save]').click(); await p.waitForTimeout(300);
  const n1 = await sbNotice(p);
  const s1 = await p.evaluate(() => JSON.parse(localStorage.getItem('circuitdeck:sandbox:saves')).map((s) => s.circuit.parts.length));
  accept = true; await p.locator('[data-act=save]').click(); await p.waitForTimeout(300);
  const s2 = await p.evaluate(() => JSON.parse(localStorage.getItem('circuitdeck:sandbox:saves')).map((s) => s.circuit.parts.length));
  await c.close();
  return { dialogs, n1: n1.slice(0, 100), s1, s2, pass: dialogs.length === 2 && /already in My saves/.test(dialogs[0]) && /Not saved/.test(n1) && s1.length === 1 && s2.length === 1 && s2[0] === s1[0] + 1 };
});
await t('m16', async () => {
  const c = await ctx(); const p = await page(c, 'm16');
  await p.goto(BASE + '/sandbox/#t=ai-camera'); await ready(p);
  const before = await p.evaluate(() => ({ board: window.__sb.circuit.board, parts: window.__sb.circuit.parts.length, wires: window.__sb.circuit.wires.length }));
  await p.locator('[data-board=esp32]').click(); await p.waitForTimeout(800);
  const mid = await p.evaluate(() => ({ board: window.__sb.circuit.board, parts: window.__sb.circuit.parts.length, undo: !!document.querySelector('[data-act=undo-board]') }));
  await p.screenshot({ path: O + 'm16-undo.png' });
  await p.locator('[data-act=undo-board]').click(); await p.waitForTimeout(1200);
  const after = await p.evaluate(() => ({ board: window.__sb.circuit.board, parts: window.__sb.circuit.parts.length, wires: window.__sb.circuit.wires.length, saved: JSON.parse(localStorage.getItem('circuitdeck:sandbox:current')).parts.length }));
  await c.close(); return { before, mid, after, pass: mid.board === 'esp32' && mid.parts < before.parts && mid.undo && after.board === before.board && after.parts === before.parts && after.wires === before.wires && after.saved === before.parts };
});
await t('m4', async () => {
  const c = await ctx(); const p = await page(c, 'm4'); const out = {};
  for (const h of ['#c=AAAA', '#c=!!!!', '#c=']) { await p.goto(BASE + '/sandbox/' + h); await ready(p); out[h] = (await sbNotice(p)).slice(0, 160); await p.goto('about:blank'); }
  await c.close();
  const v = Object.values(out);
  return { out, pass: v.every((s) => /could not be opened/.test(s) && !/atob|Failed to|fetch|Window|DOMException/i.test(s) && /not changed/.test(s)) };
});
await t('m5', async () => {
  const c = await ctx(); const p = await page(c, 'm5');
  await c.addInitScript(() => { if (!sessionStorage.getItem('m5')) { sessionStorage.setItem('m5', '1'); localStorage.setItem('circuitdeck:sandbox:saves', JSON.stringify([{ name: 'Broken', at: 'garbage', circuit: { board: 'zzz' } }, { name: 'Null', circuit: null }, 42, { name: 'Ok', at: Date.now(), circuit: { v: 1, board: 'esp32', parts: [], wires: [] } }])); } });
  await p.goto(BASE + '/sandbox/#t=traffic-light'); await ready(p);
  await p.locator('[data-nav=lessons]').click(); await p.waitForTimeout(600);
  const txt = await p.evaluate(() => document.querySelector('#flyout')?.innerText || '');
  await p.screenshot({ path: O + 'm5-saves.png' }); await c.close();
  return { txt: txt.slice(-200), pass: !/Invalid Date|undefined|NaN/.test(txt) && /Broken/i.test(txt) && /Unknown board|date unknown/.test(txt) };
});
await t('m6', async () => {
  const c = await ctx(); const p = await page(c, 'm6');
  await p.goto(BASE + '/sandbox/#t=traffic-light'); await ready(p);
  const id = await p.evaluate(() => { const part = window.__sb.circuit.parts.find((x) => x.type !== 'cooler'); part.x = 57.5; window.__sb.inspectPart(part.id); return part.id; });
  await p.waitForTimeout(300);
  for (let i = 0; i < 4; i++) { await p.locator('#inspector [data-nudge="1,0"]').click(); await p.waitForTimeout(150); }
  const x = await p.evaluate((id) => window.__sb.circuit.parts.find((q) => q.id === id).x, id);
  const flash = await p.evaluate(() => document.body.innerText.includes('edge of the workbench'));
  await p.reload(); await ready(p);
  const x2 = await p.evaluate((id) => window.__sb.circuit.parts.find((q) => q.id === id)?.x, id);
  await c.close(); return { x, x2, flash, pass: x <= 58 && x >= 57.5 && x2 === x && flash };
});
await t('m14', async () => {
  const out = {};
  for (const tpl of ['traffic-light', 'weather-station', 'ai-camera']) {
    const c = await ctx({ mobile: true, theme: 'dark' }); const p = await page(c, 'm14');
    await p.goto(BASE + '/sandbox/#t=' + tpl); await ready(p); await p.waitForTimeout(1500);
    out[tpl] = await p.evaluate(() => {
      const r = [...document.querySelectorAll('.tag')].filter((e) => +getComputedStyle(e).opacity > 0.1 && e.getBoundingClientRect().width > 0).map((e) => e.getBoundingClientRect());
      let o = 0; for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++) { const a = r[i], q = r[j]; const ix = Math.min(a.right, q.right) - Math.max(a.left, q.left), iy = Math.min(a.bottom, q.bottom) - Math.max(a.top, q.top); if (ix > 2 && iy > 2) o++; }
      return { tags: r.length, overlaps: o };
    });
    if (tpl === 'traffic-light') await p.screenshot({ path: O + 'm14-sandbox-390-dark.png' });
    await c.close();
  }
  return { out, pass: Object.values(out).every((v) => v.tags > 0 && v.overlaps === 0) };
});
await t('perf-wires', async () => {
  const c = await ctx(); const p = await page(c, 'perf');
  await p.goto(BASE + '/sandbox/#t=traffic-light'); await ready(p);
  const r = await p.evaluate(() => {
    const sb = window.__sb; const ids = Object.keys(sb.insts); const g0 = sb.insts[ids[0]].group;
    const ws = sb.circuit.wires.slice(); sb.removeWire(0); const same1 = sb.insts[ids[0]].group === g0;
    const t0 = performance.now(); sb.addWire(ws[0][0], ws[0][1]); const ms = performance.now() - t0;
    return { same1, same2: sb.insts[ids[0]].group === g0, wires: sb.circuit.wires.length, n: ws.length, ms: Math.round(ms) };
  });
  await c.close(); return { ...r, pass: r.same1 && r.same2 && r.wires === r.n };
});
await t('M2-sb', async () => {
  const c = await ctx(); const p = await page(c, 'M2sb');
  await p.goto(BASE + '/sandbox/#t=traffic-light'); await ready(p);
  await p.locator('[data-nav=reference]').click(); await p.waitForTimeout(400);
  const txt = await p.evaluate(() => document.querySelector('#flyout')?.innerText || '');
  await c.close(); return { txt: txt.replace(/\s+/g, ' ').slice(0, 300), pass: /left or right button/i.test(txt) && !/Right-drag/i.test(txt) };
});

// ---------------- Pi 5
await t('M2', async () => {
  const c = await ctx(); const p = await page(c, 'M2');
  await p.goto(BASE + '/pi5/#blink'); await ready(p);
  const btn = await p.evaluate(() => ({ ...window.__pi5.stage.controls.mouseButtons, touches: window.__pi5.stage.controls.touches }));
  const pos = () => p.evaluate(() => { const s = window.__pi5.stage; return [s.camera.position.x, s.camera.position.y, s.camera.position.z, s.controls.target.x].map((v) => +v.toFixed(3)); });
  await p.locator('#board-canvas, .stage canvas').first().click({ position: { x: 300, y: 300 } }).catch(() => {});
  await p.waitForTimeout(300); const p0 = await pos();
  await p.keyboard.down('KeyD'); await p.waitForTimeout(700); await p.keyboard.up('KeyD'); await p.waitForTimeout(300);
  const p1 = await pos();
  await p.keyboard.down('ArrowUp'); await p.waitForTimeout(500); await p.keyboard.up('ArrowUp'); await p.waitForTimeout(300);
  const p2 = await pos();
  // left drag pans (target moves), it does not orbit
  const box = await p.locator('.stage canvas').first().boundingBox();
  const t0 = await p.evaluate(() => window.__pi5.stage.controls.target.toArray().map((v) => +v.toFixed(3)));
  // start the drag on bare canvas (the earlier focus click may have opened the inspector card)
  const sp = await p.evaluate((b) => { for (let y = b.y + 60; y < b.y + b.height - 60; y += 40) for (let x = b.x + 60; x < b.x + b.width - 200; x += 40) { if (document.elementFromPoint(x, y)?.tagName === 'CANVAS') return { x, y }; } return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }, box);
  await p.mouse.move(sp.x, sp.y); await p.mouse.down(); await p.mouse.move(sp.x + 120, sp.y + 40, { steps: 8 }); await p.mouse.up(); await p.waitForTimeout(400);
  const t1 = await p.evaluate(() => window.__pi5.stage.controls.target.toArray().map((v) => +v.toFixed(3)));
  await p.locator('[data-nav=reference]').click(); await p.waitForTimeout(400);
  const txt = await p.evaluate(() => document.querySelector('#flyout')?.innerText || '');
  await c.close();
  const moved = (a, q) => a.some((v, i) => Math.abs(v - q[i]) > 0.01);
  return { btn, p0, p1, p2, t0, t1, txt: txt.replace(/\s+/g, ' ').slice(0, 200), pass: btn.LEFT === 2 && btn.RIGHT === 2 && btn.MIDDLE === 0 && moved(p0, p1) && moved(p1, p2) && moved(t0, t1) && /left or right button/i.test(txt) };
});
await t('M3', async () => {
  const c = await ctx(); const p = await page(c, 'M3');
  await p.goto(BASE + '/pi5/#blink'); await ready(p);
  await p.locator('[data-nav=parts]').click(); await p.waitForTimeout(500);
  const a = await p.evaluate(() => [...document.querySelectorAll('#flyout .cd-parts b')].map((e) => e.textContent));
  await p.evaluate(() => { location.hash = '#button'; }); await p.waitForTimeout(3000);
  const r = await p.evaluate(() => ({ list: [...document.querySelectorAll('#flyout .cd-parts b')].map((e) => e.textContent), want: window.__pi5.project.parts.map((x) => x.label), open: !!document.querySelector('#flyout.is-open, #flyout:not([hidden])'), id: window.__pi5.project.id }));
  await p.screenshot({ path: O + 'M3-fresh-flyout.png' }); await c.close();
  return { a, ...r, pass: r.id === 'button' && JSON.stringify(r.list) === JSON.stringify(r.want) && JSON.stringify(r.list) !== JSON.stringify(a) };
});
await t('m10', async () => {
  const c = await ctx(); const p = await page(c, 'm10');
  await p.goto(BASE + '/pi5/#blink'); await ready(p);
  await p.locator('[data-nav=parts]').click(); await p.waitForTimeout(500);
  await p.locator('#flyout .switch').first().click(); await p.waitForTimeout(800);
  const r1 = await p.evaluate(() => ({ restore: !!document.querySelector('#flyout [data-restore]'), head: document.querySelector('#flyout')?.innerText.match(/\d+\/\d+ in use/)?.[0] }));
  await p.locator('#flyout [data-restore]').click(); await p.waitForTimeout(800);
  const r2 = await p.evaluate(() => ({ restore: !!document.querySelector('#flyout [data-restore]'), checked: [...document.querySelectorAll('#flyout [data-part]')].every((i) => i.checked) }));
  await c.close(); return { r1, r2, pass: r1.restore && r1.head === '1/2 in use' && !r2.restore && r2.checked };
});
await t('m11', async () => {
  const c = await ctx(); const p = await page(c, 'm11');
  await p.goto(BASE + '/pi5/#nope'); await ready(p);
  const r = await p.evaluate(() => ({ hash: location.hash, id: window.__pi5.project.id }));
  await p.evaluate(() => { location.hash = '#alsobad'; }); await p.waitForTimeout(2000);
  const r2 = await p.evaluate(() => ({ hash: location.hash, id: window.__pi5.project.id }));
  await c.close(); return { r, r2, pass: r.hash === '#' + r.id && r2.hash === '#' + r2.id };
});
await t('m12', async () => {
  const c = await ctx(); const p = await page(c, 'm12');
  await c.addInitScript(() => { if (!sessionStorage.getItem('m12')) { sessionStorage.setItem('m12', '1'); localStorage.setItem('circuitdeck:pi5:done', JSON.stringify(['board', 'blink'])); } });
  await p.goto(BASE + '/pi5/#blink'); await ready(p);
  const dialogs = []; let accept = false; p.on('dialog', (d) => { dialogs.push(d.message()); accept ? d.accept() : d.dismiss(); });
  await p.locator('[data-nav=settings]').click(); await p.waitForTimeout(400);
  await p.locator('#flyout [data-reset]').click(); await p.waitForTimeout(400);
  const kept = await p.evaluate(() => localStorage.getItem('circuitdeck:pi5:done'));
  accept = true; await p.locator('#flyout [data-reset]').click().catch(() => {}); await p.waitForTimeout(600);
  const after = await p.evaluate(() => localStorage.getItem('circuitdeck:pi5:done'));
  await c.close(); return { dialogs, kept, after, pass: dialogs.length === 2 && /cannot be undone/.test(dialogs[0]) && JSON.parse(kept).length === 2 && JSON.parse(after || '[]').length === 0 };
});
await t('m13', async () => {
  const out = {};
  for (const [w, h] of [[360, 740], [390, 844]]) {
    const c = await ctx({ mobile: true, w, h }); const p = await page(c, 'm13');
    await p.goto(BASE + '/pi5/'); await ready(p); await p.waitForTimeout(800);
    out[w] = await p.evaluate(() => { const l = document.querySelector('.lesson-list'); const first = l.querySelector('.lesson'); return { scrollLeft: Math.round(l.scrollLeft), cardLeft: Math.round(first.getBoundingClientRect().left), listLeft: Math.round(l.getBoundingClientRect().left) }; });
    if (w === 360) await p.screenshot({ path: O + 'm13-pi5-360.png' });
    // a later project is still scrolled into view
    await p.evaluate(() => { location.hash = '#' + window.__pi5.PROJECTS[10].id; }); await p.waitForTimeout(2500);
    out[w].later = await p.evaluate(() => { const l = document.querySelector('.lesson-list'); const a = l.querySelector('.lesson.is-active').getBoundingClientRect(), r = l.getBoundingClientRect(); return { visible: a.left >= r.left - 1 && a.right <= r.right + 1 }; });
    await c.close();
  }
  return { out, pass: Object.values(out).every((v) => v.scrollLeft === 0 && v.cardLeft >= v.listLeft && v.later.visible) };
});
await t('m2-pi5', async () => {
  const c = await ctx(); const p = await page(c, 'm2pi');
  await p.goto(BASE + '/pi5/#blink'); await ready(p);
  const want = await p.evaluate(() => window.__pi5.PROJECTS[2].id);
  await p.locator('.lesson').nth(2).focus(); await p.keyboard.press('Space'); await p.waitForTimeout(2500);
  const r = await p.evaluate(() => ({ id: window.__pi5.project.id, hash: location.hash }));
  await c.close(); return { want, ...r, pass: r.id === want && r.hash === '#' + want };
});

// ---------------- Gallery
const gal = async (path) => { const c = await ctx(); const p = await page(c, 'gallery'); await p.goto(BASE + path); await p.waitForTimeout(1500); const r = await p.evaluate(() => ({ count: document.querySelector('.g-count')?.textContent.trim(), pressed: [...document.querySelectorAll('.chip[aria-pressed=true]')].map((e) => e.textContent.trim()), titles: [...document.querySelectorAll('.card h3')].filter((e) => e.offsetParent).map((e) => e.textContent.trim()).slice(0, 5), url: location.search })); return { c, p, r }; };
await t('m7', async () => {
  const { c, p, r } = await gal('/gallery/?q=servo&track=esp32');
  const blurbs = await p.evaluate(() => [...document.querySelectorAll('.card')].filter((e) => e.offsetParent).slice(0, 3).map((e) => e.querySelector('p')?.textContent.trim() || ''));
  await p.screenshot({ path: O + 'm7-servo-esp32.png' }); await c.close();
  const n = +(r.count || '').split(' ')[0];
  return { ...r, blurbs, pass: n >= 2 && r.titles.some((x) => /barrier|servo/i.test(x)) && blurbs.every((s) => s.length > 20) };
});
await t('m8', async () => {
  const a = await gal('/gallery/?track=bogus&level=nonsense'); await a.c.close();
  const bb = await gal('/gallery/?level=beginner&track=PI5'); await bb.c.close();
  return { bogus: a.r, lower: bb.r, pass: a.r.count === '61 of 61' && a.r.pressed.length === 2 && +bb.r.count.split(' ')[0] > 0 && bb.r.pressed.some((x) => /beginner/i.test(x)) && bb.r.pressed.some((x) => /pi/i.test(x)) };
});
await t('m9', async () => {
  const c = await ctx(); const p = await page(c, 'm9'); await p.goto(BASE + '/gallery/'); await p.waitForTimeout(1200);
  const r = await p.evaluate(() => { const i = document.querySelector('.g-search input'); const s = getComputedStyle(i); const cv = document.createElement('canvas').getContext('2d'); cv.font = `${s.fontWeight} ${s.fontSize} ${s.fontFamily}`; const need = cv.measureText(i.placeholder).width; const have = i.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight); return { need: Math.ceil(need), have: Math.floor(have), ph: i.placeholder }; });
  await c.close(); return { ...r, pass: r.have >= r.need };
});
await t('m15', async () => {
  const c = await ctx(); const p = await page(c, 'm15'); await p.goto(BASE + '/gallery/data.json');
  const d = JSON.parse(await p.evaluate(() => document.body.innerText)); await c.close();
  const e = (d.items || d).filter((x) => x.track === 'esp32');
  const want = ['Guard the fridge', 'Laser barrier gate', 'Ultrasonic radar', 'Build a mini piano'];
  return { n: e.length, sample: e.slice(0, 4).map((x) => x.title), pass: e.length === 20 && want.every((w) => e.some((x) => x.title === w)) && e.every((x) => x.short && x.topics?.length) };
});
await t('m20', async () => {
  const c = await ctx(); const p = await page(c, 'm20'); await p.goto(BASE + '/gallery/');
  const m = await p.evaluate(() => { const g = (s) => document.querySelector(s)?.content || ''; return { locale: g('meta[property="og:locale"]'), w: g('meta[property="og:image:width"]'), h: g('meta[property="og:image:height"]'), alt: g('meta[property="og:image:alt"]'), tw: g('meta[name="twitter:image"]'), desc: g('meta[name=description]'), ogd: g('meta[property="og:description"]'), twd: g('meta[name="twitter:description"]') }; });
  await c.close(); return { ...m, pass: m.locale === 'en_US' && m.w === '1200' && m.h === '630' && !!m.alt && /og-image\.png$/.test(m.tw) && m.desc === m.ogd && m.ogd === m.twd };
});

// ---------------- ESP32 (overlay)
await t('m19', async () => {
  const c = await ctx(); const p = await page(c, 'm19');
  const st = () => p.evaluate(() => ({ hash: location.hash, active: document.querySelector('.lesson.is-active')?.getAttribute('aria-label') }));
  await p.goto(BASE + '/#radar'); await ready(p);
  await p.evaluate(() => { location.hash = '#nope'; }); await p.waitForTimeout(800); const a = await st();
  await p.evaluate(() => { location.hash = '#blink'; }); await p.waitForTimeout(1500); const bb = await st();
  await p.goBack(); await p.waitForTimeout(1500); const back = await st();
  await c.close();
  const c2 = await ctx(); const p2 = await page(c2, 'm19b'); await p2.goto(BASE + '/#zzz'); await ready(p2); await p2.waitForTimeout(1500);
  const fresh = await p2.evaluate(() => ({ hash: location.hash, active: document.querySelector('.lesson.is-active')?.getAttribute('aria-label') })); await c2.close();
  return { a, bb, back, fresh, pass: a.hash === '#radar' && /radar/i.test(a.active) && bb.hash === '#blink' && back.hash === '#radar' && fresh.hash === '#board' && /Lesson 1:/.test(fresh.active) };
});

await b.close();
const fail = Object.entries(R).filter(([, v]) => !v.pass).map(([k]) => k);
fs.writeFileSync(O + 'm9-results.json', JSON.stringify({ R, errs }, null, 1));
console.log('\nRESULT', Object.keys(R).length - fail.length, '/', Object.keys(R).length, 'pass', fail.length ? 'FAILED: ' + fail.join(',') : '', '| console errors:', errs.length);
for (const e of errs.slice(0, 20)) console.log('  ERR', e.slice(0, 200));
process.exit(fail.length || errs.length ? 1 : 0);
