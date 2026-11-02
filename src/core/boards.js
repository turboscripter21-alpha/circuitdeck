// Procedural models of the Raspberry Pi 5, an ESP32 DevKit and a breadboard,
// plus the pin facts the lessons and the sandbox's wiring checks rely on.
import * as THREE from 'three';
import { COLORS, mat, metal, box, cyl, slab, chip, decal, silk, canvasTexture, info, glowSprite } from './kit.js';

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
  const names = kind === 'pi5' ? PI_HEADER.slice(1).map((n, i) => ({ n, phys: i + 1 })) : [...ESP_LEFT, ...ESP_RIGHT].map((n, i) => ({ n, phys: i + 1 }));
  for (const { n, phys } of names) {
    const id = n === 'GND' || n === '3V3' || n === '5V' ? `${n}@${phys}` : n;
    if (seen.has(id)) continue; seen.add(id);
    let k = 'gpio', volts = 3.3;
    if (n === 'GND') { k = 'gnd'; volts = 0; }
    else if (n === '3V3') { k = 'power'; volts = 3.3; }
    else if (n === '5V' || n === 'VIN') { k = 'power'; volts = 5; }
    else if (n === 'EN') { k = 'special'; }
    out.push({ id, name: n, phys, kind: k, volts });
  }
  if (kind === 'pi5') {
    out.push({ id: 'CAM0', name: 'CAM/DISP 0', kind: 'csi' }, { id: 'CAM1', name: 'CAM/DISP 1', kind: 'csi' },
      { id: 'PCIE', name: 'PCIe x1', kind: 'pcie' }, { id: 'FAN', name: 'Fan header', kind: 'fan' });
  }
  return out;
}

// ---------------------------------------------------------------------------
const PI = { w: 8.5, d: 5.6, t: 0.16 };

export function buildPi5() {
  const g = new THREE.Group();
  g.name = 'pi5';
  const parts = [];
  const add = (obj, data) => { info(obj, data); g.add(obj); parts.push(obj); return obj; };

  const pcb = slab(PI.w, PI.d, PI.t, mat(COLORS.pcbPi, { roughness: 0.7 }), 0.3);
  info(pcb, { title: 'Raspberry Pi 5', desc: 'A credit-card computer: a 2.4 GHz quad-core Arm Cortex-A76 (BCM2712), with RP1 handling the I/O.', rows: [['Size', '85 × 56 mm'], ['Power', '5 V / 5 A, USB-C PD'], ['GPIO logic', '3.3 V (not 5 V tolerant)']] });
  g.add(pcb); parts.push(pcb);
  const top = PI.t;

  // silkscreen
  const silkTex = silk(['Raspberry Pi 5', '© Raspberry Pi Ltd'], 2.6, 0.8, { size: 17 });
  const silkDecal = decal(2.6, 0.8, silkTex, top + 0.002);
  silkDecal.position.set(-2.4, top + 0.002, 1.55);
  g.add(silkDecal);
  // mounting holes
  for (const [x, z] of [[-3.9, -2.45], [1.9, -2.45], [-3.9, 2.45], [1.9, 2.45]]) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.14, 0.3, 24), metal(COLORS.gold));
    ring.rotation.x = -Math.PI / 2; ring.position.set(x, top + 0.003, z); g.add(ring);
    const hole = new THREE.Mesh(new THREE.CircleGeometry(0.14, 20), mat(0x161a1f));
    hole.rotation.x = -Math.PI / 2; hole.position.set(x, top + 0.004, z); g.add(hole);
  }

  // SoC with its metal heat spreader
  const soc = new THREE.Group();
  soc.add(box(1.85, 0.12, 1.85, mat(0x2a6f40), 0, 0, 0));
  soc.add(box(1.6, 0.1, 1.6, metal(0xb9bfc6), 0, 0.12, 0));
  const socLabel = silk(['BCM2712'], 1.5, 0.5, { color: 'rgba(60,66,74,0.75)', size: 16 });
  soc.add(decal(1.4, 0.45, socLabel, 0.225));
  soc.position.set(-1.25, top, -0.35);
  add(soc, { title: 'BCM2712 SoC', desc: 'Broadcom BCM2712: four Arm Cortex-A76 cores at 2.4 GHz and a VideoCore VII GPU (OpenGL ES 3.1, Vulkan 1.2).', rows: [['CPU', '4 × Cortex-A76 @ 2.4 GHz'], ['GPU', 'VideoCore VII'], ['Video', 'Dual 4Kp60 HDMI, 4Kp60 HEVC decode']] });

  const ram = chip(1.3, 1.45, 0.12, ['LPDDR4X'], 0x1b1e22);
  ram.position.set(0.55, top, -0.35);
  add(ram, { title: 'LPDDR4X SDRAM', desc: 'The working memory, LPDDR4X-4267. Pi 5 comes in 1, 2, 4, 8 and 16 GB versions.', rows: [['Type', 'LPDDR4X-4267'], ['Sizes', '1 / 2 / 4 / 8 / 16 GB']] });

  const rp1 = chip(1.05, 1.05, 0.12, ['RP1'], 0x1b1e22);
  rp1.position.set(2.45, top, 0.75);
  add(rp1, { title: 'RP1 I/O controller', desc: 'Raspberry Pi’s own “southbridge”, linked to the SoC over PCIe 2.0 ×4. It runs the GPIO header, USB, Ethernet and the MIPI camera/display ports.', rows: [['Link', 'PCIe 2.0 ×4 to BCM2712'], ['Handles', 'GPIO · USB · Ethernet · MIPI'], ['GPIO library', 'gpiozero (lgpio)']] });

  const pmic = chip(0.6, 0.6, 0.08, null, 0x1b1e22);
  pmic.position.set(-3.0, top, 1.1);
  add(pmic, { title: 'Power management IC', desc: 'Renesas DA9091 PMIC: makes the core voltages from the 5 V input, and powers the real-time clock.', rows: [['Input', '5 V from USB-C']] });

  const wifi = new THREE.Group();
  wifi.add(box(1.25, 0.18, 1.05, metal(0xc9ced4)));
  wifi.position.set(-3.35, top, -0.8);
  add(wifi, { title: 'Wi-Fi + Bluetooth', desc: 'Dual-band 802.11ac Wi-Fi and Bluetooth 5.0 / BLE, under a metal shield; the antenna is a trace on the board.', rows: [['Wi-Fi', '802.11ac, 2.4 + 5 GHz'], ['Bluetooth', '5.0 / BLE']] });

  // Right edge: USB 2.0 pair, USB 3.0 pair, Ethernet
  const usb = (color, z, title, desc, rows) => {
    const u = new THREE.Group();
    u.add(box(1.75, 1.6, 1.32, metal(0xc4c9cf), 0, 0, 0));
    for (const y of [0.32, 1.02]) u.add(box(0.05, 0.22, 0.9, mat(color), 0.88, y, 0));
    u.position.set(PI.w / 2 - 0.68, top, z);
    return add(u, { title, desc, rows });
  };
  usb(0x23262b, -1.75, 'USB 2.0 ports', 'Two USB 2.0 ports (black) for keyboards, mice and other slow devices.', [['Ports', '2 × USB 2.0'], ['Total USB current', '1.6 A with a 5 A supply, 600 mA with 3 A']]);
  usb(COLORS.usbBlue, -0.15, 'USB 3.0 ports', 'Two USB 3.0 ports (blue), 5 Gbps each, and both can run at full speed at the same time.', [['Ports', '2 × USB 3.0'], ['Speed', '5 Gbps each, simultaneous']]);
  const eth = new THREE.Group();
  eth.add(box(2.1, 1.35, 1.6, metal(0xc4c9cf)));
  eth.add(box(0.05, 0.6, 1.0, mat(0x1d2025), 1.06, 0.25, 0));
  eth.position.set(PI.w / 2 - 0.85, top, 1.75);
  add(eth, { title: 'Gigabit Ethernet', desc: 'Wired networking at up to 1 Gbps, with PoE+ support through a separate PoE+ HAT.', rows: [['Speed', '1 Gbps'], ['PoE', 'PoE+ with a PoE+ HAT']] });

  // Bottom edge: USB-C power, 2 × micro HDMI, UART
  const usbc = box(0.9, 0.32, 0.75, metal(0xc4c9cf), -3.15, top, PI.d / 2 - 0.3);
  add(usbc, { title: 'USB-C power', desc: 'The power input: 5 V at up to 5 A with USB Power Delivery. The official 27 W supply lets USB ports supply 1.6 A in total.', rows: [['Input', '5 V DC, up to 5 A'], ['Recommended', 'Official 27 W USB-C PSU']] });
  for (const [x, n] of [[-1.7, 0], [-0.35, 1]]) {
    const h = box(0.75, 0.3, 0.75, metal(0xc4c9cf), x, top, PI.d / 2 - 0.3);
    add(h, { title: `Micro HDMI ${n}`, desc: 'Two micro HDMI outputs drive two 4K displays at 60 Hz at once.', rows: [['Output', '4Kp60 each, ×2'], ['Connector', 'Micro HDMI (Type D)']] });
  }
  const uart = box(0.4, 0.3, 0.3, mat(0xf2efe8), -1.02, top, 2.35);
  add(uart, { title: 'UART debug connector', desc: 'A 3-pin JST-SH connector for the Raspberry Pi Debug Probe: a serial console without using header pins.', rows: [['Connector', '3-pin JST-SH'], ['Level', '3.3 V']] });

  // Two 4-lane MIPI connectors (CAM/DISP 0 and 1)
  const mipi = [];
  for (const [x, n] of [[0.85, 0], [-3.55, 1]]) {
    const m = new THREE.Group();
    m.add(box(1.25, 0.28, 0.35, mat(0xf0ece2)));
    m.add(box(1.2, 0.08, 0.36, mat(0x2a2d33), 0, 0.28, 0));
    m.position.set(x, top, n === 0 ? 2.25 : -1.85);
    if (n === 1) m.rotation.y = Math.PI / 2;
    add(m, { title: `CAM/DISP ${n}`, desc: 'A 4-lane MIPI transceiver: plug in a camera or a DSI display. Pi 5 uses the smaller 22-pin 0.5 mm FPC connector, so standard camera cables need the 22-to-15-pin adapter cable.', rows: [['Lanes', '4-lane MIPI CSI-2 or DSI'], ['Connector', '22-pin, 0.5 mm pitch']] });
    mipi.push(m);
  }

  // PCIe FFC on the left edge
  const pcie = new THREE.Group();
  pcie.add(box(0.35, 0.28, 1.35, mat(0xf0ece2)));
  pcie.add(box(0.36, 0.08, 1.3, mat(0x2a2d33), 0, 0.28, 0));
  pcie.position.set(-PI.w / 2 + 0.3, top, 0.75);
  add(pcie, { title: 'PCIe 2.0 ×1', desc: 'A 16-pin FPC connector for fast add-ons such as NVMe SSDs and the AI Kit, through an M.2 HAT+.', rows: [['Interface', 'PCIe 2.0 ×1 (Gen 3 can be enabled)'], ['Use', 'M.2 HAT+, AI Kit, NVMe']] });

  // Fan header, RTC battery, power button, LEDs
  const fan = box(0.45, 0.32, 0.3, mat(0xf2efe8), 2.75, top, -1.95);
  add(fan, { title: 'Fan header', desc: 'A 4-pin JST connector for the official Active Cooler: the firmware sets the fan speed from the CPU temperature.', rows: [['Pins', '5 V · GND · PWM · tach'], ['Control', 'Automatic, firmware']] });
  const bat = box(0.35, 0.3, 0.3, mat(0xf2efe8), -2.6, top, 2.35);
  add(bat, { title: 'RTC battery connector', desc: 'Connect a rechargeable lithium-manganese cell so the real-time clock keeps time while the power is off.', rows: [['Clock', 'Built-in RTC']] });
  const btn = new THREE.Group();
  btn.add(box(0.3, 0.3, 0.45, mat(0x2a2d33)));
  btn.add(cyl(0.09, 0.09, 0.1, mat(0xe9e5dc), -0.18, 0.1, 0).rotateZ(Math.PI / 2));
  btn.position.set(-PI.w / 2 + 0.2, top, 1.95);
  add(btn, { title: 'Power button', desc: 'Press to start, press to request a clean shutdown, hold to force power off.', rows: [['Behaviour', 'Start · shutdown · force off']] });
  const pwrLed = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.06, 0.1), mat(0xff3b30, { emissive: 0xff3b30, unique: true }));
  pwrLed.material.emissiveIntensity = 0.9;
  pwrLed.position.set(-PI.w / 2 + 0.25, top + 0.03, 1.45);
  g.add(pwrLed);
  const actLed = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.06, 0.1), mat(0x34c759, { emissive: 0x34c759, unique: true }));
  actLed.material.emissiveIntensity = 0.2;
  actLed.position.set(-PI.w / 2 + 0.25, top + 0.03, 1.2);
  g.add(actLed);

  // microSD (underside, peeking out of the left edge)
  const sd = box(0.5, 0.1, 1.1, mat(0x2a2d33), -PI.w / 2 - 0.05, -0.1, 0.0);
  add(sd, { title: 'microSD slot', desc: 'The usual boot drive: Raspberry Pi OS on a microSD card (high-speed SDR104 mode). Pi 5 can also boot from USB or NVMe.', rows: [['Mode', 'SDR104'], ['Other boot', 'USB · NVMe (PCIe)']] });

  // 40-pin header
  const header = new THREE.Group();
  const pitch = 0.254, hx0 = -3.54, rowOdd = -2.32, rowEven = -2.574, pinH = 0.85;
  header.add(box(20 * pitch, 0.25, 2 * pitch, mat(0x1b1d21), hx0 + 9.5 * pitch, 0, (rowOdd + rowEven) / 2));
  const pinGeo = new THREE.BoxGeometry(0.064, pinH, 0.064);
  const pinMat = mat(COLORS.gold, { roughness: 0.3, metalness: 0.8 });
  const tips = {};
  const tipsByPhys = [];
  for (let phys = 1; phys <= 40; phys++) {
    const col = Math.floor((phys - 1) / 2);
    const x = hx0 + col * pitch, z = phys % 2 ? rowOdd : rowEven;
    const p = new THREE.Mesh(pinGeo, pinMat);
    p.position.set(x, pinH / 2, z);
    header.add(p);
    const tip = new THREE.Vector3(x, top + pinH, z);
    tipsByPhys[phys] = tip;
    const name = PI_HEADER[phys];
    if (!tips[name]) tips[name] = [];
    tips[name].push(tip);
  }
  // a square pad marks pin 1
  const pad = box(0.2, 0.01, 0.2, metal(COLORS.gold), hx0, -0.01, rowOdd);
  header.add(pad);
  header.position.y = top;
  add(header, { title: '40-pin GPIO header', desc: 'The Pi’s connection to the outside world: 28 GPIO pins plus 3.3 V, 5 V and ground. GPIO is 3.3 V logic — never feed it 5 V.', rows: [['GPIO', '28 pins, 3.3 V logic'], ['Power pins', '3.3 V × 2 · 5 V × 2 · GND × 8'], ['Buses', 'I2C · SPI · UART · PWM · PCM']] });

  // connection points
  const ports = {
    CAM0: new THREE.Vector3(0.85, top + 0.3, 2.25),
    CAM1: new THREE.Vector3(-3.55, top + 0.3, -1.85),
    PCIE: new THREE.Vector3(-PI.w / 2 + 0.3, top + 0.3, 0.75),
    FAN: new THREE.Vector3(2.75, top + 0.3, -1.95),
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
export function buildEsp32() {
  const g = new THREE.Group();
  g.name = 'esp32';
  const W = 5.15, D = 2.8, T = 0.16;
  const parts = [];
  const add = (o, d) => { info(o, d); g.add(o); parts.push(o); return o; };
  const pcb = slab(W, D, T, mat(0x1c1f24, { roughness: 0.7 }), 0.12);
  info(pcb, { title: 'ESP32 DevKit', desc: 'A dual-core 240 MHz microcontroller board with Wi-Fi and Bluetooth, 3.3 V logic.', rows: [['Chip', 'ESP32-WROOM-32'], ['Logic', '3.3 V'], ['Power', '5 V over USB or VIN']] });
  g.add(pcb); parts.push(pcb);
  const mod = new THREE.Group();
  mod.add(box(1.8, 0.1, 1.8, mat(0x1f4fa0), 0, 0, 0));
  mod.add(box(1.5, 0.22, 1.6, metal(0xc4c9cf), 0.12, 0.1, 0));
  const lab = silk(['ESP32', 'WROOM-32'], 1.4, 0.8, { color: 'rgba(70,76,84,0.8)', size: 16 });
  const modDecal = decal(1.3, 0.75, lab, 0.325);
  modDecal.position.set(0.12, 0.325, 0);
  mod.add(modDecal);
  mod.position.set(-1.55, T, 0);
  add(mod, { title: 'ESP32-WROOM-32 module', desc: 'Two Xtensa LX6 cores at 240 MHz, 520 KB SRAM, 4 MB flash, Wi-Fi and Bluetooth, under the shield.', rows: [['CPU', '2 × 240 MHz'], ['Flash', '4 MB']] });
  const usb = box(0.75, 0.3, 0.6, metal(0xc4c9cf), W / 2 - 0.3, T, 0);
  add(usb, { title: 'Micro-USB', desc: 'Power and programming through the USB-to-serial chip.', rows: [['Power', '5 V']] });
  const btn = (x, z, t) => add(box(0.35, 0.18, 0.3, mat(0x2b2f36), x, T, z), { title: `${t} button`, desc: t === 'EN' ? 'Resets the chip.' : 'Hold while resetting to enter the bootloader (GPIO 0).', rows: [] });
  btn(1.4, -0.8, 'EN'); btn(1.4, 0.8, 'BOOT');
  const pitch = 0.254;
  const tips = {};
  const rows = [[ESP_LEFT, D / 2 - 0.15], [ESP_RIGHT, -D / 2 + 0.15]];
  const pinMat = metal(COLORS.gold);
  for (const [names, z] of rows) {
    names.forEach((n, i) => {
      const x = -W / 2 + 0.55 + i * pitch * 1.2;
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.35, 10), pinMat);
      p.position.set(x, T + 0.17, z); g.add(p);
      const key = n;
      (tips[key] ||= []).push(new THREE.Vector3(x, T + 0.35, z));
    });
  }
  const used = {};
  return {
    group: g, parts,
    pinPoint(name) { const l = tips[name]; if (!l) return null; used[name] = (used[name] ?? -1) + 1; return l[used[name] % l.length]; },
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
