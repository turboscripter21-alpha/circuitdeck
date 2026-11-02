// M10: the feature definitions. These numbers are the contract between the browser and
// the exported firmware/Python, which compute the same features on the device.
export const SENSORS = {
  camera: { label: 'Camera', unit: 'image', desc: 'Images. MobileNet V2 (frozen) turns each one into 1280 numbers, and a small dense head learns your classes.' },
  mic: { label: 'Microphone', unit: '1 s clip', desc: '1 s of sound as a spectrogram: 40 frames (25 ms hop) × 32 log-spaced bands (80 Hz–8 kHz). A small 2D CNN learns it.' },
  motion: { label: 'Motion', unit: '2 s window', desc: '2 s of phone motion at 20 Hz: acceleration x/y/z (÷9.81) + rotation rate α/β/γ (÷250 °/s). A small 1D-conv net learns it.' },
};
export const IMG = 224;            // MobileNet input
export const EMBED = 1280;         // pooled MobileNet features
export const MIC = { frames: 40, bands: 32, hopMs: 25, fMin: 80, fMax: 8000, dbMin: -100, dbMax: -30 };
export const MOTION = { steps: 40, hz: 20, ch: 6, gScale: 9.81, rScale: 250 };
export const SENSOR_CODE = { camera: 0, mic: 1, motion: 2 };
export const ACTIONS = [
  { id: 'none', label: 'Nothing' },
  { id: 'led', label: 'LED on' },
  { id: 'relay', label: 'Relay on' },
  { id: 'buzzer', label: 'Buzzer on' },
];
// band edges in Hz, shared with the firmware (cd_features.h) and the Pi script
export function bandEdges({ bands, fMin, fMax } = MIC) {
  const e = [];
  for (let i = 0; i <= bands; i++) e.push(fMin * (fMax / fMin) ** (i / bands));
  return e;
}
export function inputShape(sensor) {
  return sensor === 'camera' ? [EMBED] : sensor === 'mic' ? [MIC.frames, MIC.bands, 1] : [MOTION.steps, MOTION.ch];
}
