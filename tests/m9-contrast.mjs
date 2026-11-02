// WCAG contrast audit: every visible text node vs its effective background (solid colours only).
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://127.0.0.1:8080';
const pages = (process.argv[2] || '/gallery/,/pi5/#blink,/sandbox/#t=traffic-light,/#blink').split(',');
const themes = (process.argv[3] || 'light,dark').split(',');
const W = +(process.argv[4] || 1280), H = +(process.argv[5] || 800);
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let fails = 0;
for (const theme of themes) for (const path of pages) {
  const c = await b.newContext({ viewport: { width: W, height: H } });
  c.setDefaultTimeout(120000);
  await c.addInitScript((t) => { try { localStorage.setItem('circuitdeck:theme', t); } catch {} }, theme);
  const p = await c.newPage();
  await p.goto(BASE + path);
  await p.waitForFunction(() => !document.documentElement.classList.contains('is-loading'), null, { timeout: 120000 }).catch(() => {});
  await p.waitForTimeout(2500);
  const res = await p.evaluate(() => {
    const parse = (s) => { const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return null; const v = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: v[0], g: v[1], b: v[2], a: v[3] ?? 1 }; };
    const lum = ({ r, g, b }) => { const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const blend = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 });
    function bgOf(el) {
      const stack = [];
      for (let e = el; e; e = e.parentElement) {
        const s = getComputedStyle(e);
        if (s.backgroundImage && s.backgroundImage !== 'none' && !/gradient/.test(s.backgroundImage)) return null; // image: skip
        if (/gradient/.test(s.backgroundImage)) { const m = s.backgroundImage.match(/rgba?\([^)]+\)/g); if (m) { stack.push(parse(m[m.length - 1])); if (stack.at(-1).a >= 1) break; } }
        const c = parse(s.backgroundColor); if (c && c.a > 0) { stack.push(c); if (c.a >= 1) break; }
      }
      let bg = { r: 255, g: 255, b: 255, a: 1 };
      for (let i = stack.length - 1; i >= 0; i--) bg = blend(stack[i], bg);
      return bg;
    }
    const out = []; const seen = new Set();
    const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n; (n = tw.nextNode());) {
      const t = n.textContent.trim(); if (!t) continue;
      const el = n.parentElement; if (!el || seen.has(el)) continue; seen.add(el);
      if (el.closest('svg, canvas, .schematic-card, [aria-hidden=true], .cd-code, .code-card pre, .tag')) continue; // 3D tags sit over the canvas
      const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
      if (r.width < 1 || r.height < 1 || s.visibility === 'hidden' || +s.opacity === 0 || r.bottom < 0 || r.top > innerHeight) continue;
      let op = 1; for (let e = el; e; e = e.parentElement) op *= +getComputedStyle(e).opacity; if (op < 0.5) continue;
      if (el.closest('[disabled], .is-hidden, [hidden]')) continue;
      const fg = parse(s.color); const bg = bgOf(el); if (!fg || !bg) continue;
      const f = blend(fg, bg); const L1 = lum(f), L2 = lum(bg); const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
      const px = parseFloat(s.fontSize), bold = +s.fontWeight >= 700 || s.fontWeight === 'bold';
      const large = px >= 24 || (bold && px >= 18.66);
      const need = large ? 3 : 4.5;
      if (ratio < need) out.push({ text: t.slice(0, 40), cls: (el.className?.baseVal ?? el.className) + '', tag: el.tagName, ratio: +ratio.toFixed(2), need, color: s.color, px });
    }
    return out;
  });
  // de-duplicate by class+color
  const uniq = new Map(); for (const r of res) { const k = r.cls + r.color + r.need; if (!uniq.has(k)) uniq.set(k, { ...r, n: 1 }); else uniq.get(k).n++; }
  console.log(`${theme} ${path}: ${res.length} low-contrast text elements`);
  for (const r of uniq.values()) console.log(`  ${r.ratio}<${r.need} ${r.tag}.${r.cls.slice(0, 40)} "${r.text}" ${r.color} ${r.px}px ×${r.n}`);
  fails += res.length;
  await c.close();
}
await b.close();
console.log('TOTAL', fails);
process.exit(fails ? 1 : 0);
