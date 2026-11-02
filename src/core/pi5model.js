// Detailed procedural Raspberry Pi 5 (85 × 56 mm). 1 unit = 1 cm; the board's
// underside sits on y = 0, its centre on x = z = 0, the GPIO header along -z and
// the USB/Ethernet ports on +x. One canvas texture carries the solder mask, copper,
// pads and silkscreen; connectors are built from merged geometry per material so a
// whole board is ~100 draw calls; the 160-odd SMD parts are two instanced meshes.
import * as THREE from 'three';
import { mat, canvasTexture, info, glowSprite } from './kit.js';

export const PI = { w: 8.5, d: 5.6, t: 0.2 }; // a touch thicker than 1.6 mm, like the ESP32 board reads
const W = PI.w, D = PI.d, T = PI.t;

// ---------------------------------------------------------------- materials
// The ESP32 track's palette (assets/stage-*.js), so both boards read as one art
// style: warm cream metal, charcoal plastics, soft gold pins.
const M = {
  steel: () => mat(0xe9e6df, { roughness: 0.36, metalness: 0.5 }), // ESP32 "metal"
  steelDark: () => mat(0xcfcec8, { roughness: 0.4, metalness: 0.5 }), // "shieldEdge"
  shield: () => mat(0xe4e3de, { roughness: 0.32, metalness: 0.55 }),
  gold: () => mat(0xdcbf74, { roughness: 0.3, metalness: 0.6 }), // "pin"
  black: () => mat(0x1f2129, { roughness: 0.55 }), // "header"
  plastic: () => mat(0x2a2c35, { roughness: 0.5 }),
  cavity: () => mat(0x0d0f15, { roughness: 0.9 }), // "hole"
  chip: () => mat(0x2a2d38, { roughness: 0.45 }),
  cream: () => mat(0xf3eee4, { roughness: 0.6 }), // "ledBase"
  latch: () => mat(0xd6b98c, { roughness: 0.5, metalness: 0.2 }), // "tan"
  usbBlue: () => mat(0x2f78c4, { roughness: 0.45 }),
  usbBlack: () => mat(0x2b2e38, { roughness: 0.5 }), // "tongue"
  edge: () => mat(0x1b4a2c, { roughness: 0.7 }),
  under: () => mat(0x1f6b3b, { roughness: 0.72 }),
};

// ---------------------------------------------------------------- geometry batching
// collect geometry per material, then merge into one mesh per material
function mergeGeos(list) {
  const geos = list.map((g) => (g.index ? g.toNonIndexed() : g));
  let n = 0; for (const g of geos) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  let o = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, o * 2);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.computeBoundingSphere();
  return out;
}
class Batch {
  constructor() { this.by = new Map(); this.outline = []; }
  put(geo, material, line = false) {
    if (!this.by.has(material)) this.by.set(material, []);
    this.by.get(material).push(geo);
    if (line) this.outline.push(geo);
    return geo;
  }
  // box with its bottom at y
  box(w, h, d, material, x = 0, y = 0, z = 0, { ry = 0, line = false } = {}) {
    const g = new THREE.BoxGeometry(w, h, d);
    if (ry) g.rotateY(ry);
    g.translate(x, y + h / 2, z);
    return this.put(g, material, line);
  }
  cyl(r, h, material, x = 0, y = 0, z = 0, { seg = 16, axis = 'y', r2 = r, line = false } = {}) {
    const g = new THREE.CylinderGeometry(r, r2, h, seg);
    if (axis === 'x') g.rotateZ(Math.PI / 2);
    if (axis === 'z') g.rotateX(Math.PI / 2);
    g.translate(x, axis === 'y' ? y + h / 2 : y, z);
    return this.put(g, material, line);
  }
  // a 2D shape (in the plane perpendicular to `axis`) extruded `depth` along that axis
  extrude(shape, depth, material, { axis = 'z', x = 0, y = 0, z = 0, line = false, bevel = 0 } = {}) {
    const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: !!bevel, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 6 });
    if (axis === 'y') { g.rotateX(-Math.PI / 2); }
    if (axis === 'x') { g.rotateY(Math.PI / 2); }
    g.translate(x, y, z);
    return this.put(g, material, line);
  }
  mesh(group, { shadow = true } = {}) {
    for (const [m, list] of this.by) {
      const mesh = new THREE.Mesh(mergeGeos(list), m);
      mesh.castShadow = shadow; mesh.receiveShadow = true;
      group.add(mesh);
    }
    return group;
  }
}

function roundRect(w, h, r, cx = 0, cy = 0) {
  const s = new THREE.Shape();
  const x0 = cx - w / 2, y0 = cy - h / 2;
  r = Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4);
  s.moveTo(x0 + r, y0); s.lineTo(x0 + w - r, y0); s.quadraticCurveTo(x0 + w, y0, x0 + w, y0 + r);
  s.lineTo(x0 + w, y0 + h - r); s.quadraticCurveTo(x0 + w, y0 + h, x0 + w - r, y0 + h);
  s.lineTo(x0 + r, y0 + h); s.quadraticCurveTo(x0, y0 + h, x0, y0 + h - r);
  s.lineTo(x0, y0 + r); s.quadraticCurveTo(x0, y0, x0 + r, y0);
  return s;
}
const holePath = (x, y, r) => { const p = new THREE.Path(); p.absarc(x, y, r, 0, Math.PI * 2, true); return p; };

// seeded random, so every build of the board is identical
function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ---------------------------------------------------------------- layout (board coords, cm)
export const PI5_LAYOUT = {
  holes: [[-3.9, -2.45], [1.9, -2.45], [-3.9, 2.45], [1.9, 2.45]],
  header: { pitch: 0.254, hx0: -3.54, rowOdd: -2.32, rowEven: -2.574, pinH: 0.85 },
  soc: [-1.25, -0.35], ram: [0.55, -0.35], rp1: [2.1, 0.4], pmic: [-3.05, 1.4], phy: [1.05, 1.0],
  wifi: [-3.2, -0.75],
  usb2: -1.75, usb3: -0.15, eth: 1.75,
  usbc: -3.13, hdmi: [-1.67, -0.33], bat: -2.45, uart: [-1.0, 2.38],
  cam1: [0.45, 2.0], cam0: [1.75, 2.0], pcie: [-3.95, 0.55], fan: [2.4, -1.6], poe: [1.95, 1.33],
  btn: 1.95, ledPwr: 1.45, ledAct: 1.2,
};
const L = PI5_LAYOUT;
// board -> texture pixel
const PX = 160; // px per cm
const TW = Math.round(W * PX), TH = Math.round(D * PX);
const tx = (x) => (x + W / 2) * PX, tz = (z) => (z + D / 2) * PX;

// ---------------------------------------------------------------- PCB texture
function raspberry(ctx, cx, cy, s, color) {
  // the berry: leaves + 8 drupelets, drawn as outlines like the real silkscreen
  ctx.save(); ctx.translate(cx, cy); ctx.scale(s, s);
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 0.09;
  ctx.beginPath(); ctx.ellipse(-0.36, -0.9, 0.42, 0.2, -0.5, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.ellipse(0.36, -0.9, 0.42, 0.2, 0.5, 0, Math.PI * 2); ctx.stroke();
  const d = [[0, -0.42], [-0.38, -0.25], [0.38, -0.25], [-0.5, 0.15], [0, 0.08], [0.5, 0.15], [-0.28, 0.5], [0.28, 0.5], [0, 0.82]];
  for (const [x, y] of d) { ctx.beginPath(); ctx.arc(x, y, 0.2, 0, Math.PI * 2); ctx.stroke(); }
  ctx.restore();
}
function drawPcb(smd) {
  return canvasTexture(TW, TH, (ctx) => {
    const R = rng(7);
    // solder mask with a faint mottling
    ctx.fillStyle = '#1f8547'; ctx.fillRect(0, 0, TW, TH);
    const grd = ctx.createLinearGradient(0, 0, TW, TH);
    grd.addColorStop(0, 'rgba(255,255,210,0.05)'); grd.addColorStop(1, 'rgba(0,30,10,0.08)');
    ctx.fillStyle = grd; ctx.fillRect(0, 0, TW, TH);
    for (let i = 0; i < 1400; i++) { ctx.fillStyle = `rgba(${R() < 0.5 ? '255,255,255' : '0,0,0'},0.01)`; ctx.fillRect(R() * TW, R() * TH, 6 + R() * 18, 6 + R() * 18); }
    // copper pour under the mask (slightly lighter), with clearances around parts
    ctx.fillStyle = 'rgba(120,200,120,0.07)';
    ctx.fillRect(tx(-4.1), tz(-1.3), tx(-1.9) - tx(-4.1), tz(0.9) - tz(-1.3));
    ctx.fillRect(tx(-0.2), tz(0.6), tx(2.4) - tx(-0.2), tz(1.6) - tz(0.6));
    // traces: copper under the mask reads as lighter green lines
    const trace = (pts, wpx = 2.4, a = 0.32) => {
      ctx.strokeStyle = `rgba(150,225,140,${a})`; ctx.lineWidth = wpx; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.beginPath(); pts.forEach(([x, z], i) => (i ? ctx.lineTo(tx(x), tz(z)) : ctx.moveTo(tx(x), tz(z)))); ctx.stroke();
    };
    // SoC <-> RAM bus
    for (let i = 0; i < 16; i++) { const z = -1.0 + i * 0.085; trace([[-0.3, z], [-0.15, z + 0.03], [-0.12, z + 0.03]], 1.8, 0.28); }
    // SoC <-> RP1 PCIe lanes (diff pairs, routed below the RAM)
    for (let i = 0; i < 8; i++) { const o = i * 0.07 + (i % 2) * 0.02; trace([[-1.0 + o * 0.3, 0.6], [-0.7 + o * 0.2, 0.55 + o], [1.3, 0.55 + o], [1.55, 0.25 + o * 0.7]], 1.6, 0.3); }
    // header -> RP1 GPIO fan-out
    for (let i = 0; i < 14; i++) { const x = -2.6 + i * 0.26; trace([[x, -2.15], [x, -1.75 + (i % 3) * 0.04], [x + 0.25, -1.5 + i * 0.02], [1.45 + i * 0.03, -1.45 + i * 0.02], [1.75, -0.15 + i * 0.02]], 1.5, 0.22); }
    // HDMI pairs
    for (const hx of L.hdmi) for (let i = 0; i < 6; i++) { const x = hx - 0.25 + i * 0.1; trace([[x, 2.1], [x, 1.7], [x * 0.6 - 0.4, 0.75]], 1.6, 0.26); }
    // USB-C power: wide power trace + PMIC routes
    trace([[L.usbc, 2.2], [L.usbc, 1.85], [-3.05, 1.75]], 9, 0.18);
    trace([[-2.75, 1.4], [-2.2, 1.05], [-2.15, 0.5]], 6, 0.16);
    // RP1 -> USB / Ethernet
    for (let i = 0; i < 6; i++) { trace([[2.6, 0.1 + i * 0.08], [2.75, -0.15 + i * 0.05], [2.75, -1.4 - i * 0.05]], 1.6, 0.26); trace([[2.6, 0.7 + i * 0.05], [3.1, 1.1 + i * 0.05]], 1.6, 0.26); }
    // MIPI lanes
    for (const [cx] of [L.cam0, L.cam1]) for (let i = 0; i < 8; i++) trace([[cx - 0.4 + i * 0.11, 1.8], [cx - 0.3 + i * 0.09, 1.45], [1.6 + i * 0.05, 0.95]], 1.4, 0.24);
    // random short stubs and vias
    for (let i = 0; i < 140; i++) {
      const x = -4.0 + R() * 7.4, z = -2.0 + R() * 4.2;
      if (R() < 0.55) { const dx = (R() - 0.5) * 0.6, dz = (R() - 0.5) * 0.6; trace([[x, z], [x + dx, z], [x + dx, z + dz]], 1.4, 0.18); }
      ctx.fillStyle = 'rgba(205,170,90,0.85)'; ctx.beginPath(); ctx.arc(tx(x), tz(z), 3.2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#0f4a26'; ctx.beginPath(); ctx.arc(tx(x), tz(z), 1.6, 0, Math.PI * 2); ctx.fill();
    }
    // Wi-Fi antenna: a copper meander at the top-left corner
    ctx.strokeStyle = 'rgba(214,170,80,0.85)'; ctx.lineWidth = 4;
    ctx.beginPath();
    let ax = tx(-4.12), az = tz(-1.42);
    ctx.moveTo(ax, az);
    for (let i = 0; i < 7; i++) { az = i % 2 ? tz(-1.42) : tz(-1.92); ctx.lineTo(ax, az); ax += 0.13 * PX; ctx.lineTo(ax, az); }
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.font = `600 ${0.13 * PX}px "Barlow Semi Condensed", sans-serif`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText('ANT', tx(-4.1), tz(-1.27));
    // mounting holes: plated rings
    for (const [x, z] of L.holes) {
      ctx.fillStyle = '#d7b15e'; ctx.beginPath(); ctx.arc(tx(x), tz(z), 0.31 * PX, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(120,90,30,0.6)'; ctx.lineWidth = 2; ctx.stroke();
      for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; ctx.fillStyle = '#7d6230'; ctx.beginPath(); ctx.arc(tx(x) + Math.cos(a) * 0.24 * PX, tz(z) + Math.sin(a) * 0.24 * PX, 2.2, 0, Math.PI * 2); ctx.fill(); }
    }
    // pads under the SMD parts
    ctx.fillStyle = '#d4b26e';
    for (const s of smd) {
      const hw = s.l / 2, pw = s.l * 0.3 * PX, ph = s.w * 1.15 * PX;
      for (const sgn of [-1, 1]) {
        const cx = s.x + (s.rot ? 0 : sgn * (hw - s.l * 0.12)), cz = s.z + (s.rot ? sgn * (hw - s.l * 0.12) : 0);
        if (s.rot) ctx.fillRect(tx(cx) - ph / 2, tz(cz) - pw / 2, ph, pw); else ctx.fillRect(tx(cx) - pw / 2, tz(cz) - ph / 2, pw, ph);
      }
    }
    // pads around the big parts (thin gold borders peeking out)
    const padRing = (x, z, w, d) => { ctx.fillStyle = 'rgba(205,176,122,0.9)'; ctx.fillRect(tx(x - w / 2), tz(z - d / 2), w * PX, d * PX); };
    padRing(L.soc[0], L.soc[1], 1.95, 1.95);
    padRing(L.ram[0], L.ram[1], 1.38, 1.53);
    padRing(L.rp1[0], L.rp1[1], 1.12, 1.12);
    // test points
    for (let i = 0; i < 26; i++) { const x = -3.8 + R() * 7, z = -1.6 + R() * 3.5; ctx.fillStyle = '#d8b766'; ctx.beginPath(); ctx.arc(tx(x), tz(z), 0.045 * PX, 0, Math.PI * 2); ctx.fill(); }

    // ------------------------------------------------ silkscreen
    const silk = '#eeefee'; // ESP32 silkscreen white
    ctx.fillStyle = silk; ctx.strokeStyle = silk; ctx.textBaseline = 'middle';
    const text = (t, x, z, size, { align = 'center', weight = 700, rot = 0 } = {}) => {
      ctx.save(); ctx.translate(tx(x), tz(z)); ctx.rotate(rot);
      ctx.textAlign = align; ctx.font = `${weight} ${size * PX}px "Barlow Semi Condensed", "Barlow", sans-serif`;
      ctx.fillText(t, 0, 0); ctx.restore();
    };
    const outline = (x, z, w, d, lw = 2.2) => { ctx.lineWidth = lw; ctx.strokeRect(tx(x - w / 2), tz(z - d / 2), w * PX, d * PX); };
    // logo + name
    raspberry(ctx, tx(-2.42), tz(1.0), 0.22 * PX, silk);
    text('Raspberry Pi 5', -2.1, 0.92, 0.3, { align: 'left' });
    text('© Raspberry Pi Ltd 2023', -2.1, 1.22, 0.13, { align: 'left', weight: 600 });
    // header frame + pin 1 marker + labels
    const hx0 = L.header.hx0, p = L.header.pitch;
    outline(hx0 + 9.5 * p, (L.header.rowOdd + L.header.rowEven) / 2, 20 * p + 0.12, 2 * p + 0.12);
    text('J8', hx0 - 0.28, -2.45, 0.12);
    text('1', hx0, -2.08, 0.1);
    text('GPIO', hx0 + 9.5 * p, -2.03, 0.12, { weight: 600 });
    // part designators and port labels
    text('FAN', L.fan[0], L.fan[1] + 0.33, 0.12);
    text('PoE', L.poe[0] - 0.42, L.poe[1], 0.11);
    text('CAM/DISP 1', L.cam1[0], L.cam1[1] - 0.33, 0.11);
    text('CAM/DISP 0', L.cam0[0], L.cam0[1] - 0.33, 0.11);
    text('PCIe', L.pcie[0] + 0.42, L.pcie[1], 0.12, { rot: -Math.PI / 2 });
    text('UART', L.uart[0], L.uart[1] - 0.3, 0.1);
    text('BAT', L.bat, 2.05, 0.1);
    text('HDMI0', L.hdmi[0], 1.98, 0.11);
    text('HDMI1', L.hdmi[1], 1.98, 0.11);
    text('PWR IN', L.usbc, 1.98, 0.11);
    text('PWR', -3.98, L.ledPwr, 0.08, { align: 'left' });
    text('ACT', -3.98, L.ledAct, 0.08, { align: 'left' });
    text('RUN', -3.95, L.btn - 0.32, 0.08, { align: 'left' });
    text('U1', L.soc[0] - 1.08, L.soc[1] - 0.85, 0.09);
    text('U2', L.ram[0] + 0.78, L.ram[1] - 0.8, 0.09);
    text('RP1', L.rp1[0], L.rp1[1] - 0.68, 0.09);
    // component outlines
    outline(L.soc[0], L.soc[1], 2.02, 2.02, 1.6);
    outline(L.ram[0], L.ram[1], 1.45, 1.6, 1.6);
    outline(L.rp1[0], L.rp1[1], 1.2, 1.2, 1.6);
    outline(L.wifi[0], L.wifi[1], 1.25, 1.1, 1.6);
    outline(L.pmic[0], L.pmic[1], 0.72, 0.72, 1.4);
    // fiducials
    for (const [x, z] of [[-4.0, -0.15], [3.05, -2.55], [-0.6, 1.75]]) { ctx.fillStyle = '#e2c27a'; ctx.beginPath(); ctx.arc(tx(x), tz(z), 0.05 * PX, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(tx(x), tz(z), 0.1 * PX, 0, Math.PI * 2); ctx.stroke(); }
    // small text blocks like the real board
    text('Raspberry Pi 5 Model B Rev 1.0', 0.4, 2.62, 0.09, { weight: 600 });
    text('CE  FC  UKCA', 2.6, -2.62, 0.09, { weight: 600 });
  });
}

// texture for a chip top (etched lid or printed package)
function chipTex(kind) {
  const S = 256;
  return canvasTexture(S, S, (c) => {
    if (kind === 'soc') {
      const g = c.createLinearGradient(0, 0, S, S); g.addColorStop(0, '#eeede8'); g.addColorStop(0.5, '#e2e1db'); g.addColorStop(1, '#e8e7e1');
      c.fillStyle = g; c.fillRect(0, 0, S, S);
            raspberry(c, S * 0.26, S * 0.33, 22, '#3a3f4c');
      c.fillStyle = '#3a3f4c'; c.textAlign = 'left'; c.textBaseline = 'middle';
      c.font = '700 26px "Barlow Semi Condensed", sans-serif'; c.fillText('BROADCOM', S * 0.44, S * 0.28);
      c.font = '700 30px "Barlow Semi Condensed", sans-serif'; c.fillText('BCM2712', S * 0.44, S * 0.42);
      c.font = '600 19px "Barlow Semi Condensed", sans-serif';
      c.fillText('ZPKFSB06C0T', S * 0.16, S * 0.62); c.fillText('2335 PB01 · TW', S * 0.16, S * 0.74); c.fillText('© 2023 RPL', S * 0.16, S * 0.86);
    } else {
      c.fillStyle = '#2a2d38'; c.fillRect(0, 0, S, S);
      c.fillStyle = 'rgba(238,239,238,0.9)'; c.textAlign = 'center'; c.textBaseline = 'middle';
      if (kind === 'ram') { c.font = '700 34px "Barlow Semi Condensed", sans-serif'; c.fillText('SAMSUNG', S / 2, S * 0.3); c.font = '600 24px "Barlow Semi Condensed", sans-serif'; c.fillText('K4UBE3D4AB', S / 2, S * 0.5); c.fillText('MGCL  LPDDR4X', S / 2, S * 0.66); c.fillText('331  8GB', S / 2, S * 0.8); }
      if (kind === 'rp1') { raspberry(c, S / 2, S * 0.36, 30, 'rgba(238,239,238,0.9)'); c.font = '700 40px "Barlow Semi Condensed", sans-serif'; c.fillText('RP1-C0', S / 2, S * 0.74); c.font = '600 20px "Barlow Semi Condensed", sans-serif'; c.fillText('2316 TW', S / 2, S * 0.88); }
      if (kind === 'pmic') { c.font = '700 54px "Barlow Semi Condensed", sans-serif'; c.fillText('DA9091', S / 2, S * 0.45); c.font = '600 34px "Barlow Semi Condensed", sans-serif'; c.fillText('RPI-03', S / 2, S * 0.72); }
      if (kind === 'phy') { c.font = '700 44px "Barlow Semi Condensed", sans-serif'; c.fillText('BCM', S / 2, S * 0.38); c.fillText('54213PE', S / 2, S * 0.62); }
      if (kind === 'wifi') { c.fillStyle = '#e4e3de'; c.fillRect(0, 0, S, S); c.fillStyle = 'rgba(70,76,84,0.75)'; c.font = '700 30px "Barlow Semi Condensed", sans-serif'; c.fillText('Raspberry Pi', S / 2, S * 0.38); c.font = '600 22px "Barlow Semi Condensed", sans-serif'; c.fillText('CYW43455 · 2.4/5 GHz', S / 2, S * 0.56); c.fillText('FCC ID 2ABCB-RPI5', S / 2, S * 0.72); }
      // pin-1 dot
      if (kind !== 'wifi') { c.fillStyle = 'rgba(255,255,255,0.22)'; c.beginPath(); c.arc(S * 0.1, S * 0.1, 8, 0, Math.PI * 2); c.fill(); }
    }
  });
}
// a flat top label on a package (shape so it can have rounded corners)
function topDecal(w, d, tex, y, { r = 0.02, metal = false } = {}) {
  const g = new THREE.ShapeGeometry(roundRect(w, d, r), 2);
  const uv = g.attributes.uv, pos = g.attributes.position;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (pos.getX(i) + w / 2) / w, (pos.getY(i) + d / 2) / d);
  g.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: tex, roughness: metal ? 0.3 : 0.45, metalness: metal ? 0.85 : 0 }));
  m.position.y = y; m.receiveShadow = true;
  return m;
}

// ---------------------------------------------------------------- connectors
// Stamped-metal shell shared by the USB stacks and the RJ45 jack, in the ESP32
// USB-C's style: cream metal, a fold line round the front, seams, embossed ribs and
// vent slots on the top, and spring tabs. Opening faces +x. Local origin: centre bottom.
function shell(b, Lx, H, Wz, mouths) {
  const steel = M.steel(), dark = M.steelDark(), F = 0.34; // depth of the open front
  // the closed back part, then a front frame with real openings (so you can see in)
  b.extrude(roundRect(Wz, H, 0.06, 0, H / 2), Lx - F, steel, { axis: 'x', x: -Lx / 2 });
  const front = roundRect(Wz, H, 0.06, 0, H / 2);
  for (const m of mouths) front.holes.push(roundRect(m.w, m.h, m.r ?? 0.05, 0, m.y + m.h / 2));
  b.extrude(front, F, steel, { axis: 'x', x: Lx / 2 - F });
  // the back of each opening, dark
  for (const m of mouths) b.box(0.02, m.h, m.w, M.cavity(), Lx / 2 - F + 0.01, m.y, 0);
  // folded front lip: a raised rim round the face
  const lip = roundRect(Wz + 0.06, H + 0.06, 0.08, 0, H / 2); lip.holes.push(roundRect(Wz - 0.08, H - 0.08, 0.04, 0, H / 2));
  b.extrude(lip, 0.07, steel, { axis: 'x', x: Lx / 2 - 0.07 });
  // seam down the back and the fold line across the top
  b.box(0.02, H * 0.9, 0.025, dark, -Lx / 2 - 0.005, H * 0.05, 0);
  b.box(Lx * 0.82, 0.012, 0.03, dark, -0.06, H, 0);
  // embossed ribs + vent slots on top
  for (const z of [-0.3, 0.3]) b.box(Lx * 0.42, 0.03, 0.1, steel, -Lx * 0.2, H, z * Wz);
  for (let i = 0; i < 3; i++) b.box(0.26, 0.006, 0.05, M.cavity(), Lx * 0.16, H + 0.001, (-0.13 + i * 0.13) * Wz);
  // spring tabs bent out on both sides, and solder legs
  for (const sgn of [-1, 1]) {
    const tab = new THREE.BoxGeometry(0.34, 0.22, 0.03); tab.rotateY(sgn * 0.2); tab.translate(Lx / 2 - 0.5, H * 0.5, sgn * (Wz / 2 + 0.025)); b.put(tab, dark);
    b.box(0.12, 0.18, 0.05, dark, -Lx / 4, -0.14, sgn * (Wz / 2 - 0.02));
  }
}
// USB-A double stack: two openings, each with a coloured tongue carrying gold contacts
function usbStack(b, tongue, usb3) {
  const Lx = 1.62, H = 1.42, Wz = 1.26, ow = Wz - 0.22, oh = 0.5;
  const ys = [0.12, H / 2 + 0.09];
  shell(b, Lx, H, Wz, ys.map((y) => ({ y, h: oh, w: ow, r: 0.03 })));
  for (const y0 of ys) {
    const ty = y0 + oh * 0.5;
    b.box(0.3, 0.13, ow * 0.8, tongue, Lx / 2 - 0.2, ty, 0);
    for (let i = 0; i < 4; i++) b.box(0.24, 0.01, 0.1, M.gold(), Lx / 2 - 0.18, ty - 0.008, -0.3 + i * 0.2);
    if (usb3) for (let i = 0; i < 5; i++) b.box(0.07, 0.01, 0.07, M.gold(), Lx / 2 - 0.3, ty + 0.13, -0.32 + i * 0.16);
    // springy retention fingers in the top of each mouth
    for (const z of [-0.28, 0.28]) b.box(0.14, 0.03, 0.1, M.steelDark(), Lx / 2 - 0.1, y0 + oh - 0.03, z);
  }
}
// RJ45 jack: one big mouth with the latch slot below and 8 contacts at the top
function ethernet(b) {
  const Lx = 2.0, H = 1.28, Wz = 1.52, oW = 1.08, oH = 0.8, oy = 0.2;
  shell(b, Lx, H, Wz, [{ y: oy, h: oH, w: oW, r: 0.03 }, { y: oy - 0.15, h: 0.12, w: 0.42, r: 0.01 }]);
  // dark plastic insert and gold contact fingers
  b.box(0.3, 0.12, oW, M.plastic(), Lx / 2 - 0.18, oy + oH - 0.12, 0);
  for (let i = 0; i < 8; i++) { const g = new THREE.BoxGeometry(0.26, 0.016, 0.045); g.rotateZ(0.45); g.translate(Lx / 2 - 0.2, oy + oH - 0.2, -0.35 + i * 0.1); b.put(g, M.gold()); }
}
// a horizontal receptacle (USB-C / micro-HDMI) opening to +z; `outer`/`inner` are shapes in XY
function receptacle(b, outer, inner, depth, tongueW, tongueH, y0) {
  const shell = outer.clone(); shell.holes.push(inner);
  b.extrude(shell, depth, M.steel(), { axis: 'z', z: -depth / 2, y: y0, line: true });
  // inside: a dark back wall and the tongue with contacts
  const back = new THREE.ShapeGeometry(inner); back.translate(0, y0, -depth / 2 + 0.25); b.put(back, M.cavity());
  b.box(tongueW, tongueH, depth - 0.3, M.black(), 0, y0 - tongueH / 2, 0.05);
  b.box(tongueW * 0.9, tongueH + 0.006, depth - 0.45, M.gold(), 0, y0 - tongueH / 2 - 0.003, 0.08);
  // solder legs
  for (const s of [-1, 1]) b.box(0.05, 0.1, 0.18, M.steelDark(), s * 0.42 * (outer.userData?.w || 0.9), 0, 0);
}
function stadium(w, h) { const s = roundRect(w, h, h / 2); s.userData = { w }; return s; }
function trapezoid(wTop, wBot, h, r = 0.03) {
  const s = new THREE.Shape();
  s.moveTo(-wBot / 2 + r, -h / 2); s.lineTo(wBot / 2 - r, -h / 2); s.quadraticCurveTo(wBot / 2, -h / 2, wBot / 2 + 0.01, -h / 2 + r);
  s.lineTo(wTop / 2, h / 2 - r); s.quadraticCurveTo(wTop / 2, h / 2, wTop / 2 - r, h / 2);
  s.lineTo(-wTop / 2 + r, h / 2); s.quadraticCurveTo(-wTop / 2, h / 2, -wTop / 2, h / 2 - r);
  s.lineTo(-wBot / 2 - 0.01, -h / 2 + r); s.quadraticCurveTo(-wBot / 2, -h / 2, -wBot / 2 + r, -h / 2);
  s.userData = { w: wTop };
  return s;
}
// FPC connector (MIPI 22-pin or PCIe 16-pin), long axis along x, cable enters from -z
function fpc(b, w, pins) {
  b.box(w, 0.13, 0.36, M.black(), 0, 0, 0, { line: true });
  b.box(w + 0.08, 0.1, 0.17, M.latch(), 0, 0.13, -0.1, { line: true }); // flip lock actuator
  b.box(w - 0.08, 0.035, 0.12, M.cavity(), 0, 0.105, 0.06); // slot
  for (const s of [-1, 1]) { b.box(0.08, 0.16, 0.3, M.steelDark(), s * (w / 2 + 0.06), 0, 0.02); }
  const pitch = (w - 0.2) / (pins - 1);
  for (let i = 0; i < pins; i++) b.box(0.028, 0.025, 0.14, M.gold(), -w / 2 + 0.1 + i * pitch, 0, 0.23);
}
// JST-SH style shrouded connector, opening on top
function jst(b, n, color = M.cream()) {
  const w = 0.1 * n + 0.3;
  b.box(w, 0.3, 0.32, color, 0, 0, 0, { line: true });
  b.box(w - 0.12, 0.02, 0.2, M.cavity(), 0, 0.29, 0.02);
  for (let i = 0; i < n; i++) b.box(0.035, 0.05, 0.06, M.gold(), -(n - 1) * 0.05 + i * 0.1, 0.27, 0.02);
  for (let i = 0; i < n; i++) b.box(0.04, 0.03, 0.12, M.gold(), -(n - 1) * 0.05 + i * 0.1, 0, -0.2);
  for (const s of [-1, 1]) b.box(0.08, 0.06, 0.16, M.steelDark(), s * (w / 2 + 0.03), 0, 0.05);
}

// ---------------------------------------------------------------- build
export function buildPi5Model(PI_HEADER) {
  const g = new THREE.Group();
  g.name = 'pi5';
  const parts = [];
  const part = (build, data, x = 0, z = 0, ry = 0, y = T) => {
    const grp = new THREE.Group();
    const b = new Batch();
    build(b, grp);
    b.mesh(grp);
    grp.position.set(x, y, z); grp.rotation.y = ry;
    grp.updateMatrix();
    if (data) info(grp, data);
    g.add(grp); if (data) parts.push(grp);
    return grp;
  };

  // ---------------- SMD scatter, avoiding the big parts
  const keepOut = [
    [L.soc, 2.1, 2.1], [L.ram, 1.5, 1.65], [L.rp1, 1.25, 1.25], [L.wifi, 1.35, 1.2], [L.pmic, 0.8, 0.8], [L.phy, 0.8, 0.8],
    [[-1.13, -2.45], 5.4, 0.85], [[3.45, -0.95], 2.0, 3.2], [[3.4, 1.75], 2.3, 1.8], [[-1.9, 2.42], 4.2, 0.9],
    [L.cam1, 1.6, 0.6], [L.cam0, 1.6, 0.6], [L.pcie, 0.6, 1.6], [L.fan, 0.8, 0.5], [L.poe, 0.6, 0.6], [L.uart, 0.6, 0.45],
    [[-1.6, 1.07], 2.9, 0.65], [[-4.0, 1.6], 0.55, 1.0], [[-3.6, -1.67], 1.3, 0.65],
    ...L.holes.map((h) => [h, 0.75, 0.75]),
  ];
  const free = (x, z, r) => x > -W / 2 + 0.15 && x < W / 2 - 0.15 && z > -D / 2 + 0.15 && z < D / 2 - 0.15 &&
    keepOut.every(([[cx, cz], w, d]) => Math.abs(x - cx) > w / 2 + r || Math.abs(z - cz) > d / 2 + r);
  const R = rng(42), smd = [];
  for (let tries = 0; smd.length < 105 && tries < 6000; tries++) {
    // cluster around the SoC/RAM/RP1/PMIC like decoupling caps
    const near = [L.soc, L.ram, L.rp1, L.pmic, L.wifi, L.phy, [0, 0]][Math.floor(R() * 7)];
    const x = near[0] + (R() - 0.5) * 3.2, z = near[1] + (R() - 0.5) * 2.6;
    const big = R() < 0.25, l = big ? 0.3 : 0.18, w = big ? 0.16 : 0.1; // chunky, like the ESP32's 0603s
    if (!free(x, z, l * 0.7)) continue;
    if (smd.some((s) => Math.abs(s.x - x) < 0.3 && Math.abs(s.z - z) < 0.22)) continue;
    smd.push({ x, z, l, w, h: big ? 0.12 : 0.08, rot: R() < 0.4, kind: R() < 0.7 ? 'cap' : 'res' });
  }

  // ---------------- PCB: rounded slab with real holes, textured top
  const shape = roundRect(W, D, 0.3); // 3 mm corners as on the real board
  for (const [x, z] of L.holes) shape.holes.push(holePath(x, -z, 0.14));
  const bodyGeo = new THREE.ExtrudeGeometry(shape, { depth: T, bevelEnabled: false, curveSegments: 10 });
  bodyGeo.rotateX(-Math.PI / 2);
  const body = new THREE.Mesh(bodyGeo, [M.under(), M.edge()]);
  body.castShadow = true; body.receiveShadow = true;
  const topGeo = new THREE.ShapeGeometry(shape, 10);
  { const uv = topGeo.attributes.uv, pos = topGeo.attributes.position; for (let i = 0; i < uv.count; i++) uv.setXY(i, (pos.getX(i) + W / 2) / W, (pos.getY(i) + D / 2) / D); }
  topGeo.rotateX(-Math.PI / 2);
  const pcbTex = drawPcb(smd); pcbTex.anisotropy = 8;
  const top = new THREE.Mesh(topGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, map: pcbTex, roughness: 0.72 }));
  top.position.y = T + 0.0015; top.receiveShadow = true;
  const pcb = new THREE.Group(); pcb.add(body, top);
  info(pcb, { title: 'Raspberry Pi 5', desc: 'A credit-card computer: a 2.4 GHz quad-core Arm Cortex-A76 (BCM2712), with RP1 handling the I/O.', rows: [['Size', '85 × 56 mm'], ['Power', '5 V / 5 A, USB-C PD'], ['GPIO logic', '3.3 V (not 5 V tolerant)']] });
  g.add(pcb); parts.push(pcb);

  // ---------------- SMD instanced
  {
    const n = smd.length;
    const bodyM = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ roughness: 0.5 }), n);
    const endM = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), M.steel(), n * 2);
    bodyM.castShadow = endM.castShadow = true;
    const o = new THREE.Object3D(), col = new THREE.Color();
    smd.forEach((s, i) => {
      o.position.set(s.x, T + s.h / 2, s.z); o.rotation.set(0, s.rot ? Math.PI / 2 : 0, 0); o.scale.set(s.l * 0.62, s.h, s.w); o.updateMatrix();
      bodyM.setMatrixAt(i, o.matrix);
      bodyM.setColorAt(i, col.set(s.kind === 'cap' ? (i % 4 ? 0xd6b98c : 0xb08a5a) : 0x25272f));
      for (const sg of [-1, 1]) {
        const dx = sg * s.l * 0.4;
        o.position.set(s.x + (s.rot ? 0 : dx), T + s.h / 2, s.z + (s.rot ? dx : 0)); o.scale.set(s.l * 0.2, s.h * 1.02, s.w * 1.02); o.updateMatrix();
        endM.setMatrixAt(i * 2 + (sg > 0 ? 1 : 0), o.matrix);
      }
    });
    bodyM.instanceMatrix.needsUpdate = true; endM.instanceMatrix.needsUpdate = true;
    bodyM.receiveShadow = endM.receiveShadow = true;
    g.add(bodyM, endM);
  }

  // ---------------- chips
  part((b, grp) => {
    b.box(1.9, 0.08, 1.9, mat(0x2c3140, { roughness: 0.6 }), 0, 0, 0); // substrate (ESP32 module-PCB colour)
    for (let i = 0; i < 10; i++) for (const s of [-1, 1]) b.box(0.08, 0.03, 0.05, M.gold(), -0.8 + i * 0.18, 0.07, s * 0.86);
    b.extrude(roundRect(1.58, 1.58, 0.1), 0.1, M.shield(), { axis: 'y', y: 0.105, bevel: 0.025 });
    grp.add(topDecal(1.56, 1.56, chipTex('soc'), 0.233, { r: 0.1, metal: true }));
  }, { title: 'BCM2712 SoC', desc: 'Broadcom BCM2712: four Arm Cortex-A76 cores at 2.4 GHz and a VideoCore VII GPU (OpenGL ES 3.1, Vulkan 1.2).', rows: [['CPU', '4 × Cortex-A76 @ 2.4 GHz'], ['GPU', 'VideoCore VII'], ['Video', 'Dual 4Kp60 HDMI, 4Kp60 HEVC decode']] }, L.soc[0], L.soc[1]);

  // chunky bevelled packages with a crisp printed top, like the ESP32's chips
  const pkg = (w, d, h, tex, data, x, z, ry = 0) => part((b, grp) => {
    const bv = 0.025;
    b.extrude(roundRect(w - 2 * bv, d - 2 * bv, 0.03), h - 2 * bv, M.chip(), { axis: 'y', y: bv, bevel: bv });
    grp.add(topDecal(w - 2 * bv - 0.02, d - 2 * bv - 0.02, chipTex(tex), h + 0.003, { r: 0.03 }));
  }, data, x, z, ry);
  pkg(1.3, 1.45, 0.2, 'ram', { title: 'LPDDR4X SDRAM', desc: 'The working memory, LPDDR4X-4267. Pi 5 comes in 1, 2, 4, 8 and 16 GB versions.', rows: [['Type', 'LPDDR4X-4267'], ['Sizes', '1 / 2 / 4 / 8 / 16 GB']] }, L.ram[0], L.ram[1], Math.PI / 2);
  pkg(1.05, 1.05, 0.18, 'rp1', { title: 'RP1 I/O controller', desc: 'Raspberry Pi’s own “southbridge”, linked to the SoC over PCIe 2.0 ×4. It runs the GPIO header, USB, Ethernet and the MIPI camera/display ports.', rows: [['Link', 'PCIe 2.0 ×4 to BCM2712'], ['Handles', 'GPIO · USB · Ethernet · MIPI'], ['GPIO library', 'gpiozero (lgpio)']] }, L.rp1[0], L.rp1[1]);
  pkg(0.62, 0.62, 0.13, 'pmic', { title: 'Power management IC', desc: 'Renesas DA9091 PMIC: makes the core voltages from the 5 V input, and powers the real-time clock.', rows: [['Input', '5 V from USB-C']] }, L.pmic[0], L.pmic[1]);
  pkg(0.64, 0.64, 0.13, 'phy', { title: 'Gigabit Ethernet PHY', desc: 'Broadcom BCM54213PE: turns the Ethernet MAC inside RP1 into signals on the wire.', rows: [['Speed', '10/100/1000 Mbps']] }, L.phy[0], L.phy[1]);
  // inductors and a crystal next to the PMIC / SoC
  part((b) => {
    for (const [x, z] of [[-0.55, -0.15], [-0.55, 0.3], [0.5, 0.35]]) { b.box(0.32, 0.18, 0.32, mat(0x3a3d42, { roughness: 0.7 }), x, 0, z, { line: true }); b.box(0.24, 0.005, 0.24, mat(0x55585e, { roughness: 0.6 }), x, 0.18, z); }
  }, null, L.pmic[0], L.pmic[1]);
  part((b) => { b.extrude(roundRect(0.32, 0.2, 0.05), 0.08, M.steel(), { axis: 'y', line: true }); }, null, -2.55, -1.25);
  part((b) => { b.extrude(roundRect(0.32, 0.2, 0.05), 0.08, M.steel(), { axis: 'y', line: true }); }, null, 2.95, 0.95);

  // Wi-Fi/BT can
  part((b, grp) => {
    b.extrude(roundRect(1.06, 0.91, 0.04), 0.17, M.shield(), { axis: 'y', y: 0.02, bevel: 0.02 });
    for (let i = 0; i < 4; i++) b.cyl(0.03, 0.01, M.steelDark(), -0.4 + i * 0.27, 0.21, 0.38, { seg: 8 });
    grp.add(topDecal(1.0, 0.85, chipTex('wifi'), 0.213, { metal: true }));
  }, { title: 'Wi-Fi + Bluetooth', desc: 'Dual-band 802.11ac Wi-Fi and Bluetooth 5.0 / BLE, under a metal shield; the antenna is the copper pattern at the board corner.', rows: [['Wi-Fi', '802.11ac, 2.4 + 5 GHz'], ['Bluetooth', '5.0 / BLE']] }, L.wifi[0], L.wifi[1]);

  // ---------------- right edge: USB 2.0, USB 3.0, Ethernet
  const usbX = W / 2 - 1.62 / 2 + 0.2;
  part((b) => usbStack(b, M.usbBlack(), false), { title: 'USB 2.0 ports', desc: 'Two USB 2.0 ports (black) for keyboards, mice and other slow devices.', rows: [['Ports', '2 × USB 2.0'], ['Total USB current', '1.6 A with a 5 A supply, 600 mA with 3 A']] }, usbX, L.usb2);
  part((b) => usbStack(b, M.usbBlue(), true), { title: 'USB 3.0 ports', desc: 'Two USB 3.0 ports (blue), 5 Gbps each, and both can run at full speed at the same time.', rows: [['Ports', '2 × USB 3.0'], ['Speed', '5 Gbps each, simultaneous']] }, usbX, L.usb3);
  const ethLeds = [];
  part((b, grp) => {
    ethernet(b);
    for (const [s, c, i] of [[-1, 0xffb020, 0.7], [1, 0x34d058, 0.9]]) {
      const led = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.12, 0.18), mat(c, { roughness: 0.3, emissive: c, unique: true }));
      led.material.emissiveIntensity = i * 1.3; led.position.set(1.01, 0.07, s * 0.6); grp.add(led); ethLeds.push(led);
      const gs = glowSprite(c, 0.6); gs.material.opacity = 0.5; gs.position.set(1.1, 0.13, s * 0.6); grp.add(gs);
    }
  }, { title: 'Gigabit Ethernet', desc: 'Wired networking at up to 1 Gbps, with PoE+ support through a separate PoE+ HAT. The two LEDs show link and activity.', rows: [['Speed', '1 Gbps'], ['PoE', 'PoE+ with a PoE+ HAT']] }, W / 2 - 1.0 + 0.2, L.eth);

  // ---------------- bottom edge: USB-C, 2 × micro HDMI, RTC battery, UART
  const edgeZ = D / 2 - 0.36;
  part((b) => receptacle(b, stadium(0.9, 0.33), stadium(0.82, 0.25), 0.74, 0.62, 0.07, 0.165), { title: 'USB-C power', desc: 'The power input: 5 V at up to 5 A with USB Power Delivery. The official 27 W supply lets USB ports supply 1.6 A in total.', rows: [['Input', '5 V DC, up to 5 A'], ['Recommended', 'Official 27 W USB-C PSU']] }, L.usbc, edgeZ + 0.06);
  L.hdmi.forEach((x, n) => part((b) => receptacle(b, trapezoid(0.66, 0.54, 0.3), trapezoid(0.6, 0.48, 0.24), 0.75, 0.42, 0.06, 0.155), { title: `Micro HDMI ${n}`, desc: 'Two micro HDMI outputs drive two 4K displays at 60 Hz at once.', rows: [['Output', '4Kp60 each, ×2'], ['Connector', 'Micro HDMI (Type D)']] }, x, edgeZ + 0.06));
  part((b) => jst(b, 2), { title: 'RTC battery connector', desc: 'Connect a rechargeable lithium-manganese cell so the real-time clock keeps time while the power is off.', rows: [['Clock', 'Built-in RTC']] }, L.bat, 2.4, Math.PI);
  part((b) => jst(b, 3), { title: 'UART debug connector', desc: 'A 3-pin JST-SH connector for the Raspberry Pi Debug Probe: a serial console without using header pins.', rows: [['Connector', '3-pin JST-SH'], ['Level', '3.3 V']] }, L.uart[0], L.uart[1], Math.PI);

  // ---------------- MIPI ×2, PCIe, fan, PoE
  for (const [pos, n] of [[L.cam0, 0], [L.cam1, 1]]) {
    part((b) => fpc(b, 1.12, 22), { title: `CAM/DISP ${n}`, desc: 'A 4-lane MIPI transceiver: plug in a camera or a DSI display. Pi 5 uses the smaller 22-pin 0.5 mm FPC connector, so standard camera cables need the 22-to-15-pin adapter cable.', rows: [['Lanes', '4-lane MIPI CSI-2 or DSI'], ['Connector', '22-pin, 0.5 mm pitch']] }, pos[0], pos[1], Math.PI);
  }
  part((b) => fpc(b, 1.0, 16), { title: 'PCIe 2.0 ×1', desc: 'A 16-pin FPC connector for fast add-ons such as NVMe SSDs and the AI Kit, through an M.2 HAT+.', rows: [['Interface', 'PCIe 2.0 ×1 (Gen 3 can be enabled)'], ['Use', 'M.2 HAT+, AI Kit, NVMe']] }, L.pcie[0], L.pcie[1], Math.PI / 2);
  part((b) => jst(b, 4), { title: 'Fan header', desc: 'A 4-pin JST connector for the official Active Cooler: the firmware sets the fan speed from the CPU temperature.', rows: [['Pins', '5 V · GND · PWM · tach'], ['Control', 'Automatic, firmware']] }, L.fan[0], L.fan[1]);
  part((b) => {
    b.box(0.5, 0.1, 0.5, M.black(), 0, 0, 0, { line: true });
    for (const x of [-0.127, 0.127]) for (const z of [-0.127, 0.127]) { b.box(0.064, 0.48, 0.064, M.gold(), x, 0, z); }
  }, { title: 'PoE header', desc: '4 pins carrying the Ethernet pairs’ power to a PoE+ HAT, which then powers the Pi over the network cable.', rows: [['Use', 'PoE+ HAT'], ['Standard', '802.3at']] }, L.poe[0], L.poe[1]);

  // ---------------- left edge: power button, LEDs, microSD (underside)
  part((b) => {
    b.box(0.32, 0.26, 0.46, M.black(), 0, 0, 0, { line: true });
    b.box(0.04, 0.24, 0.48, M.steel(), 0.16, 0.0, 0);
    b.cyl(0.085, 0.1, mat(0xe9e5dc, { roughness: 0.4 }), -0.2, 0.13, 0, { axis: 'x', seg: 18 });
  }, { title: 'Power button', desc: 'Press to start, press to request a clean shutdown, hold to force power off.', rows: [['Behaviour', 'Start · shutdown · force off']] }, -W / 2 + 0.22, L.btn);
  const ledGeo = new THREE.BoxGeometry(0.22, 0.1, 0.16);
  const pwrLed = new THREE.Mesh(ledGeo, mat(0xff3b30, { emissive: 0xff3b30, unique: true }));
  pwrLed.material.emissiveIntensity = 1.2;
  pwrLed.position.set(-W / 2 + 0.25, T + 0.05, L.ledPwr);
  const pwrGlow = glowSprite(0xff4a3a, 0.9); pwrGlow.material.opacity = 0.6; pwrGlow.position.set(-W / 2 + 0.2, T + 0.12, L.ledPwr);
  const actLed = new THREE.Mesh(ledGeo, mat(0x34c759, { emissive: 0x34c759, unique: true }));
  actLed.material.emissiveIntensity = 0.2;
  actLed.position.set(-W / 2 + 0.25, T + 0.05, L.ledAct);
  const actGlow = glowSprite(0x3ee06a, 0.9); actGlow.position.set(-W / 2 + 0.2, T + 0.12, L.ledAct);
  // the activity glow follows whatever the sims do to the LED's emissive intensity
  actLed.onBeforeRender = () => { actGlow.material.opacity = Math.min(0.9, Math.max(0, (actLed.material.emissiveIntensity - 0.25) * 0.75)); };
  for (const m of [pwrLed, actLed]) { m.castShadow = false; }
  info(pwrLed, { title: 'Power LED (red)', desc: 'On when the Pi has power but is shut down or booting; it goes off once Linux is running.', rows: [['Colour', 'Red']] });
  info(actLed, { title: 'Activity LED (green)', desc: 'Flickers on SD card / storage activity; your code can also take it over.', rows: [['Colour', 'Green'], ['Linux name', 'ACT (led0)']] });
  g.add(pwrLed, actLed, pwrGlow, actGlow);
  part((b) => {
    b.box(1.15, 0.12, 1.2, M.steel(), 0, 0, 0, { line: true });
    b.box(0.6, 0.07, 1.0, mat(0x2a2d33, { roughness: 0.5 }), -0.45, 0.025, 0);
    b.box(0.04, 0.02, 0.9, M.gold(), -0.1, 0.0, 0);
  }, { title: 'microSD slot', desc: 'The usual boot drive: Raspberry Pi OS on a microSD card (high-speed SDR104 mode). Pi 5 can also boot from USB or NVMe.', rows: [['Mode', 'SDR104'], ['Other boot', 'USB · NVMe (PCIe)']] }, -W / 2 + 0.5, 0.0, 0, -0.12);

  // ---------------- 40-pin header (pin tips unchanged: lessons wire to them)
  const H = L.header, pitch = H.pitch;
  const tips = {}, tipsByPhys = [];
  part((b) => {
    const base = M.black();
    for (let col = 0; col < 20; col++) {
      const x = H.hx0 + col * pitch;
      for (const z of [H.rowOdd, H.rowEven]) {
        const geo = new THREE.BoxGeometry(pitch - 0.014, 0.25, pitch - 0.014);
        geo.translate(x, 0.125, z); b.put(geo, base);
        // chamfer cap on each cell
        const cap = new THREE.CylinderGeometry(0.075, 0.115, 0.02, 4); cap.rotateY(Math.PI / 4); cap.translate(x, 0.26, z); b.put(cap, base);
      }
    }
    const pin = M.gold();
    for (let phys = 1; phys <= 40; phys++) {
      const col = Math.floor((phys - 1) / 2);
      const x = H.hx0 + col * pitch, z = phys % 2 ? H.rowOdd : H.rowEven;
      b.box(0.064, H.pinH - 0.045, 0.064, pin, x, 0, z);
      const tip = new THREE.CylinderGeometry(0.012, 0.045, 0.045, 4); tip.rotateY(Math.PI / 4); tip.translate(x, H.pinH - 0.0225, z); b.put(tip, pin);
      const t = new THREE.Vector3(x, T + H.pinH, z);
      tipsByPhys[phys] = t;
      const name = PI_HEADER[phys];
      (tips[name] ||= []).push(t);
    }
    // outline only the base as a whole
    const out = new THREE.BoxGeometry(20 * pitch, 0.27, 2 * pitch); out.translate(H.hx0 + 9.5 * pitch, 0.135, (H.rowOdd + H.rowEven) / 2); b.outline.push(out);
  }, { title: '40-pin GPIO header', desc: 'The Pi’s connection to the outside world: 28 GPIO pins plus 3.3 V, 5 V and ground. GPIO is 3.3 V logic — never feed it 5 V.', rows: [['GPIO', '28 pins, 3.3 V logic'], ['Power pins', '3.3 V × 2 · 5 V × 2 · GND × 8'], ['Buses', 'I2C · SPI · UART · PWM · PCM']] });

  // ---------------- through-hole solder on the header / connectors is on the underside; add hole walls
  for (const [x, z] of L.holes) {
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, T, 20, 1, true), mat(0xc9a55a, { roughness: 0.35, metalness: 0.8 }));
    wall.material.side = THREE.BackSide; wall.position.set(x, T / 2, z); g.add(wall);
  }

  // (ink outlines come from the stage's outline pass, as on the ESP32 track)

  return { group: g, parts, tips, tipsByPhys, actLed };
}
