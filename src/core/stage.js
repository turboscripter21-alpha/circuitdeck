// The 3D stage: renderer, camera, orbit controls, lights, a theme-aware floor,
// click-to-inspect picking, and DOM tags/hotspots that follow 3D anchors.
import * as THREE from 'three';
import { OrbitControls } from '/vendor/three/OrbitControls.min.js';
import { wire as makeWire, ribbon as makeRibbon } from './kit.js';

const isDark = () => document.documentElement.dataset.theme === 'dark';
const SVGNS = 'http://www.w3.org/2000/svg';

export function createStage({ canvas, tagsEl, leadersEl, tipEl, viewbar }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.5, 400);
  camera.position.set(0, 26, 30);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.09;
  controls.minDistance = 6;
  controls.maxDistance = 90;
  controls.maxPolarAngle = Math.PI * 0.47;
  controls.screenSpacePanning = true;

  // lights
  const hemi = new THREE.HemisphereLight(0xfff7ec, 0x8a7a66, 1.25);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 2.1);
  sun.position.set(-14, 30, 18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 90 });
  sun.shadow.bias = -0.0006;
  sun.shadow.radius = 5;
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xdfe8ff, 0.55);
  fill.position.set(18, 12, -14);
  scene.add(fill);

  // floor: a shadow catcher plus a faint grid, both following the theme
  const shadowMat = new THREE.ShadowMaterial({ opacity: 0.16 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), shadowMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.01;
  floor.receiveShadow = true;
  scene.add(floor);
  let grid = null;
  function makeGrid() {
    if (grid) { scene.remove(grid); grid.geometry.dispose(); grid.material.dispose(); }
    const dark = isDark();
    grid = new THREE.GridHelper(120, 60, dark ? 0x5b6577 : 0xd9c7ae, dark ? 0x394150 : 0xe8dcc9);
    grid.material.transparent = true;
    grid.material.opacity = dark ? 0.55 : 0.7;
    grid.position.y = -0.02;
    scene.add(grid);
    shadowMat.opacity = dark ? 0.32 : 0.16;
    hemi.intensity = dark ? 1.05 : 1.25;
  }
  makeGrid();
  addEventListener('cd-theme', makeGrid);

  const content = new THREE.Group();
  scene.add(content);
  const wires = new THREE.Group();
  scene.add(wires);

  // ------------------------------------------------------------------ size
  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    if (canvas.width !== Math.round(w * renderer.getPixelRatio()) || canvas.height !== Math.round(h * renderer.getPixelRatio())) {
      renderer.setSize(w, h, false);
    }
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(canvas);

  // ------------------------------------------------------------------ view
  let home = { pos: camera.position.clone(), target: new THREE.Vector3() };
  function frame(objects = [content, wires], opts = {}) {
    const box = new THREE.Box3();
    for (const o of objects) box.expandByObject(o);
    if (box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(size.x, size.z * 1.1, size.y) * 0.62 + 1;
    resize();
    const fov = THREE.MathUtils.degToRad(camera.fov);
    const fit = Math.max(radius / Math.tan(fov / 2), radius / (Math.tan(fov / 2) * camera.aspect));
    const dist = fit * (opts.zoom ?? 1.05);
    const dir = new THREE.Vector3(0, opts.elev ?? 0.95, opts.depth ?? 1.0).normalize();
    if (opts.azimuth) dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), opts.azimuth);
    center.y = Math.min(center.y, 1.2);
    camera.position.copy(center).addScaledVector(dir, dist);
    controls.target.copy(center);
    controls.update();
    home = { pos: camera.position.clone(), target: center.clone() };
  }
  function rotate(angle) {
    const off = camera.position.clone().sub(controls.target);
    off.applyAxisAngle(new THREE.Vector3(0, 1, 0), angle);
    tween(controls.target.clone().add(off), controls.target.clone());
  }
  function zoom(f) {
    const off = camera.position.clone().sub(controls.target).multiplyScalar(f);
    const d = THREE.MathUtils.clamp(off.length(), controls.minDistance, controls.maxDistance);
    off.setLength(d);
    tween(controls.target.clone().add(off), controls.target.clone());
  }
  let anim = null;
  function tween(pos, target, ms = 450) {
    anim = { from: camera.position.clone(), to: pos, tFrom: controls.target.clone(), tTo: target, t0: performance.now(), ms };
  }
  function reset() { tween(home.pos.clone(), home.target.clone()); }

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
    tagsEl.querySelectorAll('.tag').forEach((t) => t.remove());
    leadersEl.innerHTML = '';
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
      camera.position.lerpVectors(anim.from, anim.to, e);
      controls.target.lerpVectors(anim.tFrom, anim.tTo, e);
      if (k >= 1) anim = null;
    }
    controls.update();
    for (const f of ticks) f(t, dt);
    renderer.render(scene, camera);
    placeTags();
  }
  resize();
  loop();

  return {
    renderer, scene, camera, controls, content, wires,
    frame, reset, rotate, zoom, setTags, setTagsVisible, addWire, clearWires, clear, resize,
    onPick(fn) { onPick = fn; }, onHover(fn) { onHover = fn; },
    addTick(f) { ticks.add(f); return () => ticks.delete(f); },
    clearTicks() { ticks.clear(); },
    stop() { running = false; },
    snapshot(w = 480, h = 300) {
      // render a still at a fixed size (for thumbnails)
      const old = new THREE.Vector2(); renderer.getSize(old);
      renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
      renderer.render(scene, camera);
      const url = canvas.toDataURL('image/png');
      renderer.setSize(old.x, old.y, false); resize();
      return url;
    },
  };
}
