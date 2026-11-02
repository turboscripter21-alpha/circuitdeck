// Low-level three.js helpers for CircuitDeck's procedural models.
// Units: 1 = 1 cm. The table is the y = 0 plane.
import * as THREE from 'three';

export const COLORS = {
  pcbGreen: 0x2f7d4a, pcbPi: 0x3c8a4e, pcbBlue: 0x2a5ea8, pcbPurple: 0x5b3c8f, pcbBlack: 0x22262c,
  pcbRed: 0xb8322c, gold: 0xd8b25a, silver: 0xc4c9cf, steel: 0x9aa3ad, black: 0x23262b, white: 0xf3f1ec,
  plastic: 0x2b2f36, cream: 0xf4ecdf, usbBlue: 0x2f66c8,
};

const matCache = new Map();
export function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!opts.unique && matCache.has(key)) return matCache.get(key);
  const m = new THREE.MeshStandardMaterial({ color, roughness: opts.roughness ?? 0.62, metalness: opts.metalness ?? 0, ...(opts.extra || {}) });
  if (opts.emissive !== undefined) m.emissive = new THREE.Color(opts.emissive);
  if (opts.transparent) { m.transparent = true; m.opacity = opts.opacity ?? 0.6; }
  if (!opts.unique) matCache.set(key, m);
  return m;
}
export const metal = (color = COLORS.silver) => mat(color, { roughness: 0.35, metalness: 0.75 });

export function box(w, h, d, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), typeof material === 'number' ? mat(material) : material);
  m.position.set(x, y + h / 2, z);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

export function cyl(rTop, rBottom, h, material, x = 0, y = 0, z = 0, seg = 24) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBottom, h, seg), typeof material === 'number' ? mat(material) : material);
  m.position.set(x, y + h / 2, z);
  m.castShadow = true;
  return m;
}

// A flat rounded rectangle slab (PCBs, module boards).
export function slab(w, d, h, material, radius = 0.15) {
  const r = Math.min(radius, w / 2 - 0.001, d / 2 - 0.001);
  const s = new THREE.Shape();
  s.moveTo(-w / 2 + r, -d / 2);
  s.lineTo(w / 2 - r, -d / 2); s.quadraticCurveTo(w / 2, -d / 2, w / 2, -d / 2 + r);
  s.lineTo(w / 2, d / 2 - r); s.quadraticCurveTo(w / 2, d / 2, w / 2 - r, d / 2);
  s.lineTo(-w / 2 + r, d / 2); s.quadraticCurveTo(-w / 2, d / 2, -w / 2, d / 2 - r);
  s.lineTo(-w / 2, -d / 2 + r); s.quadraticCurveTo(-w / 2, -d / 2, -w / 2 + r, -d / 2);
  const g = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false, curveSegments: 6 });
  g.rotateX(-Math.PI / 2); // extrude upwards, shape in the XZ plane
  const m = new THREE.Mesh(g, typeof material === 'number' ? mat(material) : material);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

// Canvas texture with text, for silkscreen, labels and screens.
export function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  draw?.(ctx, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.userData.canvas = c; t.userData.ctx = ctx;
  return t;
}

// A thin decal (top face) showing a texture, lying flat at height y.
export function decal(w, d, texture, y, opts = {}) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({
    map: texture, transparent: opts.transparent ?? true, roughness: opts.roughness ?? 0.7,
    emissive: opts.emissive ? new THREE.Color(0xffffff) : new THREE.Color(0x000000),
    emissiveMap: opts.emissive ? texture : null, emissiveIntensity: opts.emissive ?? 0,
  }));
  m.rotation.x = -Math.PI / 2;
  m.position.y = y;
  return m;
}

export function silk(lines, w, h, opts = {}) {
  const scale = 64;
  return canvasTexture(Math.round(w * scale), Math.round(h * scale), (ctx, cw, ch) => {
    ctx.clearRect(0, 0, cw, ch);
    ctx.fillStyle = opts.color || 'rgba(255,255,255,0.92)';
    ctx.textAlign = opts.align || 'center';
    ctx.textBaseline = 'middle';
    const size = opts.size || 15;
    ctx.font = `700 ${size}px "Barlow Semi Condensed", "Barlow", sans-serif`;
    lines.forEach((line, i) => {
      const y = ch / 2 + (i - (lines.length - 1) / 2) * size * 1.15;
      ctx.fillText(line, opts.align === 'left' ? 8 : cw / 2, y);
    });
  });
}

// A row of square header pins (male), standing up; returns { group, tips[] }.
export function headerRow(n, opts = {}) {
  const pitch = opts.pitch ?? 0.254, height = opts.height ?? 0.6, rows = opts.rows ?? 1;
  const g = new THREE.Group();
  const base = box(n * pitch, 0.25, rows * pitch, COLORS.black, 0, 0, 0);
  g.add(base);
  const pinGeo = new THREE.BoxGeometry(0.064, height, 0.064);
  const pinMat = mat(COLORS.gold, { roughness: 0.3, metalness: 0.8 });
  const tips = [];
  for (let r = 0; r < rows; r++) {
    for (let i = 0; i < n; i++) {
      const p = new THREE.Mesh(pinGeo, pinMat);
      const x = (i - (n - 1) / 2) * pitch, z = (r - (rows - 1) / 2) * pitch;
      p.position.set(x, height / 2, z);
      g.add(p);
      tips.push(new THREE.Vector3(x, height, z));
    }
  }
  return { group: g, tips };
}

// A chip package with optional marking.
export function chip(w, d, h, label, color = 0x1d2025) {
  const g = new THREE.Group();
  g.add(box(w, h, d, mat(color, { roughness: 0.5 })));
  if (label) {
    const t = silk(Array.isArray(label) ? label : [label], w, d, { color: 'rgba(220,220,220,0.75)', size: 13 });
    g.add(decal(w * 0.95, d * 0.95, t, h + 0.002));
  }
  return g;
}

// Glow sprite for lit LEDs.
let glowTex = null;
export function glowSprite(color, size = 1.2) {
  if (!glowTex) {
    glowTex = canvasTexture(64, 64, (ctx) => {
      const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
    });
  }
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
  s.scale.set(size, size, 1);
  return s;
}

// A jumper wire between two world points (smooth arc).
export function wire(a, b, color, opts = {}) {
  const lift = opts.lift ?? Math.min(2.2, 0.6 + a.distanceTo(b) * 0.18);
  const up = new THREE.Vector3(0, 1, 0);
  const p1 = a.clone().addScaledVector(up, lift * 0.55);
  const p2 = b.clone().addScaledVector(up, lift * 0.55);
  const mid = a.clone().lerp(b, 0.5).addScaledVector(up, lift);
  const curve = new THREE.CatmullRomCurve3([a, p1, mid, p2, b], false, 'centripetal');
  const m = new THREE.Mesh(new THREE.TubeGeometry(curve, 48, opts.radius ?? 0.045, 8, false), mat(color, { roughness: 0.5 }));
  m.castShadow = true;
  m.userData.isWire = true;
  return m;
}

// A flat ribbon (FPC) cable between two points.
export function ribbon(a, b, width = 1.1, color = 0xe8e0d0) {
  const lift = 1.2 + a.distanceTo(b) * 0.1;
  const curve = new THREE.CatmullRomCurve3([a, a.clone().add(new THREE.Vector3(0, lift * 0.6, 0)), a.clone().lerp(b, 0.5).add(new THREE.Vector3(0, lift, 0)), b.clone().add(new THREE.Vector3(0, lift * 0.6, 0)), b], false, 'centripetal');
  const pts = curve.getPoints(40);
  const geo = new THREE.BufferGeometry();
  const pos = [], idx = [];
  const side = new THREE.Vector3();
  const dir = b.clone().sub(a); dir.y = 0; dir.normalize();
  side.set(-dir.z, 0, dir.x).multiplyScalar(width / 2);
  pts.forEach((p) => { pos.push(p.x - side.x, p.y, p.z - side.z, p.x + side.x, p.y, p.z + side.z); });
  for (let i = 0; i < pts.length - 1; i++) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx); geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide, roughness: 0.6 }));
  m.userData.isWire = true;
  return m;
}

// Tag a mesh tree as one clickable part for the inspector.
export function info(obj, data) {
  obj.userData.info = data;
  return obj;
}
