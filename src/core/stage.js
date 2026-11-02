// The 3D stage: renderer, camera, orbit controls, lights, a theme-aware floor,
// click-to-inspect picking, and DOM tags/hotspots that follow 3D anchors.
import * as THREE from 'three';
import { OrbitControls } from '/vendor/three/OrbitControls.min.js';
import { RoomEnvironment } from '/vendor/three/RoomEnvironment.js';
import { wire as makeWire, ribbon as makeRibbon } from './kit.js';
import { OutlineComposer } from './outline.js';

const isDark = () => document.documentElement.dataset.theme === 'dark';
const SVGNS = 'http://www.w3.org/2000/svg';

// Callout icons: the ESP32 track's set (pins, chip, wifi, usb, plug, bolt, led)
// plus a few more for the Pi drawn in the same 2.2px navy stroke style.
const ICONS = {
  pins: ['0 0 40 40', '<path d="M5 34.5h30M7.5 34.5v-6h25v6"/><path d="M12 28.5V8.5c0-1.4 1-2.5 2.2-2.5s2.3 1.1 2.3 2.5v20M23.5 28.5v-20c0-1.4 1-2.5 2.3-2.5s2.2 1.1 2.2 2.5v20"/>'],
  chip: ['0 0 40 40', '<rect x="9.5" y="9.5" width="21" height="21" rx="2"/><rect x="14" y="14" width="12" height="12" rx="1" class="fill"/><path d="M14.5 4v5.5M20 4v5.5M25.5 4v5.5M14.5 30.5V36M20 30.5V36M25.5 30.5V36M4 14.5h5.5M4 20h5.5M4 25.5h5.5M30.5 14.5H36M30.5 20H36M30.5 25.5H36"/>'],
  wifi: ['0 0 40 40', '<path d="M7 16.5a18.5 18.5 0 0 1 26 0M11.8 21.6a11.6 11.6 0 0 1 16.4 0M16.6 26.6a4.8 4.8 0 0 1 6.8 0"/><circle cx="20" cy="31.6" r="2.2" class="fill"/>'],
  usb: ['0 0 32 52', '<path d="M10.5 3.5h11v15h-11z"/><path d="M13.6 7.5v3.4M18.4 7.5v3.4"/><path d="M7 18.5h18v10.8c0 2.6-2.1 4.7-4.7 4.7h-8.6C9.1 34 7 31.9 7 29.3z"/><path d="M14 34v5h4v-5M16 39v10"/>', 'tall'],
  plug: ['0 0 40 46', '<path d="M14 4v9M26 4v9"/><path d="M9 13h22v6.5c0 6.1-4.9 11-11 11s-11-4.9-11-11z"/><path d="M20 30.5v6c0 2.5-2 4.5-4.5 4.5"/>'],
  bolt: ['0 0 40 46', '<path d="M24.5 3 9.5 25.5h10L15.5 43 31 19.5H21z"/>'],
  led: ['0 0 40 40', '<path d="M13.5 23v-8.5a6.5 6.5 0 0 1 13 0V23"/><path d="M10.5 23h19"/><path d="M16.5 23v13M23.5 23v9"/><path d="M20 2.5v3.2M7.5 7.5l2.3 2.3M32.5 7.5l-2.3 2.3"/>'],
  memory: ['0 0 40 40', '<rect x="5" y="11" width="30" height="16" rx="2"/><rect x="10" y="15.5" width="5" height="7" class="fill"/><rect x="17.5" y="15.5" width="5" height="7" class="fill"/><rect x="25" y="15.5" width="5" height="7" class="fill"/><path d="M9 27v4.5M14 27v4.5M19 27v4.5M24 27v4.5M29 27v4.5"/>'],
  io: ['0 0 40 40', '<rect x="11" y="11" width="18" height="18" rx="2"/><path d="M15.5 4v7M24.5 4v7M15.5 29v7M24.5 29v7M4 15.5h7M4 24.5h7M29 15.5h7M29 24.5h7"/><path d="M16 22.5l4-5 4 5" /><circle cx="20" cy="17" r="0.2" class="fill"/>'],
  ethernet: ['0 0 40 40', '<path d="M6 9.5h28v19H26v4h-12v-4H6z"/><path d="M12 14v5M16.7 14v5M21.3 14v5M28 14v5"/>'],
  hdmi: ['0 0 44 40', '<path d="M5 13.5h34v8l-4.5 5h-25L5 21.5z"/><path d="M12 18.5h20"/><path d="M22 26.5v8"/>', 'wide'],
  camera: ['0 0 40 40', '<path d="M5.5 13.5h7l3-4.5h9l3 4.5h7v17h-29z"/><circle cx="20" cy="21.5" r="5.5"/><circle cx="20" cy="21.5" r="2" class="fill"/>'],
  fan: ['0 0 40 40', '<rect x="5" y="5" width="30" height="30" rx="4"/><circle cx="20" cy="20" r="2.6" class="fill"/><path d="M20 17.4c-1.5-4.8.6-8.4 4.6-8 1.8 3.4-.8 6.6-4.6 8zM22.6 20c4.8-1.5 8.4.6 8 4.6-3.4 1.8-6.6-.8-8-4.6zM20 22.6c1.5 4.8-.6 8.4-4.6 8-1.8-3.4.8-6.6 4.6-8zM17.4 20c-4.8 1.5-8.4-.6-8-4.6 3.4-1.8 6.6.8 8 4.6z"/>'],
  board: ['0 0 40 40', '<rect x="4.5" y="8.5" width="31" height="23" rx="2.5"/><path d="M9 12.5h20"/><rect x="11" y="17" width="9" height="9" rx="1" class="fill"/><path d="M25 18h6M25 22h6M25 26h4"/>'],
};
function calloutIcon(name) {
  const [vb, body, cls = ''] = ICONS[name] || ICONS.chip;
  return `<svg viewBox="${vb}" class="callout-icon ${cls}" aria-hidden="true">${body}</svg>`;
}

export function createStage({ canvas, tagsEl, leadersEl, tipEl, viewbar, rigEl }) {
  // Look matched 1:1 to the ESP32 track's stage (assets/stage-*.js): no tone
  // mapping, an orthographic camera at azimuth 36° / elevation 43°, a warm
  // hemisphere + key light, a separate soft (VSM) shadow light that only darkens
  // the floor, and ink outlines drawn by a post pass.
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.setClearColor(0, 0);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.VSMShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const composer = new OutlineComposer(renderer, { lineColor: '#141a2c', thickness: 1.3 });

  const scene = new THREE.Scene();
  const DIST = 80;
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 300);
  camera.zoom = 40;
  const VIEW = { azimuth: 36 * Math.PI / 180, elevation: 43 * Math.PI / 180 };
  const viewDir = (az = VIEW.azimuth, el = VIEW.elevation) => new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
  camera.position.copy(viewDir()).multiplyScalar(DIST);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.09;
  controls.minZoom = 6;
  controls.maxZoom = 600;
  controls.maxPolarAngle = Math.PI * 0.47;
  controls.screenSpacePanning = true;

  // image-based light, as on the ESP32 stage
  try {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    scene.environment = pmrem.fromScene(room, 0.04).texture;
    scene.environmentIntensity = 0.4;
    room.dispose?.(); pmrem.dispose();
  } catch {}

  // lights (ESP32 setupLights): hemisphere + key, then a near-zero-intensity
  // light whose only job is the soft contact shadow on the floor
  const hemi = new THREE.HemisphereLight('#fffaf3', '#c2ae90', 0.5);
  scene.add(hemi);
  const key = new THREE.DirectionalLight('#fff6ea', 1.2);
  key.position.set(-55, 100, 62);
  scene.add(key);
  const shade = new THREE.DirectionalLight('#ffffff', 0.001);
  shade.castShadow = true;
  shade.shadow.mapSize.set(2048, 2048);
  shade.shadow.radius = 11;
  shade.shadow.blurSamples = 20;
  shade.shadow.bias = -4e-4;
  const SHADOW_DIR = new THREE.Vector3(40, 104, -34).normalize();
  scene.add(shade, shade.target);
  function fitShadow(center, half) {
    half = Math.max(12, half);
    shade.target.position.copy(center);
    shade.position.copy(center).addScaledVector(SHADOW_DIR, half * 2.2);
    Object.assign(shade.shadow.camera, { left: -half, right: half, top: half, bottom: -half, near: 2, far: half * 5 });
    shade.shadow.camera.updateProjectionMatrix();
    shade.target.updateMatrixWorld();
  }
  fitShadow(new THREE.Vector3(), 12);
  let ambientK = 1;
  function setAmbient(k = 1) { ambientK = k; hemi.intensity = 0.5 * k; key.intensity = 1.2 * k; scene.environmentIntensity = 0.4 * k; }

  // floor (ESP32 setupGround): a warm shadow catcher plus a shader grid that
  // fades out around the view target; both on layer 1, so they get no outline
  const shadowMat = new THREE.ShadowMaterial({ color: new THREE.Color('#7a5532'), opacity: 0.32, depthWrite: false });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), shadowMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.005;
  floor.receiveShadow = true;
  floor.layers.set(1);
  scene.add(floor);
  const gridMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { color: { value: new THREE.Color('#e0d0b9') }, cell: { value: 0.9 }, center: { value: new THREE.Vector2() }, inner: { value: 38 }, outer: { value: 84 }, strength: { value: 0.9 } },
    vertexShader: `
      varying vec2 vPos;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vPos = wp.xz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: `
      uniform vec3 color;
      uniform float cell;
      uniform vec2 center;
      uniform float inner;
      uniform float outer;
      uniform float strength;
      varying vec2 vPos;
      void main() {
        vec2 g = abs(fract(vPos / cell - 0.5) - 0.5) / fwidth(vPos / cell);
        float line = 1.0 - min(min(g.x, g.y), 1.0);
        vec2 q = (vPos - center) / vec2(1.25, 1.0);
        float fade = 1.0 - smoothstep(inner, outer, length(q));
        float a = line * fade * strength;
        gl_FragColor = vec4(color, a);
        #include <colorspace_fragment>
      }`,
  });
  const grid = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), gridMat);
  grid.rotation.x = -Math.PI / 2;
  grid.position.y = -0.01;
  grid.layers.set(1);
  grid.renderOrder = -1;
  scene.add(grid);
  function applyTheme() {
    const dark = isDark();
    gridMat.uniforms.color.value.set(dark ? '#3a4352' : '#e0d0b9');
    shadowMat.color.set(dark ? '#000000' : '#7a5532');
    shadowMat.opacity = dark ? 0.5 : 0.32;
    composer.setLineColor(dark ? '#0b0e17' : '#141a2c');
  }
  applyTheme();
  addEventListener('cd-theme', applyTheme);

  const content = new THREE.Group();
  scene.add(content);
  const wires = new THREE.Group();
  scene.add(wires);

  // glow sprites, see-through parts and helper lines go on layer 1 (no outline);
  // re-checked a few times a second as parts come and go
  let layerCheck = 0;
  function assignLayers() {
    for (const root of [content, wires]) root.traverse((o) => {
      if (o.userData.outline === true) return;
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      if (o.isSprite || o.isLine || o.isPoints || o.userData.outline === false || (m && m.transparent && (m.opacity < 0.75 || m.blending === THREE.AdditiveBlending))) {
        if (o.layers.mask !== 2) o.layers.set(1);
      }
    });
  }

  // ------------------------------------------------------------------ size
  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    const pr = renderer.getPixelRatio();
    if (canvas.width !== Math.round(w * pr) || canvas.height !== Math.round(h * pr)) {
      renderer.setSize(w, h, false);
      composer.setSize(w, h, pr);
    }
    camera.left = -w / 2; camera.right = w / 2; camera.top = h / 2; camera.bottom = -h / 2;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(canvas);

  // ------------------------------------------------------------------ view
  let home = { pos: camera.position.clone(), target: new THREE.Vector3(), zoom: camera.zoom };
  const isHome = () => !anim && camera.position.distanceTo(home.pos) < 0.05 * DIST && controls.target.distanceTo(home.target) < 0.5 && Math.abs(camera.zoom / home.zoom - 1) < 0.04;
  function frame(objects = [content, wires], opts = {}) {
    const box = new THREE.Box3();
    for (const o of objects) box.expandByObject(o);
    if (box.isEmpty()) return;
    resize();
    const center = box.getCenter(new THREE.Vector3());
    center.y = Math.min(center.y, 1.2);
    if (opts.offset) center.add(new THREE.Vector3(...opts.offset));
    const dir = viewDir(VIEW.azimuth + (opts.azimuth || 0), opts.elevation ?? VIEW.elevation);
    camera.position.copy(center).addScaledVector(dir, DIST);
    camera.lookAt(center);
    camera.updateMatrixWorld();
    // fit the box's projected extent into the canvas
    const inv = camera.matrixWorldInverse, p = new THREE.Vector3();
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
      p.set(x, y, z).applyMatrix4(inv);
      x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
    }
    const W = canvas.clientWidth || 800, H = canvas.clientHeight || 500;
    const fill = opts.fill ?? 0.8;
    camera.zoom = Math.min(W / (x1 - x0), H / (y1 - y0)) * fill;
    camera.updateProjectionMatrix();
    const look = center.clone();
    if (opts.shift) { // move the framed box on screen by [x, y] px (down = +y), e.g. to centre it on the callout rig
      const d = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).multiplyScalar(-opts.shift[0] / camera.zoom)
        .addScaledVector(new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1), opts.shift[1] / camera.zoom);
      camera.position.add(d); look.add(d);
    }
    controls.minZoom = camera.zoom * 0.3;
    controls.maxZoom = camera.zoom * 8;
    controls.target.copy(look);
    controls.update();
    home = { pos: camera.position.clone(), target: look.clone(), zoom: camera.zoom };
    const size = box.getSize(new THREE.Vector3());
    // like the ESP32 stage the floor sits a little below the parts (4 mm), so the
    // soft shadow shows as a lifted contact shadow
    floor.position.y = box.min.y - 0.4; grid.position.y = box.min.y - 0.405;
    fitShadow(center.clone().setY(box.min.y), Math.max(size.x, size.z) * 0.62 + 2.4);
    renderer.shadowMap.needsUpdate = true;
  }
  function rotate(angle) {
    const off = camera.position.clone().sub(controls.target);
    off.applyAxisAngle(new THREE.Vector3(0, 1, 0), angle);
    tween(controls.target.clone().add(off), controls.target.clone());
  }
  function zoom(f) {
    const z = THREE.MathUtils.clamp(camera.zoom / f, controls.minZoom, controls.maxZoom);
    tween(camera.position.clone(), controls.target.clone(), 450, z);
  }
  let anim = null;
  function tween(pos, target, ms = 450, z = camera.zoom) {
    anim = { from: camera.position.clone(), to: pos, tFrom: controls.target.clone(), tTo: target, zFrom: camera.zoom, zTo: z, t0: performance.now(), ms };
  }
  function reset() { tween(home.pos.clone(), home.target.clone(), 450, home.zoom); }
  function getView() { return { pos: camera.position.clone(), target: controls.target.clone(), zoom: camera.zoom }; }
  function setView(v) {
    if (!v) return;
    camera.position.copy(v.pos); controls.target.copy(v.target);
    if (v.zoom) { camera.zoom = v.zoom; camera.updateProjectionMatrix(); }
    controls.update();
  }

  viewbar?.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-view]');
    if (!b) return;
    const v = b.dataset.view;
    if (v === 'left') rotate(Math.PI / 4);
    else if (v === 'right') rotate(-Math.PI / 4);
    else if (v === 'in') zoom(0.75);
    else if (v === 'out') zoom(1.33);
    else if (v === 'reset') reset();
  });
  addEventListener('keydown', (e) => {
    if (e.target.closest?.('input, textarea, select, [contenteditable]')) return;
    if (e.key === 'q' || e.key === 'Q') rotate(Math.PI / 4);
    else if (e.key === 'e' || e.key === 'E') rotate(-Math.PI / 4);
    else if (e.key === '+' || e.key === '=') zoom(0.75);
    else if (e.key === '-') zoom(1.33);
    else if (e.key === 'r' || e.key === 'R') reset();
  });

  // ------------------------------------------------------------------ picking
  const ray = new THREE.Raycaster();
  ray.layers.enableAll();
  const ndc = new THREE.Vector2();
  let onPick = null, onHover = null, downAt = null;
  function hit(ev) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects([content, wires], true);
    // pin dots (sandbox) win over whatever mesh is in front of them
    const dot = hits.find((h) => h.object.userData.pick?.pin);
    if (dot) return { object: dot.object, point: dot.point, info: dot.object.userData.info, pick: dot.object.userData.pick };
    for (const h of hits) {
      let o = h.object;
      while (o && !o.userData.info && !o.userData.pick) o = o.parent;
      if (o) return { object: o, point: h.point, info: o.userData.info, pick: o.userData.pick };
    }
    return null;
  }
  canvas.addEventListener('pointerdown', (e) => { downAt = { x: e.clientX, y: e.clientY }; });
  canvas.addEventListener('pointerup', (e) => {
    if (!downAt) return;
    const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
    downAt = null;
    if (moved > 5) return;
    onPick?.(hit(e), e);
  });
  let hoverRaf = 0;
  canvas.addEventListener('pointermove', (e) => {
    if (hoverRaf || e.buttons) return;
    hoverRaf = requestAnimationFrame(() => {
      hoverRaf = 0;
      const h = hit(e);
      canvas.style.cursor = h ? 'pointer' : '';
      onHover?.(h, e);
      if (tipEl) {
        const info = h?.info;
        if (info) {
          const sr = tipEl.parentElement.getBoundingClientRect();
          const sc = sr.width / tipEl.parentElement.offsetWidth || 1;
          tipEl.querySelector('b').textContent = info.title;
          tipEl.querySelector('span').textContent = info.hint || 'Click for details';
          tipEl.style.transform = `translate(${(e.clientX - sr.left) / sc + 14}px, ${(e.clientY - sr.top) / sc + 12}px)`;
          tipEl.classList.add('is-on');
        } else tipEl.classList.remove('is-on');
      }
    });
  });
  canvas.addEventListener('pointerleave', () => tipEl?.classList.remove('is-on'));

  // ------------------------------------------------------------------ tags
  let tags = [];
  function setTags(list) {
    tagsEl.querySelectorAll('.tag:not(.cd-ctag)').forEach((t) => t.remove());
    leadersEl.querySelectorAll('.leader-set:not(.cd-callouts)').forEach((g) => g.remove()); // keep the callout leaders
    const set = document.createElementNS(SVGNS, 'g');
    set.setAttribute('class', 'leader-set');
    leadersEl.append(set);
    tags = list.map((t) => {
      const btn = document.createElement('button');
      btn.className = 'tag';
      btn.type = 'button';
      btn.style.setProperty('--c', t.color);
      btn.innerHTML = '<span></span>';
      btn.firstChild.textContent = t.label;
      if (t.onClick) btn.addEventListener('click', t.onClick);
      tagsEl.append(btn);
      const g = document.createElementNS(SVGNS, 'g');
      g.setAttribute('class', 'leader');
      g.style.setProperty('--c', t.color);
      const path = document.createElementNS(SVGNS, 'path');
      const hs = document.createElementNS(SVGNS, 'g');
      hs.setAttribute('class', t.onClick ? 'hotspot' : 'hotspot is-passive');
      hs.innerHTML = '<circle r="13.6" class="dot-hit"></circle><circle r="7.6" class="dot-halo"></circle><circle r="6.4" class="dot-anchor"></circle>';
      if (t.onClick) hs.addEventListener('click', t.onClick);
      g.append(path, hs);
      set.append(g);
      return { ...t, btn, path, hs, w: 0 };
    });
    tagsEl.classList.add('is-free');
  }
  const v = new THREE.Vector3();
  function placeTags() {
    if (!tags.length) return;
    const W = canvas.clientWidth, H = canvas.clientHeight;
    const ox = canvas.offsetLeft, oy = canvas.offsetTop;
    for (const t of tags) {
      if (t.anchor.isObject3D) t.anchor.getWorldPosition(v); else v.copy(t.anchor);
      v.project(camera);
      const x = ox + (v.x + 1) / 2 * W, y = oy + (1 - v.y) / 2 * H;
      const hidden = v.z > 1 || x < -40 || x > W + 40 || y < -40 || y > H + 40;
      t.btn.classList.toggle('is-hidden', hidden);
      if (!t.w) t.w = t.btn.offsetWidth || 80;
      const lift = t.lift ?? 46;
      const tx = Math.max(4, Math.min(W - t.w - 4, x - t.w / 2)), ty = Math.max(4, y - lift - 26);
      t.btn.style.transform = `translate(${tx}px, ${ty}px)`;
      t.hs.setAttribute('transform', `translate(${x} ${y})`);
      t.path.setAttribute('d', `M${x} ${y} L${x} ${ty + 26}`);
    }
  }
  function setTagsVisible(on) { tagsEl.classList.toggle('is-off', !on); leadersEl.classList.toggle('is-off', !on); }

  // ------------------------------------------------------------------ callouts
  // ESP32-style callout cards: an icon + title + text card pinned around the
  // board in the default view, with a dotted leader in the card's colour to a dot
  // on the part. When the view moves away from home (or on phones) the cards fade
  // and a small tag follows each part instead.
  const CALLOUT_COLORS = ['#f86b1d', '#eeb12e', '#8f45b8', '#2f78c4', '#e0463c', '#26a586'];
  let callouts = [], calloutSet = null;
  function setCallouts(list = []) {
    for (const c of callouts) { c.card.remove(); c.tag.remove(); }
    calloutSet?.remove();
    callouts = [];
    calloutSet = null;
    if (!list.length || !rigEl) return;
    calloutSet = document.createElementNS(SVGNS, 'g');
    calloutSet.setAttribute('class', 'leader-set cd-callouts');
    leadersEl.append(calloutSet);
    callouts = list.map((c, i) => {
      const color = c.color || CALLOUT_COLORS[i % CALLOUT_COLORS.length];
      const card = document.createElement('article');
      card.className = 'callout has-dot is-hidden';
      card.tabIndex = 0;
      card.dataset.side = 'bottom';
      card.style.setProperty('--w', `${c.w || 236}px`);
      card.style.setProperty('--x', `${c.x}px`);
      card.style.setProperty('--y', `${c.y}px`);
      card.style.setProperty('--c', color);
      card.innerHTML = `${calloutIcon(c.icon)}<div><h3></h3><p></p></div>`;
      card.querySelector('h3').textContent = c.title;
      card.querySelector('p').innerHTML = c.body || '';
      rigEl.append(card);
      const g = document.createElementNS(SVGNS, 'g');
      g.setAttribute('class', 'leader');
      g.style.setProperty('--c', color);
      const path = document.createElementNS(SVGNS, 'path');
      const hs = document.createElementNS(SVGNS, 'g');
      hs.setAttribute('class', c.onClick ? 'hotspot' : 'hotspot is-passive');
      hs.innerHTML = '<circle r="13.6" class="dot-hit"></circle><circle r="7.6" class="dot-halo"></circle><circle r="6.4" class="dot-anchor"></circle>';
      g.append(path, hs);
      calloutSet.append(g);
      const tag = document.createElement('button');
      tag.type = 'button';
      tag.className = 'tag cd-ctag is-hidden';
      tag.style.setProperty('--c', color);
      tag.innerHTML = '<span></span>';
      tag.firstChild.textContent = c.title;
      tagsEl.append(tag);
      if (c.onClick) for (const el of [card, hs, tag]) el.addEventListener('click', c.onClick);
      card.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && c.onClick) { e.preventDefault(); c.onClick(e); } });
      for (const el of [card, hs, tag]) {
        el.addEventListener('pointerenter', () => g.classList.add('is-hot'));
        el.addEventListener('pointerleave', () => g.classList.remove('is-hot'));
      }
      return { ...c, card, g, path, hs, tag, side: null, at: null };
    });
    requestAnimationFrame(() => requestAnimationFrame(() => callouts.forEach((c, i) => { c.card.style.transitionDelay = `${i * 50}ms`; c.card.classList.remove('is-hidden'); })));
  }
  let calloutsFree = null;
  function placeCallouts() {
    if (!callouts.length) return;
    const compact = document.documentElement.classList.contains('compact');
    const free = compact || !isHome() || tagsEl.classList.contains('is-off');
    if (free !== calloutsFree) {
      calloutsFree = free;
      rigEl.classList.toggle('is-free', free);
      calloutSet.classList.toggle('is-hidden', free);
      for (const c of callouts) c.tag.classList.toggle('is-hidden', !free);
    }
    const W = canvas.clientWidth, H = canvas.clientHeight;
    const ox = canvas.offsetLeft, oy = canvas.offsetTop;
    for (const c of callouts) {
      if (c.anchor.isObject3D) c.anchor.getWorldPosition(v); else v.copy(c.anchor);
      v.project(camera);
      const x = ox + (v.x + 1) / 2 * W, y = oy + (1 - v.y) / 2 * H;
      c.hs.setAttribute('transform', `translate(${x} ${y})`);
      if (free) {
        if (!c.tw) c.tw = c.tag.offsetWidth || 90;
        c.tag.style.transform = `translate(${Math.max(4, Math.min(W - c.tw - 4, x + 13))}px, ${Math.max(4, y - 13 - 26)}px)`;
        continue;
      }
      // card rect in stage coordinates
      const r = { x: rigEl.offsetLeft + c.card.offsetLeft, y: rigEl.offsetTop + c.card.offsetTop, w: c.card.offsetWidth, h: c.card.offsetHeight };
      const dx = (x - (r.x + r.w / 2)) / (r.w / 2), dy = (y - (r.y + r.h / 2)) / (r.h / 2);
      let side, at;
      if (c.side0) side = c.side0;
      else side = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'top' : 'bottom');
      if (side === 'left' || side === 'right') at = Math.round(Math.min(r.h - 20, Math.max(20, y - r.y)));
      else at = Math.round(Math.min(r.w - 30, Math.max(30, x - r.x)));
      if (c.side !== side) { c.side = side; c.card.dataset.side = side; }
      if (c.at !== at) { c.at = at; c.card.style.setProperty('--at', `${at}px`); }
      const leg = c.leg ?? 24;
      let p0, p1;
      if (side === 'top') { p0 = [r.x + at, r.y]; p1 = [p0[0], p0[1] - leg]; }
      else if (side === 'left') { p0 = [r.x, r.y + at]; p1 = [p0[0] - leg, p0[1]]; }
      else if (side === 'right') { p0 = [r.x + r.w, r.y + at]; p1 = [p0[0] + leg, p0[1]]; }
      else { p0 = [r.x + at, r.y + r.h]; p1 = [p0[0], p0[1] + leg]; }
      c.path.setAttribute('d', `M${p0[0]} ${p0[1]} L${p1[0]} ${p1[1]} L${x} ${y}`);
    }
  }

  // ------------------------------------------------------------------ wires
  function addWire(a, b, color, opts = {}) {
    const m = opts.ribbon ? makeRibbon(a, b, opts.width, color) : makeWire(a, b, color, opts);
    if (opts.pick) m.userData.pick = opts.pick;
    if (opts.info) m.userData.info = opts.info;
    wires.add(m);
    return m;
  }
  function clearWires() {
    for (const m of [...wires.children]) { wires.remove(m); m.geometry.dispose(); }
  }
  function clear() {
    clearWires();
    for (const o of [...content.children]) content.remove(o);
    setTags([]);
    setCallouts([]);
  }

  // ------------------------------------------------------------------ loop
  const ticks = new Set();
  let last = performance.now(), elapsed = 0;
  let running = true;
  function loop() {
    if (!running) return;
    requestAnimationFrame(loop);
    const now = performance.now(), dt = Math.min((now - last) / 1000, 0.1); last = now; elapsed += dt; const t = elapsed;
    if (anim) {
      const k = Math.min(1, (performance.now() - anim.t0) / anim.ms), e = 1 - Math.pow(1 - k, 3);
      // swing around the target (keeps the camera distance) rather than cutting across
      const a0 = anim.from.clone().sub(anim.tFrom), a1 = anim.to.clone().sub(anim.tTo);
      const s0 = new THREE.Spherical().setFromVector3(a0), s1 = new THREE.Spherical().setFromVector3(a1);
      let dth = s1.theta - s0.theta; dth = Math.atan2(Math.sin(dth), Math.cos(dth));
      const sp = new THREE.Spherical(s0.radius + (s1.radius - s0.radius) * e, s0.phi + (s1.phi - s0.phi) * e, s0.theta + dth * e);
      controls.target.lerpVectors(anim.tFrom, anim.tTo, e);
      camera.position.setFromSpherical(sp).add(controls.target);
      camera.zoom = anim.zFrom + (anim.zTo - anim.zFrom) * e;
      camera.updateProjectionMatrix();
      if (k >= 1) anim = null;
    }
    controls.update();
    for (const f of ticks) f(t, dt);
    if (now > layerCheck) { layerCheck = now + 400; assignLayers(); }
    render();
    placeTags();
    placeCallouts();
  }
  let shadowAt = 0;
  function render(target = null) {
    // the floor grid fades out around the view target, like the ESP32 floor
    const u = gridMat.uniforms;
    u.center.value.set(controls.target.x, controls.target.z);
    u.inner.value = 190 / camera.zoom; u.outer.value = 470 / camera.zoom; // constant on screen
    composer.setLineScale(Math.min(1, Math.max(0.6, Math.sqrt(camera.zoom / 60))));
    // the floor shadow is world-space: refresh it a few times a second, not every frame
    const now = performance.now();
    if (now > shadowAt) { shadowAt = now + 300; renderer.shadowMap.needsUpdate = true; }
    composer.render(scene, camera, target);
  }
  resize();
  loop();

  return {
    renderer, scene, camera, controls, content, wires, composer,
    frame, reset, rotate, zoom, getView, setView, setAmbient, isHome, setCallouts, render, setTags, setTagsVisible, addWire, clearWires, clear, resize,
    onPick(fn) { onPick = fn; }, onHover(fn) { onHover = fn; },
    addTick(f) { ticks.add(f); return () => ticks.delete(f); },
    clearTicks() { ticks.clear(); },
    stop() { running = false; },
    snapshot(w = 480, h = 300) {
      // render a still at a fixed size (for thumbnails)
      const pr = renderer.getPixelRatio();
      const old = new THREE.Vector2(); renderer.getSize(old);
      renderer.setPixelRatio(1);
      renderer.setSize(w, h, false); composer.setSize(w, h, 1);
      const L = camera.left, R = camera.right, T = camera.top, B = camera.bottom;
      const sc = Math.min(w / (old.x || w), h / (old.y || h));
      camera.left = -w / 2 / sc; camera.right = w / 2 / sc; camera.top = h / 2 / sc; camera.bottom = -h / 2 / sc;
      camera.updateProjectionMatrix();
      render();
      const url = canvas.toDataURL('image/png');
      camera.left = L; camera.right = R; camera.top = T; camera.bottom = B; camera.updateProjectionMatrix();
      renderer.setPixelRatio(pr);
      renderer.setSize(old.x, old.y, false); composer.setSize(old.x, old.y, pr); resize();
      return url;
    },
  };
}
