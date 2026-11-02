// CircuitDeck in-browser ML camera: the visitor's own webcam, run through vendored MediaPipe
// Tasks Vision models (objects, faces, pose, hands) or jsQR, entirely on this device.
// Nothing is uploaded: frames go from <video> to the model and to a canvas, never to a server.
//
//   const cam = await CircuitDeckML.start({ mode: 'objects' | 'faces' | 'pose' | 'hands' | 'qr' });
//   cam.latest  -> { ready, mode, people, faces, labels: [{ name, score, box }], poses, hands, qr, fps }
//   cam.draw(ctx, w, h)   paints the frame + overlays (cover-fit) into a canvas
//   cam.stop()
const BASE = '/vendor/mediapipe';
const MODELS = {
  objects: { task: 'ObjectDetector', file: 'models/efficientdet_lite0.tflite', opts: { scoreThreshold: 0.45, maxResults: 8 } },
  faces: { task: 'FaceDetector', file: 'models/blaze_face_short_range.tflite', opts: { minDetectionConfidence: 0.5 } },
  pose: { task: 'PoseLandmarker', file: 'models/pose_landmarker_lite.task', opts: { numPoses: 2 } },
  hands: { task: 'HandLandmarker', file: 'models/hand_landmarker.task', opts: { numHands: 2 } },
};
const POSE_LINKS = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28], [0, 11], [0, 12]];
const HAND_LINKS = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]];

// The wasm runtime prints TFLite/XNNPACK start-up notes ("INFO: Created TensorFlow Lite XNNPACK
// delegate for CPU.") through console.error. They are not errors; keep them out of the console.
// Must run before the wasm loader binds console.error, so it is installed on first import.
const NOISE = /^(INFO:|W\d{4} |I\d{4} |E\d{4} .*(gl_context|OpenGL)|Graph successfully started|.*XNNPACK delegate)/;
if (!console.__cdMlQuiet) {
  const err = console.error.bind(console), warn = console.warn.bind(console);
  console.error = (...a) => { if (typeof a[0] === 'string' && NOISE.test(a[0])) return; err(...a); };
  console.warn = (...a) => { if (typeof a[0] === 'string' && NOISE.test(a[0])) return; warn(...a); };
  console.__cdMlQuiet = true;
}

let vision = null, fileset = null, jsqr = null;
const tasks = {};
async function loadTask(mode) {
  if (mode === 'qr') {
    if (!jsqr) await new Promise((res, rej) => { if (window.jsQR) return res(); const s = document.createElement('script'); s.src = '/vendor/jsqr/jsQR.js'; s.onload = res; s.onerror = () => rej(new Error('Could not load the QR reader.')); document.head.appendChild(s); });
    jsqr = window.jsQR;
    return null;
  }
  if (tasks[mode]) return tasks[mode];
  vision ||= await import(`${BASE}/vision_bundle.mjs`);
  fileset ||= await vision.FilesetResolver.forVisionTasks(`${BASE}/wasm`);
  const m = MODELS[mode];
  tasks[mode] = await vision[m.task].createFromOptions(fileset, { baseOptions: { modelAssetPath: `${BASE}/${m.file}`, delegate: 'CPU' }, runningMode: 'VIDEO', ...m.opts });
  return tasks[mode];
}

export function supported() { return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.WebAssembly); }

export async function start({ mode = 'objects', onResult, fps = 12 } = {}) {
  if (!supported()) throw new Error('This browser has no camera access (or no WebAssembly).');
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }, audio: false }); }
  catch (e) { throw new Error(e && e.name === 'NotAllowedError' ? 'Camera permission was blocked — allow it in the address bar to try this.' : e && e.name === 'NotFoundError' ? 'No camera found on this device.' : 'Could not open the camera.'); }
  const video = document.createElement('video');
  video.muted = true; video.playsInline = true; video.srcObject = stream;
  await video.play().catch(() => {});
  const latest = { ready: false, mode, people: 0, faces: 0, labels: [], poses: [], hands: [], qr: null, fps: 0, frames: 0 };
  let task;
  try { task = await loadTask(mode); }
  catch (e) { stream.getTracks().forEach((t) => t.stop()); throw new Error(`Could not load the ${mode} model (${e.message || e}).`); }
  latest.ready = true;
  const qrCanvas = mode === 'qr' ? document.createElement('canvas') : null;
  let stopped = false, last = 0, lastTs = 0, t0 = performance.now();
  function detect(now) {
    if (stopped) return;
    requestAnimationFrame(detect);
    if (now - last < 1000 / fps || video.readyState < 2 || !video.videoWidth) return;
    last = now;
    const W = video.videoWidth, H = video.videoHeight;
    try {
      if (mode === 'qr') {
        const s = 480 / Math.max(W, H); qrCanvas.width = Math.round(W * s); qrCanvas.height = Math.round(H * s);
        const c = qrCanvas.getContext('2d', { willReadFrequently: true }); c.drawImage(video, 0, 0, qrCanvas.width, qrCanvas.height);
        const img = c.getImageData(0, 0, qrCanvas.width, qrCanvas.height);
        const hit = jsqr(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
        latest.qr = hit ? hit.data : null;
        latest.qrBox = hit ? [hit.location.topLeftCorner, hit.location.topRightCorner, hit.location.bottomRightCorner, hit.location.bottomLeftCorner].map((p) => [p.x / qrCanvas.width, p.y / qrCanvas.height]) : null;
      } else {
        const ts = Math.max(lastTs + 1, Math.round(now)); lastTs = ts;
        const r = mode === 'objects' || mode === 'faces' ? task.detectForVideo(video, ts) : task.detectForVideo(video, ts);
        if (mode === 'objects' || mode === 'faces') {
          latest.labels = (r.detections || []).map((d) => { const b = d.boundingBox; const c = d.categories?.[0] || {}; return { name: mode === 'faces' ? 'face' : c.categoryName || 'object', score: c.score ?? 0, box: b ? [b.originX / W, b.originY / H, b.width / W, b.height / H] : null }; });
          latest.people = latest.labels.filter((l) => l.name === 'person').length;
          latest.faces = mode === 'faces' ? latest.labels.length : 0;
        } else if (mode === 'pose') latest.poses = r.landmarks || [];
        else latest.hands = r.landmarks || [];
      }
      latest.frames++;
      latest.fps = Math.round(latest.frames / ((performance.now() - t0) / 1000));
      onResult?.(latest);
    } catch (e) { latest.error = String(e.message || e); }
  }
  requestAnimationFrame(detect);

  function draw(ctx, w, h) {
    const dark = '#0d1218';
    ctx.fillStyle = dark; ctx.fillRect(0, 0, w, h);
    if (video.readyState < 2 || !video.videoWidth) { ctx.fillStyle = '#9aa6b5'; ctx.font = '600 15px "Barlow Semi Condensed", sans-serif'; ctx.textAlign = 'center'; ctx.fillText('Starting your camera…', w / 2, h / 2 + 5); return; }
    const vw = video.videoWidth, vh = video.videoHeight, s = Math.max(w / vw, h / vh);
    const dw = vw * s, dh = vh * s, ox = (w - dw) / 2, oy = (h - dh) / 2;
    // mirrored, like a selfie view
    ctx.save(); ctx.translate(w, 0); ctx.scale(-1, 1); ctx.drawImage(video, w - ox - dw, oy, dw, dh); ctx.restore();
    const X = (nx) => w - (ox + nx * dw), Y = (ny) => oy + ny * dh;
    ctx.lineWidth = 2; ctx.font = '700 12px "Barlow Semi Condensed", sans-serif'; ctx.textAlign = 'left';
    for (const l of latest.labels) {
      if (!l.box) continue;
      const [bx, by, bw, bh] = l.box, x1 = X(bx + bw), y1 = Y(by);
      ctx.strokeStyle = l.name === 'person' || l.name === 'face' ? '#30d158' : '#f0a53a';
      ctx.strokeRect(x1, y1, bw * dw, bh * dh);
      const tag = `${l.name} ${Math.round(l.score * 100)}%`;
      ctx.fillStyle = ctx.strokeStyle; ctx.fillRect(x1, y1 - 16, ctx.measureText(tag).width + 8, 16);
      ctx.fillStyle = '#0d1218'; ctx.fillText(tag, x1 + 4, y1 - 4);
    }
    const skel = (pts, links, col) => {
      ctx.strokeStyle = col; ctx.fillStyle = col;
      for (const [a, b] of links) if (pts[a] && pts[b]) { ctx.beginPath(); ctx.moveTo(X(pts[a].x), Y(pts[a].y)); ctx.lineTo(X(pts[b].x), Y(pts[b].y)); ctx.stroke(); }
      for (const p of pts) { ctx.beginPath(); ctx.arc(X(p.x), Y(p.y), 2.5, 0, Math.PI * 2); ctx.fill(); }
    };
    for (const p of latest.poses) skel(p, POSE_LINKS, '#30d158');
    for (const p of latest.hands) skel(p, HAND_LINKS, '#6b7cff');
    if (latest.qrBox) { ctx.strokeStyle = '#30d158'; ctx.lineWidth = 3; ctx.beginPath(); latest.qrBox.forEach(([nx, ny], i) => { const x = w - (ox + nx * dw), y = oy + ny * dh; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.closePath(); ctx.stroke(); }
    ctx.fillStyle = 'rgba(13,18,24,.72)'; ctx.fillRect(0, h - 20, w, 20);
    ctx.fillStyle = '#e9eef5'; ctx.font = '600 12px "Barlow Semi Condensed", sans-serif';
    ctx.fillText(`Your webcam · ${mode === 'qr' ? 'jsQR' : 'MediaPipe'} on this device · ${latest.fps} fps`, 6, h - 6);
  }
  function stop() { stopped = true; stream.getTracks().forEach((t) => t.stop()); video.srcObject = null; }
  return { latest, draw, stop, video, mode };
}

// A small toggle button any page can drop into a panel.
export function toggleButton({ mode, label = 'Use my webcam', onStart, onStop, onError }) {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'cd-btn cd-ml-btn'; b.dataset.mlMode = mode; b.setAttribute('aria-pressed', 'false');
  const icon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7h3l2-2.5h8L18 7h3v12H3z"/><circle cx="12" cy="13" r="3.6"/></svg>';
  const set = (t) => { b.innerHTML = `${icon}<span>${t}</span>`; };
  set(label);
  let cam = null, busy = false;
  b.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (busy) return;
    if (cam) { cam.stop(); cam = null; b.setAttribute('aria-pressed', 'false'); b.classList.remove('is-down'); set(label); onStop?.(); return; }
    busy = true; set('Loading the model…'); b.classList.add('is-busy');
    try {
      cam = await start({ mode });
      b.setAttribute('aria-pressed', 'true'); b.classList.add('is-down'); set('Stop webcam'); onStart?.(cam);
    } catch (err) { set(label); onError?.(err.message || String(err)); }
    finally { busy = false; b.classList.remove('is-busy'); }
  });
  b.stopCam = () => { if (cam) { cam.stop(); cam = null; b.setAttribute('aria-pressed', 'false'); b.classList.remove('is-down'); set(label); onStop?.(); } };
  return b;
}

window.CircuitDeckML = { start, supported, toggleButton };
