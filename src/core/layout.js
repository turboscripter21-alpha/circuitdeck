// Artboard layout shared by the CircuitDeck pages (Pi 5 track, sandbox).
// Mirrors the ESP32 app: a 1672x941 design artboard scaled to the window,
// or the "compact" grid layout on phones and narrow windows.
const ART_W = 1672, ART_H = 941, MIN_WIDE = 0.8, ALT_W = 1280, COMPACT_BELOW = 0.62;

// Decorative scenery around the stage (same drawing as the ESP32 track).
const SCENERY = [
  { cls: 'frame', closed: true, p: [[118,112,'lt',20],[600,112,'ct',6],[616,96,'ct',6],[744,96,'ct',6],[760,112,'ct',6],[1156,112,'rt',20],[1156,772,'rb',20],[520,772,'lb',6],[504,788,'lb',6],[274,788,'lb',6],[258,772,'lb',6],[118,772,'lb',20]] },
  { cls: 'ring-o', a: 'lt', min: 1270, circle: [563,27,5] },
  { cls: 'ring-n', a: 'lt', min: 1270, circle: [547,41,3.6] },
  { cls: 'teal', a: 'lt', min: 1270, d: 'M568 62C612 16 694 12 750 64' },
  { cls: 'dots', a: 'lt', min: 1420, dots: [770,26,7,5,15,1.4] },
  { cls: 'sun', a: 'rt', min: 1330, circle: [951,56,19] },
  { cls: 'hill', a: 'rt', min: 1330, d: 'M940 108 992 64l22 18 48-48 36 34 20-14 32 32' },
  { cls: 'cactus', a: 'rt', min: 1330, d: 'M1004 105V86M1004 98h4.5a2.5 2.5 0 0 0 2.5-2.5V92' },
  { cls: 'orange', a: 'rt', min: 1330, d: 'm1046 121 7 7 7-7' },
  { cls: 'dot-teal', a: 'lt', circle: [150,292,5] },
  { cls: 'ochre', a: 'lt', d: 'M122 334q9-11 18 0t18 0 18 0 18 0' },
  { cls: 'dots-o', a: 'lt', dots: [141,374,2,5,13,1.6] },
  { cls: 'teal', a: 'lt', d: 'M152 452v68l-30 20' },
  { cls: 'teal-soft', a: 'lt', d: 'm122 498 40 26v44l-40 24' },
  { cls: 'dots-o', a: 'lb', dots: [400,779,7,1,14,1.5] },
  { cls: 'teal', a: 'rb', d: 'M936 772l22 22h72' },
  { cls: 'dots-t', a: 'rb', dots: [1046,794,3,1,10,1.7] },
  { cls: 'orange', a: 'rb', d: 'M1096 808l14-16M1110 808l14-16' },
];
const SVGNS = 'http://www.w3.org/2000/svg';

function anchor(a, x, y, dw, dh) {
  const fx = { l: 0, c: 0.5, r: 1 }[a[0]] ?? 0;
  const fy = { t: 0, m: 0.5, b: 1 }[a[1]] ?? 0;
  return [x + dw * fx, y + dh * fy];
}

function roundedPath(points, closed) {
  const n = points.length, at = (i) => points[(i + n) % n];
  let d = '';
  for (let i = 0; i < n; i++) {
    const [x, y, r = 0] = points[i];
    if (!r || (!closed && (i === 0 || i === n - 1))) { d += `${i ? 'L' : 'M'}${x} ${y} `; continue; }
    const [px, py] = at(i - 1), [nx, ny] = at(i + 1);
    const lp = Math.hypot(px - x, py - y) || 1, ln = Math.hypot(nx - x, ny - y) || 1;
    const rr = Math.min(r, lp / 2, ln / 2);
    const a = [x + (px - x) / lp * rr, y + (py - y) / lp * rr];
    const b = [x + (nx - x) / ln * rr, y + (ny - y) / ln * rr];
    d += `${i ? 'L' : 'M'}${a.join(' ')} Q${x} ${y} ${b.join(' ')} `;
  }
  return d + (closed ? 'Z' : '');
}

function el(tag, attrs) {
  const node = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

export function drawScenery(svg, w, h) {
  if (!svg) return;
  const dw = w - ART_W, dh = h - ART_H;
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.replaceChildren();
  for (const item of SCENERY) {
    if (item.min && w < item.min) continue;
    if (item.p) {
      const pts = item.p.map(([x, y, a, r]) => [...anchor(a, x, y, dw, dh), r]);
      svg.append(el('path', { d: roundedPath(pts, item.closed), class: item.cls }));
      continue;
    }
    const [tx, ty] = anchor(item.a, 0, 0, dw, dh);
    const g = el('g', { class: item.cls, transform: `translate(${tx} ${ty})` });
    if (item.d) g.append(el('path', { d: item.d }));
    if (item.circle) { const [cx, cy, r] = item.circle; g.append(el('circle', { cx, cy, r })); }
    if (item.dots) {
      const [x, y, cols, rows, gap, r] = item.dots;
      for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) g.append(el('circle', { cx: x + i * gap, cy: y + j * gap, r }));
    }
    svg.append(g);
  }
}

// Scale the artboard to the window; returns { scale, compact }.
export function createFit(app, onChange) {
  const state = { scale: 1, compact: false };
  function fit() {
    const de = document.documentElement;
    const vw = de.clientWidth || innerWidth, vh = de.clientHeight || innerHeight;
    let s = Math.min(vw / ART_W, vh / ART_H);
    if (s < MIN_WIDE) s = Math.min(vw / ALT_W, vh / ART_H, MIN_WIDE);
    state.compact = s < COMPACT_BELOW || vw / vh < 0.95;
    de.classList.toggle('compact', state.compact);
    if (state.compact) {
      state.scale = 1;
      app.style.width = app.style.height = app.style.transform = '';
    } else {
      state.scale = s;
      const w = vw / s, h = vh / s;
      app.style.width = `${w}px`;
      app.style.height = `${h}px`;
      app.style.transform = `scale(${s})`;
      drawScenery(document.querySelector('#scenery'), w, h);
    }
    onChange?.(state);
  }
  addEventListener('resize', fit);
  fit();
  return state;
}

// The date/time readout in the status card.
export function startClock(dateEl, timeEl) {
  const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  const pad = (n) => String(n).padStart(2, '0');
  const tick = () => {
    const d = new Date();
    if (dateEl) dateEl.textContent = `${months[d.getMonth()]} ${pad(d.getDate())}, ${d.getFullYear()}`;
    if (timeEl) timeEl.textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };
  tick();
  setInterval(tick, 1000);
}

export function storeGet(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? 'null');
    return v === null ? fallback : v;
  } catch { return fallback; }
}
export function storeSet(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
}

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
