// Procedural models of the Raspberry Pi 5, an ESP32 DevKit and a breadboard,
// plus the pin facts the lessons and the sandbox's wiring checks rely on.
import * as THREE from 'three';
import { COLORS, mat, metal, box, cyl, slab, chip, decal, silk, canvasTexture, info, glowSprite } from './kit.js';
import { buildPi5Model, PI, PI5_LAYOUT } from './pi5model.js';

// ---------------------------------------------------------------------------
// Raspberry Pi 5: the 40-pin header (physical pin -> name, BCM numbering).
export const PI_HEADER = [
  null,
  '3V3', '5V', 'GPIO2', '5V', 'GPIO3', 'GND', 'GPIO4', 'GPIO14', 'GND', 'GPIO15',
  'GPIO17', 'GPIO18', 'GPIO27', 'GND', 'GPIO22', 'GPIO23', '3V3', 'GPIO24', 'GPIO10', 'GND',
  'GPIO9', 'GPIO25', 'GPIO11', 'GPIO8', 'GND', 'GPIO7', 'GPIO0', 'GPIO1', 'GPIO5', 'GND',
  'GPIO6', 'GPIO12', 'GPIO13', 'GND', 'GPIO19', 'GPIO16', 'GPIO26', 'GPIO20', 'GND', 'GPIO21',
];
// Alternate functions worth naming on the Pi 5 header (all handled by RP1).
export const PI_ALT = {
  GPIO2: 'I2C1 SDA', GPIO3: 'I2C1 SCL', GPIO4: 'GPCLK0', GPIO14: 'UART0 TXD', GPIO15: 'UART0 RXD',
  GPIO18: 'PWM0 CH2 · PCM CLK', GPIO12: 'PWM0 CH0', GPIO13: 'PWM0 CH1', GPIO19: 'PWM0 CH3 · PCM FS',
  GPIO10: 'SPI0 MOSI', GPIO9: 'SPI0 MISO', GPIO11: 'SPI0 SCLK', GPIO8: 'SPI0 CE0', GPIO7: 'SPI0 CE1',
  GPIO0: 'ID_SD (HAT EEPROM)', GPIO1: 'ID_SC (HAT EEPROM)', GPIO20: 'PCM DIN', GPIO21: 'PCM DOUT',
};
export const PI_PIN_NUMBER = {};
PI_HEADER.forEach((n, i) => { if (n && n.startsWith('GPIO')) PI_PIN_NUMBER[n] = i; });

// ESP32 DevKit (30-pin "DOIT" layout). Left column top->bottom, right column top->bottom.
export const ESP_LEFT = ['EN', 'GPIO36', 'GPIO39', 'GPIO34', 'GPIO35', 'GPIO32', 'GPIO33', 'GPIO25', 'GPIO26', 'GPIO27', 'GPIO14', 'GPIO12', 'GPIO13', 'GND', 'VIN'];
export const ESP_RIGHT = ['GPIO23', 'GPIO22', 'GPIO1', 'GPIO3', 'GPIO21', 'GPIO19', 'GPIO18', 'GPIO5', 'GPIO17', 'GPIO16', 'GPIO4', 'GPIO2', 'GPIO15', 'GND', '3V3'];
// M8 · ESP32-S3 CAM board (the TinyML track): 2 × 22 pins, as on the common
// Freenove-style ESP32-S3 WROOM CAM boards, plus a 24-pin camera connector.
export const S3_LEFT = ['3V3', '3V3', 'RST', 'GPIO4', 'GPIO5', 'GPIO6', 'GPIO7', 'GPIO15', 'GPIO16', 'GPIO17', 'GPIO18', 'GPIO8', 'GPIO3', 'GPIO46', 'GPIO9', 'GPIO10', 'GPIO11', 'GPIO12', 'GPIO13', 'GPIO14', '5V', 'GND'];
export const S3_RIGHT = ['GND', 'GPIO43', 'GPIO44', 'GPIO1', 'GPIO2', 'GPIO42', 'GPIO41', 'GPIO40', 'GPIO39', 'GPIO38', 'GPIO37', 'GPIO36', 'GPIO35', 'GPIO0', 'GPIO45', 'GPIO48', 'GPIO47', 'GPIO21', 'GPIO20', 'GPIO19', 'GND', 'GND'];
export const ESP_FLAGS = {
  inputOnly: [34, 35, 36, 39],
  strapping: [0, 2, 5, 12, 15],
  flash: [6, 7, 8, 9, 10, 11],
  uart0: [1, 3],
  adc1: [32, 33, 34, 35, 36, 39],
};

// Every board pin, as the sandbox sees it: { name, kind: 'power'|'gnd'|'gpio'|'special', volts }.
export function boardPins(kind) {
  const out = [];
  const seen = new Set();
  const names = kind === 'pi5' ? PI_HEADER.slice(1).map((n, i) => ({ n, phys: i + 1 })) : (kind === 'esp32s3' ? [...S3_LEFT, ...S3_RIGHT] : [...ESP_LEFT, ...ESP_RIGHT]).map((n, i) => ({ n, phys: i + 1 }));
  for (const { n, phys } of names) {
    const id = n === 'GND' || n === '3V3' || n === '5V' ? `${n}@${phys}` : n;
    if (seen.has(id)) continue; seen.add(id);
    let k = 'gpio', volts = 3.3;
    if (n === 'GND') { k = 'gnd'; volts = 0; }
    else if (n === '3V3') { k = 'power'; volts = 3.3; }
    else if (n === '5V' || n === 'VIN') { k = 'power'; volts = 5; }
    else if (n === 'EN' || n === 'RST') { k = 'special'; }
    out.push({ id, name: n, phys, kind: k, volts });
  }
  if (kind === 'pi5') {
    out.push({ id: 'CAM0', name: 'CAM/DISP 0', kind: 'csi' }, { id: 'CAM1', name: 'CAM/DISP 1', kind: 'csi' },
      { id: 'PCIE', name: 'PCIe x1', kind: 'pcie' }, { id: 'FAN', name: 'Fan header', kind: 'fan' });
  }
  return out;
}

// ---------------------------------------------------------------------------

export function buildPi5() {
  const { group: g, parts, tips, tipsByPhys, actLed } = buildPi5Model(PI_HEADER);
  const top = PI.t, L = PI5_LAYOUT;
  // connection points for ribbon / fan cables
  const ports = {
    CAM0: new THREE.Vector3(L.cam0[0], top + 0.25, L.cam0[1]),
    CAM1: new THREE.Vector3(L.cam1[0], top + 0.25, L.cam1[1]),
    PCIE: new THREE.Vector3(L.pcie[0], top + 0.25, L.pcie[1]),
    FAN: new THREE.Vector3(L.fan[0], top + 0.3, L.fan[1]),
  };
  // pick a free header pin for a name like '5V' or 'GND' (round-robin)
  const used = {};
  function pinPoint(name) {
    if (ports[name]) return ports[name];
    const list = tips[name];
    if (!list) return null;
    used[name] = (used[name] ?? -1) + 1;
    return list[used[name] % list.length];
  }
  function physPoint(phys) { return tipsByPhys[phys]; }
  function resetPins() { for (const k of Object.keys(used)) delete used[k]; }

  return { group: g, parts, pinPoint, physPoint, resetPins, actLed, size: { w: PI.w, d: PI.d, h: 1.8 } };
}

// ---------------------------------------------------------------------------
// opts.s3: the ESP32-S3 CAM board of the TinyML track. The default (no opts)
// is the classic ESP32 DevKit the sandbox uses, unchanged.
export function buildEsp32(opts = {}) {
  const S3 = !!opts.s3;
  const g = new THREE.Group();
  g.name = S3 ? 'esp32s3' : 'esp32';
  const W = S3 ? 6.6 : 5.15, D = 2.8, T = 0.16;
  const parts = [];
  const add = (o, d) => { info(o, d); g.add(o); parts.push(o); return o; };
  const pcb = slab(W, D, T, mat(S3 ? 0x15325e : 0x1c1f24, { roughness: 0.7 }), 0.12);
  info(pcb, S3
    ? { title: 'ESP32-S3 CAM board', desc: 'An ESP32-S3 board with 8 MB PSRAM and a camera connector. The S3’s vector instructions speed up the int8 maths of small neural networks.', rows: [['Chip', 'ESP32-S3-WROOM-1 (N16R8)'], ['Logic', '3.3 V'], ['Power', '5 V over USB-C']] }
    : { title: 'ESP32 DevKit', desc: 'A dual-core 240 MHz microcontroller board with Wi-Fi and Bluetooth, 3.3 V logic.', rows: [['Chip', 'ESP32-WROOM-32'], ['Logic', '3.3 V'], ['Power', '5 V over USB or VIN']] });
  g.add(pcb); parts.push(pcb);
  const mod = new THREE.Group();
  mod.add(box(1.8, 0.1, 1.8, mat(0x1f4fa0), 0, 0, 0));
  mod.add(box(1.5, 0.22, 1.6, metal(0xc4c9cf), 0.12, 0.1, 0));
  const lab = silk(S3 ? ['ESP32-S3', 'WROOM-1'] : ['ESP32', 'WROOM-32'], 1.4, 0.8, { color: 'rgba(70,76,84,0.8)', size: 16 });
  const modDecal = decal(1.3, 0.75, lab, 0.325);
  modDecal.position.set(0.12, 0.325, 0);
  mod.add(modDecal);
  mod.position.set(S3 ? -2.15 : -1.55, T, 0);
  add(mod, S3
    ? { title: 'ESP32-S3-WROOM-1 module', desc: 'Two Xtensa LX7 cores at 240 MHz with vector (SIMD) instructions, 512 KB SRAM, 16 MB flash and 8 MB PSRAM, Wi-Fi and Bluetooth LE.', rows: [['CPU', '2 × 240 MHz LX7'], ['PSRAM', '8 MB'], ['Flash', '16 MB']] }
    : { title: 'ESP32-WROOM-32 module', desc: 'Two Xtensa LX6 cores at 240 MHz, 520 KB SRAM, 4 MB flash, Wi-Fi and Bluetooth, under the shield.', rows: [['CPU', '2 × 240 MHz'], ['Flash', '4 MB']] });
  const usb = box(0.75, 0.3, 0.6, metal(0xc4c9cf), W / 2 - 0.3, T, 0);
  add(usb, S3 ? { title: 'USB-C', desc: 'Power, programming and the serial monitor.', rows: [['Power', '5 V']] } : { title: 'Micro-USB', desc: 'Power and programming through the USB-to-serial chip.', rows: [['Power', '5 V']] });
  const btn = (x, z, t) => add(box(0.35, 0.18, 0.3, mat(0x2b2f36), x, T, z), { title: `${t} button`, desc: t === 'EN' || t === 'RST' ? 'Resets the chip.' : 'Hold while resetting to enter the bootloader (GPIO 0).', rows: [] });
  btn(S3 ? 2.3 : 1.4, -0.8, S3 ? 'RST' : 'EN'); btn(S3 ? 2.3 : 1.4, 0.8, 'BOOT');
  let cam = null;
  if (S3) {
    // 24-pin camera FPC connector between the module and the USB end
    const fpc = new THREE.Group();
    fpc.add(box(0.5, 0.22, 1.5, mat(0xf0ece2), 0, 0, 0));
    fpc.add(box(0.18, 0.06, 1.3, mat(0x2b2f36), -0.08, 0.22, 0));
    fpc.position.set(0.6, T, 0);
    add(fpc, { title: 'Camera connector (24-pin DVP)', desc: 'The OV2640 / OV5640 camera’s flat cable clips in here. The S3 reads frames into PSRAM.', rows: [['Interface', 'DVP, 8-bit parallel'], ['Cameras', 'OV2640, OV5640']] });
    cam = new THREE.Vector3(0.6, T + 0.3, 0);
  }
  const pitch = 0.254;
  const tips = {};
  const byPhys = [null];
  const rows = S3 ? [[S3_LEFT, D / 2 - 0.15], [S3_RIGHT, -D / 2 + 0.15]] : [[ESP_LEFT, D / 2 - 0.15], [ESP_RIGHT, -D / 2 + 0.15]];
  const pinMat = metal(COLORS.gold);
  for (const [names, z] of rows) {
    names.forEach((n, i) => {
      const x = -W / 2 + (S3 ? 0.35 : 0.55) + i * pitch * (S3 ? 1.1 : 1.2);
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.35, 10), pinMat);
      p.position.set(x, T + 0.17, z); g.add(p);
      const key = n;
      const v = new THREE.Vector3(x, T + 0.35, z);
      (tips[key] ||= []).push(v);
      byPhys.push(v);
    });
  }
  const used = {};
  return {
    group: g, parts,
    pinPoint(name) { if (name === 'CAM' && cam) return cam; const l = tips[name]; if (!l) return null; used[name] = (used[name] ?? -1) + 1; return l[used[name] % l.length]; },
    physPoint(phys) { return byPhys[phys] || null; },
    resetPins() { for (const k of Object.keys(used)) delete used[k]; },
    size: { w: W, d: D, h: 0.6 },
  };
}

// ---------------------------------------------------------------------------
export function buildBreadboard(w = 8.25, d = 5.5) {
  const g = new THREE.Group();
  const H = 0.85;
  const body = slab(w, d, H, mat(0xf5f1ea, { roughness: 0.85 }), 0.12);
  g.add(body);
  const tex = canvasTexture(660, 440, (ctx, cw, ch) => {
    ctx.fillStyle = '#f5f1ea'; ctx.fillRect(0, 0, cw, ch);
    const cols = 30, sx = cw / (cols + 3), hole = (x, y) => { ctx.fillStyle = '#4b4a46'; ctx.fillRect(x - 3, y - 3, 6, 6); };
    // rails
    for (const [y, color] of [[22, '#d94b3d'], [70, '#2f5fb8'], [ch - 70, '#d94b3d'], [ch - 22, '#2f5fb8']]) {
      ctx.strokeStyle = color; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(30, y); ctx.lineTo(cw - 30, y); ctx.stroke();
    }
    for (const yy of [34, 58, ch - 58, ch - 34]) for (let i = 0; i < cols; i++) if (i % 6 !== 5) hole(sx * (i + 2), yy);
    for (let r = 0; r < 5; r++) for (let i = 0; i < cols; i++) { hole(sx * (i + 2), 110 + r * 24); hole(sx * (i + 2), ch - 110 - r * 24); }
    ctx.fillStyle = '#e7e0d4'; ctx.fillRect(20, ch / 2 - 9, cw - 40, 18);
  });
  const top = decal(w - 0.1, d - 0.1, tex, H + 0.002, { transparent: false, roughness: 0.9 });
  g.add(top);
  info(body, { title: 'Breadboard', desc: 'Holes in each short row of five are joined underneath; each rail runs the whole length.', rows: [['Size', '400 tie points'], ['Rails', '+ and − on both sides']] });
  return { group: g, top: H, size: { w, d } };
}

export { glowSprite };
