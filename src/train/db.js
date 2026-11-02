// M10: the Train panel's dataset, kept in IndexedDB so it survives reloads.
// 'meta'    key = sensor ('camera' | 'mic' | 'motion') → { sensor, classes: [{ id, name }], nextClass }
// 'samples' auto id → { id, sensor, cls, data: Float32Array, thumb?: dataURL, t }
const DB = 'circuitdeck-train';
let dbp = null;
function open() {
  return (dbp ||= new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => {
      const db = r.result;
      db.createObjectStore('meta', { keyPath: 'sensor' });
      const s = db.createObjectStore('samples', { keyPath: 'id', autoIncrement: true });
      s.createIndex('sensor', 'sensor');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
}
const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
async function tx(store, mode = 'readonly') { return (await open()).transaction(store, mode).objectStore(store); }

export const DEFAULT_CLASSES = { camera: ['on', 'off'], mic: ['clap', 'quiet'], motion: ['left', 'right'] };
export async function getMeta(sensor) {
  const m = await req((await tx('meta')).get(sensor));
  if (m) return m;
  const names = DEFAULT_CLASSES[sensor];
  const meta = { sensor, classes: names.map((name, i) => ({ id: i + 1, name })), nextClass: names.length + 1 };
  await putMeta(meta);
  return meta;
}
export async function putMeta(meta) { await req((await tx('meta', 'readwrite')).put(meta)); }
export async function listSamples(sensor) { return req((await tx('samples')).index('sensor').getAll(sensor)); }
export async function addSample(s) { return req((await tx('samples', 'readwrite')).add({ ...s, t: Date.now() })); }
export async function deleteSample(id) { await req((await tx('samples', 'readwrite')).delete(id)); }
export async function deleteClassSamples(sensor, cls) {
  const all = await listSamples(sensor);
  const store = await tx('samples', 'readwrite');
  await Promise.all(all.filter((s) => s.cls === cls).map((s) => req(store.delete(s.id))));
}
export async function clearSensor(sensor) {
  const all = await listSamples(sensor);
  const store = await tx('samples', 'readwrite');
  await Promise.all(all.map((s) => req(store.delete(s.id))));
  await req((await tx('meta', 'readwrite')).delete(sensor));
}
