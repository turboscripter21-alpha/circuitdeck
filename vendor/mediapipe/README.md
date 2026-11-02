# Vendored MediaPipe (in-browser ML camera)

Served as static files so the ML camera works without a CDN and no video leaves the browser.

- `vision_bundle.mjs`, `wasm/` — `@mediapipe/tasks-vision` (Google, Apache License 2.0,
  https://github.com/google-ai-edge/mediapipe). See http://www.apache.org/licenses/LICENSE-2.0.
- `models/` — pre-trained MediaPipe task models, Apache License 2.0
  (https://ai.google.dev/edge/mediapipe/solutions/vision): EfficientDet-Lite0 object detector
  (COCO), BlazeFace short-range face detector, Pose Landmarker (lite), Hand Landmarker.

Used by `shared/ml-camera.js`. QR decoding uses `vendor/jsqr` (Apache License 2.0, see its LICENSE).
