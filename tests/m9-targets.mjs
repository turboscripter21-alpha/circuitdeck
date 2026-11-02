// WCAG 2.5.8: interactive targets must be >= 24x24 CSS px (inline links in text are exempt).
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://127.0.0.1:8080';
const pages = (process.argv[2] || '/#blink,/pi5/#traffic,/sandbox/#t=traffic-light,/gallery/').split(',');
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let total = 0;
for (const path of pages) {
  const D = process.env.DESK; const c = await b.newContext(D ? { viewport: { width: 1280, height: 800 } } : { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  c.setDefaultTimeout(120000);
  const p = await c.newPage();
  await p.goto(BASE + path);
  await p.waitForFunction(() => !document.documentElement.classList.contains('is-loading'), null, { timeout: 120000 }).catch(() => {});
  await p.waitForTimeout(3000);
  if (process.env.RUN) { await p.locator('.btn-run').click().catch(() => {}); await p.waitForTimeout(1500); }
  const small = await p.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea, [role=button], [role=tab], [role=slider], [tabindex]:not([tabindex="-1"])')) {
      const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
      if (r.width === 0 || r.height === 0 || s.visibility === 'hidden' || el.closest('[hidden], [aria-hidden=true]')) continue;
      if (el.tagName === 'INPUT' && /checkbox|radio/.test(el.type) && el.closest('label')) { const lr = el.closest('label').getBoundingClientRect(); if (lr.width >= 24 && lr.height >= 24) continue; }
      // inline links inside a sentence are exempt
      if (el.tagName === 'A' && s.display === 'inline' && el.parentElement && el.parentElement.textContent.trim().length > el.textContent.trim().length + 10) continue;
      if (el.classList.contains('param')) continue; // inline value inside a line of code: exempt (WCAG 2.5.8 inline)
      if (r.width < 24 || r.height < 24) out.push({ el: el.tagName + (el.className ? '.' + String(el.className).split(' ').join('.') : ''), label: (el.getAttribute('aria-label') || el.textContent || el.title || '').trim().slice(0, 30), w: Math.round(r.width), h: Math.round(r.height) });
    }
    return out;
  });
  console.log(path, small.length); for (const s of small) console.log('  ', JSON.stringify(s));
  total += small.length; await c.close();
}
await b.close(); console.log('TOTAL', total); process.exit(total ? 1 : 0);
