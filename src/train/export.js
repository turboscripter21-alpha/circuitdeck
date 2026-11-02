// M10: the download bundles. ESP32 zip = Arduino sketch + generated model_data.h;
// Pi 5 zip = Python runtime + model.json. Firmware sources are fetched from /firmware/.
import { makeZip } from './zip.js';
import { exportJSON, exportBlob, blobToHeader } from './model.js';
import { SENSORS } from './spec.js';

const ESP_FILES = ['circuitdeck_ml.ino', 'cd_model.h', 'cd_features.h', 'partitions.csv', 'README.md'];
const PI_FILES = ['cd_infer.py', 'cdmodel.py', 'requirements.txt', 'README.md'];
const get = async (p) => { const r = await fetch(p); if (!r.ok) throw new Error(`Could not load ${p}`); return r.text(); };

function summary(sensor, classes, actions, extra = '') {
  return `CircuitDeck Train panel export: ${new Date().toISOString()}
Sensor:  ${SENSORS[sensor].label} (${SENSORS[sensor].unit})
Classes: ${classes.map((c, i) => `${i}=${c} → ${actions[i] || 'none'}`).join(', ')}
${extra}`;
}
export async function esp32Zip(model, sensor, classes, actions) {
  const { blob, quantErr } = exportBlob(model, sensor, classes, actions);
  const files = await Promise.all(ESP_FILES.map(async (f) => ({ name: `circuitdeck_ml/${f}`, data: await get(`/firmware/esp32/circuitdeck_ml/${f}`) })));
  files.push({ name: 'circuitdeck_ml/model_data.h', data: blobToHeader(blob) });
  files.push({ name: 'circuitdeck_ml/model.cdm', data: blob });
  files.push({ name: 'circuitdeck_ml/MODEL.txt', data: summary(sensor, classes, actions, `Blob: ${blob.length} bytes, int8 weights (max quantisation error ${quantErr.toExponential(2)}).\n${sensor === 'camera' ? 'Note: camera models need the MobileNet extractor, so they run on the Pi 5. The sketch will say so.\n' : ''}`) });
  return { zip: makeZip(files), blob, name: `circuitdeck-${sensor}-esp32.zip` };
}
export async function piZip(model, sensor, classes, actions) {
  const json = exportJSON(model, sensor, classes, actions);
  const files = await Promise.all(PI_FILES.map(async (f) => ({ name: `circuitdeck_ml_pi5/${f}`, data: await get(`/firmware/pi5/${f}`) })));
  files.push({ name: 'circuitdeck_ml_pi5/model.json', data: JSON.stringify(json) });
  files.push({ name: 'circuitdeck_ml_pi5/labels.txt', data: classes.join('\n') + '\n' });
  files.push({ name: 'circuitdeck_ml_pi5/MODEL.txt', data: summary(sensor, classes, actions) });
  return { zip: makeZip(files), json, name: `circuitdeck-${sensor}-pi5.zip` };
}
export function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
