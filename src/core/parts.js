// The component library: every part a Pi 5 project or the sandbox can use.
// Each entry has the facts the wiring checks need (pins, roles, voltages),
// a generic "what to buy" spec, and a procedural three.js builder.
//
// Pin roles:
//   vcc  – supply input (range [min, max] volts)      gnd  – ground
//   in   – logic input to the part (max volts)        out  – logic output (level: 'vcc' or volts)
//   pwm  – servo/PWM signal input                      aout – analog voltage output (0..vcc)
//   ain  – analog input (ADC channel)                  sda/scl – I2C (pulled up to the part's vcc)
//   mosi/miso/sck/cs – SPI                             load – motor/lamp terminal (needs a driver)
//   drv  – driver output terminal                      csi/pcie/fan – Pi 5 connectors
import * as THREE from 'three';
import { COLORS, mat, metal, box, cyl, slab, chip, decal, silk, canvasTexture, glowSprite } from './kit.js';

const P = (n, role, extra = {}) => ({ n, role, ...extra });

// A module board: PCB + a pin row along the front edge, labels on the silkscreen.
function moduleBoard({ w, d, color = COLORS.pcbBlue, pins, label, pinEdge = 'front', t = 0.16 }) {
  const g = new THREE.Group();
  g.add(slab(w, d, t, mat(color, { roughness: 0.7 }), 0.1));
  const pitch = 0.254, n = pins.length;
  const z = pinEdge === 'front' ? d / 2 - 0.2 : -d / 2 + 0.2;
  g.add(box(n * pitch, 0.22, pitch, mat(0x1b1d21), 0, t, z));
  const local = {};
  const pinGeo = new THREE.BoxGeometry(0.064, 0.62, 0.064);
  pins.forEach((p, i) => {
    const x = (i - (n - 1) / 2) * pitch;
    const m = new THREE.Mesh(pinGeo, mat(COLORS.gold, { roughness: 0.3, metalness: 0.8 }));
    m.position.set(x, t + 0.31, z); g.add(m);
    local[p] = new THREE.Vector3(x, t + 0.62, z);
  });
  const tex = silk(pins, Math.max(n * pitch, 0.6), 0.32, { size: 9 });
  // vertical pin names would be tiny; one row of abbreviations
  const labels = canvasTexture(Math.max(32, n * 26), 40, (ctx, cw, ch) => {
    ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.font = '700 11px "Barlow Semi Condensed", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    pins.forEach((p, i) => ctx.fillText(p.length > 4 ? p.slice(0, 4) : p, (i + 0.5) * cw / n, ch / 2));
  });
  tex.dispose();
  const lab = decal(n * pitch, 0.22, labels, t + 0.003);
  lab.position.z = z - (pinEdge === 'front' ? 0.3 : -0.3);
  g.add(lab);
  if (label) {
    const lt = silk([label], w * 0.8, 0.4, { size: 14 });
    const ld = decal(w * 0.8, 0.4, lt, t + 0.003);
    ld.position.z = pinEdge === 'front' ? -d / 2 + 0.3 : d / 2 - 0.3;
    g.add(ld);
  }
  return { group: g, pins: local, top: t };
}

// Two legs going down into the breadboard, returns tip points.
function legs(points, len = 0.5, color = COLORS.silver) {
  const g = new THREE.Group();
  const out = [];
  for (const [x, z, l = len] of points) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, l, 6), metal(color));
    m.position.set(x, l / 2, z); g.add(m);
    out.push(new THREE.Vector3(x, 0.02, z));
  }
  return { group: g, tips: out };
}

const LED_COLORS = { red: 0xff3b30, green: 0x30d158, yellow: 0xffcc00, blue: 0x2f7cf6, white: 0xfff6e0, orange: 0xff8a1f };

// ---------------------------------------------------------------------------
export const PARTS = {
  led: {
    name: 'LED', cat: 'Output', icon: 'led',
    desc: 'A light-emitting diode. Current flows from the long leg (anode, +) to the short leg (cathode, −); always add a resistor.',
    pins: [P('A', 'in', { label: 'Anode (+)', max: 3.3, current: true }), P('K', 'gnd', { label: 'Cathode (−)' })],
    buy: '5 mm LED (red/green/yellow/blue), ~2 V forward voltage, 20 mA max',
    needsResistor: true,
    props: { color: ['red', 'green', 'yellow', 'blue', 'white', 'orange'] },
    build(o = {}) {
      const c = LED_COLORS[o.color || 'red'];
      const g = new THREE.Group();
      const lg = legs([[-0.127, 0, 0.6], [0.127, 0, 0.5]]); lg.group.position.y = 0; g.add(lg.group);
      const lens = mat(c, { unique: true, transparent: true, opacity: 0.88, roughness: 0.25, emissive: c });
      lens.emissiveIntensity = 0.05;
      const body = cyl(0.25, 0.25, 0.42, lens, 0, 0.5); g.add(body);
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.25, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), lens);
      dome.position.y = 0.92; g.add(dome);
      g.add(cyl(0.29, 0.29, 0.06, lens, 0, 0.5));
      const glow = glowSprite(c, 1.6); glow.position.y = 0.85; g.add(glow);
      return {
        group: g, pins: { A: lg.tips[0], K: lg.tips[1] }, anchor: new THREE.Vector3(0, 1.2, 0),
        apply(s) { const b = s.on === true ? 1 : (typeof s.on === 'number' ? s.on : 0); lens.emissiveIntensity = 0.05 + b * 1.6; glow.material.opacity = b * 0.9; },
      };
    },
  },
  resistor: {
    name: 'Resistor', cat: 'Passive', icon: 'resistor',
    desc: 'Limits current. 330 Ω suits an LED on 3.3 V; 10 kΩ is a common pull-up or pull-down.',
    pins: [P('1', 'pass'), P('2', 'pass')],
    buy: '¼ W carbon-film resistor kit (220 Ω, 330 Ω, 1 kΩ, 2 kΩ, 10 kΩ)',
    props: { ohms: ['220', '330', '1k', '2k', '10k'] },
    build() {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.5, 6, 12), mat(0xe8d3a8));
      body.rotation.z = Math.PI / 2; body.position.y = 0.32; g.add(body);
      [[-0.18, 0x8b5a2b], [-0.06, 0x111111], [0.06, 0x8b5a2b], [0.2, 0xd4af37]].forEach(([x, c]) => {
        const band = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.105, 0.05, 14), mat(c)); band.rotation.z = Math.PI / 2; band.position.set(x, 0.32, 0); g.add(band);
      });
      const lg = legs([[-0.5, 0, 0.32], [0.5, 0, 0.32]]); g.add(lg.group);
      for (const x of [-0.42, 0.42]) { const h = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.18, 6), metal()); h.rotation.z = Math.PI / 2; h.position.set(x, 0.32, 0); g.add(h); }
      return { group: g, pins: { 1: lg.tips[0], 2: lg.tips[1] }, anchor: new THREE.Vector3(0, 0.55, 0), apply() {} };
    },
  },
  button: {
    name: 'Push button', cat: 'Input', icon: 'button',
    desc: 'A momentary tactile switch: it connects its two sides while held. With gpiozero, wire it between a GPIO and GND — the internal pull-up does the rest.',
    pins: [P('1', 'switch'), P('2', 'switch')],
    buy: '6 × 6 mm tactile push button, 4-pin',
    input: 'press',
    build() {
      const g = new THREE.Group();
      g.add(box(0.62, 0.32, 0.62, mat(0x2b2f36)));
      g.add(box(0.5, 0.04, 0.5, metal(0xb9bfc6), 0, 0.32, 0));
      const cap = cyl(0.17, 0.17, 0.22, mat(0x1d2025), 0, 0.33); g.add(cap);
      const lg = legs([[-0.31, -0.2, 0.2], [0.31, 0.2, 0.2]]); g.add(lg.group);
      return { group: g, pins: { 1: lg.tips[0], 2: lg.tips[1] }, anchor: new THREE.Vector3(0, 0.75, 0), pressable: true,
        apply(s) { cap.position.y = s.pressed ? 0.25 : 0.33; } };
    },
  },
  buzzer: {
    name: 'Active buzzer', cat: 'Output', icon: 'buzzer',
    desc: 'Beeps by itself when powered — just switch it on and off. (A passive buzzer needs a tone signal instead.)',
    pins: [P('+', 'in', { max: 5.5, label: 'Positive' }), P('-', 'gnd')],
    buy: 'Active buzzer, 3.3–5 V, 12 mm',
    build() {
      const g = new THREE.Group();
      const body = cyl(0.6, 0.6, 0.85, mat(0x1d2025), 0, 0.1); g.add(body);
      const top = new THREE.Mesh(new THREE.CircleGeometry(0.12, 16), mat(0x0f1012)); top.rotation.x = -Math.PI / 2; top.position.y = 0.96; g.add(top);
      const ringMat = new THREE.MeshBasicMaterial({ color: 0xf86b1d, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false });
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.7, 0.78, 32), ringMat); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.97; g.add(ring);
      const lg = legs([[-0.38, 0, 0.12], [0.38, 0, 0.12]]); g.add(lg.group);
      let on = false;
      return { group: g, pins: { '+': lg.tips[0], '-': lg.tips[1] }, anchor: new THREE.Vector3(0, 1.2, 0),
        apply(s) { on = !!s.on; },
        tick(t) { const k = on ? (t * 2.2) % 1 : 0; ring.scale.setScalar(1 + k * 1.2); ringMat.opacity = on ? 0.8 * (1 - k) : 0; body.position.x = on ? Math.sin(t * 90) * 0.01 : 0; } };
    },
  },
  rgbled: {
    name: 'RGB LED (common cathode)', cat: 'Output', icon: 'rgb',
    desc: 'Red, green and blue LEDs in one diffused bulb sharing a cathode. Mix them with PWM for any colour; each colour needs its own resistor.',
    pins: [P('R', 'in', { max: 3.3, current: true }), P('GND', 'gnd'), P('G', 'in', { max: 3.3, current: true }), P('B', 'in', { max: 3.3, current: true })],
    buy: '5 mm RGB LED, common cathode, diffused', needsResistor: true,
    build() {
      const g = new THREE.Group();
      const lg = legs([[-0.19, 0, 0.5], [-0.063, 0, 0.6], [0.063, 0, 0.5], [0.19, 0, 0.5]]); g.add(lg.group);
      const lens = mat(0xffffff, { unique: true, transparent: true, opacity: 0.92, roughness: 0.5, emissive: 0x000000 });
      g.add(cyl(0.27, 0.27, 0.42, lens, 0, 0.5));
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.27, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), lens); dome.position.y = 0.92; g.add(dome);
      const glow = glowSprite(0xffffff, 1.7); glow.position.y = 0.85; g.add(glow);
      return { group: g, pins: { R: lg.tips[0], GND: lg.tips[1], G: lg.tips[2], B: lg.tips[3] }, anchor: new THREE.Vector3(0, 1.2, 0),
        apply(s) { const r = s.r ?? 0, gg = s.g ?? 0, b = s.b ?? 0; const c = new THREE.Color(r, gg, b); lens.emissive.copy(c); lens.emissiveIntensity = 1.4; glow.material.color.copy(c); glow.material.opacity = Math.max(r, gg, b) * 0.9; } };
    },
  },
  pot: {
    name: 'Potentiometer (10 kΩ)', cat: 'Input', icon: 'pot',
    desc: 'A knob that divides a voltage: the wiper (middle pin) moves from one end to the other. The Pi has no analog input, so read it through an ADC such as the MCP3008.',
    pins: [P('1', 'gnd'), P('W', 'aout'), P('3', 'vcc', { range: [0, 5.5] })],
    buy: '10 kΩ rotary potentiometer, linear, breadboard pins', input: 'value',
    build() {
      const g = new THREE.Group();
      g.add(box(1.0, 0.45, 1.0, mat(0x2a5ea8)));
      g.add(cyl(0.38, 0.38, 0.1, metal(0xb9bfc6), 0, 0.45));
      const knob = new THREE.Group();
      knob.add(cyl(0.3, 0.32, 0.55, mat(0x2b2f36), 0, 0));
      knob.add(box(0.07, 0.05, 0.28, mat(0xf3f1ec), 0, 0.55, -0.12));
      knob.position.y = 0.55; g.add(knob);
      const lg = legs([[-0.254, 0.45, 0.2], [0, 0.45, 0.2], [0.254, 0.45, 0.2]]); g.add(lg.group);
      return { group: g, pins: { 1: lg.tips[0], W: lg.tips[1], 3: lg.tips[2] }, anchor: new THREE.Vector3(0, 1.3, 0),
        apply(s) { knob.rotation.y = -((s.value ?? 0.5) - 0.5) * 1.5 * Math.PI; } };
    },
  },
  ldr: {
    name: 'Photoresistor (LDR)', cat: 'Input', icon: 'ldr',
    desc: 'Its resistance falls as light rises. In a divider with a 10 kΩ resistor it gives a voltage an ADC can read.',
    pins: [P('1', 'pass'), P('2', 'pass')],
    buy: 'GL5528 photoresistor (LDR), 5 mm', input: 'value',
    build() {
      const g = new THREE.Group();
      const face = canvasTexture(64, 64, (ctx) => { ctx.fillStyle = '#e7d7b0'; ctx.beginPath(); ctx.arc(32, 32, 31, 0, 7); ctx.fill(); ctx.strokeStyle = '#b5452c'; ctx.lineWidth = 4; ctx.beginPath(); for (let i = 0; i < 6; i++) { const y = 12 + i * 8; ctx.moveTo(i % 2 ? 50 : 14, y); ctx.lineTo(i % 2 ? 14 : 50, y + 8); } ctx.stroke(); });
      g.add(cyl(0.26, 0.26, 0.15, mat(0xe7d7b0), 0, 0.45));
      const d = decal(0.5, 0.5, face, 0.601); g.add(d);
      const lg = legs([[-0.1, 0, 0.45], [0.1, 0, 0.45]]); g.add(lg.group);
      return { group: g, pins: { 1: lg.tips[0], 2: lg.tips[1] }, anchor: new THREE.Vector3(0, 0.9, 0), apply() {} };
    },
  },
  mcp3008: {
    name: 'MCP3008 ADC', cat: 'Interface', icon: 'chip',
    desc: 'An 8-channel, 10-bit analog-to-digital converter on SPI. It gives the Pi the analog inputs it does not have.',
    pins: [P('CH0', 'ain'), P('CH1', 'ain'), P('CH2', 'ain'), P('VDD', 'vcc', { range: [2.7, 5.5] }), P('VREF', 'vcc', { range: [0, 5.5], ref: true }), P('AGND', 'gnd'), P('CLK', 'sck'), P('DOUT', 'miso', { level: 'vcc' }), P('DIN', 'mosi'), P('CS', 'cs'), P('DGND', 'gnd')],
    buy: 'MCP3008-I/P, 8-channel 10-bit ADC, DIP-16',
    build() {
      const g = new THREE.Group();
      const c = chip(2.03, 0.65, 0.35, ['MCP3008'], 0x1d2025); c.position.y = 0.12; g.add(c);
      const local = {};
      const names = ['CH0', 'CH1', 'CH2', 'VDD', 'VREF', 'AGND', 'CLK', 'DOUT', 'DIN', 'CS', 'DGND'];
      // CH0..CH7 on pins 1-8 (front); VDD, VREF, AGND, CLK, DOUT, DIN, CS, DGND on pins 16..9 (back)
      for (let i = 0; i < 8; i++) {
        for (const z of [0.38, -0.38]) {
          const m = box(0.06, 0.25, 0.12, metal(), -0.889 + i * 0.254, 0, z); g.add(m);
        }
      }
      ['CH0', 'CH1', 'CH2'].forEach((n, i) => { local[n] = new THREE.Vector3(-0.889 + i * 0.254, 0.02, 0.45); });
      ['VDD', 'VREF', 'AGND', 'CLK', 'DOUT', 'DIN', 'CS', 'DGND'].forEach((n, i) => { local[n] = new THREE.Vector3(-0.889 + i * 0.254, 0.02, -0.45); });
      void names;
      return { group: g, pins: local, anchor: new THREE.Vector3(0, 0.8, 0), apply() {} };
    },
  },
  pir: {
    name: 'PIR motion sensor (HC-SR501)', cat: 'Sensor', icon: 'pir',
    desc: 'Senses the infrared of a moving warm body through its white Fresnel lens. Powered from 5 V, its OUT pin still swings only to 3.3 V — safe for the Pi.',
    pins: [P('VCC', 'vcc', { range: [4.5, 20] }), P('OUT', 'out', { level: 3.3 }), P('GND', 'gnd')],
    buy: 'HC-SR501 PIR motion sensor module (5–20 V supply, 3.3 V output)', input: 'trigger',
    build() {
      const m = moduleBoard({ w: 3.2, d: 2.4, color: COLORS.pcbGreen, pins: ['VCC', 'OUT', 'GND'], pinEdge: 'front' });
      const domeMat = mat(0xf7f5ef, { unique: true, roughness: 0.4, emissive: 0xffa040 }); domeMat.emissiveIntensity = 0;
      const dome = new THREE.Mesh(new THREE.SphereGeometry(1.1, 28, 16, 0, Math.PI * 2, 0, Math.PI / 2), domeMat);
      dome.position.set(0, 0.18, -0.15); m.group.add(dome);
      m.group.add(box(2.3, 0.08, 2.3, mat(0xf7f5ef), 0, 0.16, -0.15));
      return { group: m.group, pins: m.pins, anchor: new THREE.Vector3(0, 1.6, 0), apply(s) { domeMat.emissiveIntensity = s.motion ? 0.55 : 0; } };
    },
  },
  hcsr04: {
    name: 'Ultrasonic sensor (HC-SR04)', cat: 'Sensor', icon: 'sonar',
    desc: 'Times an ultrasonic echo to measure distance (2 cm – 4 m). The classic HC-SR04 runs on 5 V and its ECHO is 5 V, so it needs a 1 kΩ / 2 kΩ divider before a Pi pin.',
    pins: [P('VCC', 'vcc', { range: [4.5, 5.5] }), P('TRIG', 'in', { max: 5.5 }), P('ECHO', 'out', { level: 'vcc' }), P('GND', 'gnd')],
    buy: 'HC-SR04 ultrasonic module (5 V) + 1 kΩ and 2 kΩ resistors for the echo divider', input: 'value',
    build() {
      const m = moduleBoard({ w: 4.5, d: 2.0, color: COLORS.pcbBlue, pins: ['VCC', 'TRIG', 'ECHO', 'GND'], pinEdge: 'front' });
      for (const x of [-1.3, 1.3]) {
        m.group.add(cyl(0.8, 0.8, 1.2, metal(0xc4c9cf), x, 0.16, -0.15));
        const mesh = new THREE.Mesh(new THREE.CircleGeometry(0.66, 24), mat(0x30343b, { roughness: 0.95 })); mesh.rotation.x = -Math.PI / 2; mesh.position.set(x, 1.365, -0.15); m.group.add(mesh);
      }
      const ringMat = new THREE.MeshBasicMaterial({ color: 0x2f9bb5, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false });
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.03, 6, 40, Math.PI), ringMat); ring.rotation.x = -Math.PI / 2; ring.rotation.z = Math.PI; ring.position.set(0, 0.8, -1.2); m.group.add(ring);
      let ping = 0;
      return { group: m.group, pins: m.pins, anchor: new THREE.Vector3(0, 1.8, 0),
        apply(s) { if (s.ping) ping = 1; },
        tick(t, dt) { if (ping > 0) { ping -= dt * 1.6; const k = 1 - Math.max(ping, 0); ring.scale.set(0.6 + k * 3, 0.6 + k * 3, 1); ringMat.opacity = Math.max(ping, 0) * 0.8; } } };
    },
  },
  dht22: {
    name: 'DHT22 temperature & humidity', cat: 'Sensor', icon: 'thermo',
    desc: 'Measures temperature (−40…80 °C, ±0.5 °C) and humidity (±2 % RH) and sends them over one data wire. Read at most once every 2 seconds.',
    pins: [P('VCC', 'vcc', { range: [3.3, 6] }), P('DATA', 'io', { level: 'vcc' }), P('GND', 'gnd')],
    buy: 'DHT22 / AM2302 module with pull-up resistor (3.3–6 V)', input: 'value',
    build() {
      const m = moduleBoard({ w: 1.6, d: 3.2, color: COLORS.pcbBlue, pins: ['VCC', 'DATA', 'GND'], pinEdge: 'front' });
      const body = box(1.5, 0.75, 2.4, mat(0xf3f1ec), 0, 0.16, -0.25); m.group.add(body);
      const grid = canvasTexture(96, 150, (ctx, w, h) => { ctx.fillStyle = '#f3f1ec'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#c9c4ba'; for (let y = 0; y < 6; y++) for (let x = 0; x < 4; x++) ctx.fillRect(10 + x * 21, 10 + y * 22, 14, 14); });
      const d = decal(1.45, 2.3, grid, 0.913); d.position.z = -0.25; m.group.add(d);
      return { group: m.group, pins: m.pins, anchor: new THREE.Vector3(0, 1.3, 0), apply() {} };
    },
  },
  bme280: {
    name: 'BME280 environment sensor', cat: 'Sensor', icon: 'gauge',
    desc: 'Temperature, humidity and air pressure on I2C (address 0x76 or 0x77). Use a 3.3 V breakout when wiring straight to the Pi.',
    pins: [P('VIN', 'vcc', { range: [1.8, 5.5] }), P('GND', 'gnd'), P('SCL', 'scl', { level: 'vcc' }), P('SDA', 'sda', { level: 'vcc' })],
    buy: 'BME280 I2C breakout (3.3 V), 4-pin', input: 'value',
    build() {
      const m = moduleBoard({ w: 1.5, d: 1.3, color: COLORS.pcbPurple, pins: ['VIN', 'GND', 'SCL', 'SDA'], pinEdge: 'front' });
      m.group.add(box(0.25, 0.1, 0.25, metal(0xc4c9cf), 0, 0.16, -0.2));
      return { group: m.group, pins: m.pins, anchor: new THREE.Vector3(0, 1.0, 0), apply() {} };
    },
  },
  soil: {
    name: 'Capacitive soil moisture sensor', cat: 'Sensor', icon: 'drop',
    desc: 'Senses water by capacitance (no exposed metal to corrode). Its AOUT voltage drops as the soil gets wetter; read it through an ADC.',
    pins: [P('VCC', 'vcc', { range: [3.3, 5.5] }), P('GND', 'gnd'), P('AOUT', 'aout')],
    buy: 'Capacitive soil moisture sensor v1.2 (3.3–5.5 V, analog out)', input: 'value',
    build() {
      const g = new THREE.Group();
      const probe = new THREE.Shape();
      probe.moveTo(-1.15, 0); probe.lineTo(1.15, 0); probe.lineTo(1.15, 6.6); probe.lineTo(0, 7.6); probe.lineTo(-1.15, 6.6); probe.lineTo(-1.15, 0);
      const geo = new THREE.ExtrudeGeometry(probe, { depth: 0.16, bevelEnabled: false }); geo.rotateX(-Math.PI / 2);
      const pm = new THREE.Mesh(geo, mat(0x1d2025)); pm.castShadow = true; g.add(pm);
      g.add(chip(0.6, 0.6, 0.1, null, 0x0e0f11).translateZ(-0.8).translateY(0.16));
      const lab = silk(['Capacitive', 'Soil Moisture'], 2, 0.8, { size: 14 }); const ld = decal(2, 0.8, lab, 0.163); ld.position.z = -2.2; g.add(ld);
      const line = box(2.2, 0.01, 0.06, mat(0xffffff), 0, 0.16, -3.6); g.add(line);
      g.add(box(0.8, 0.5, 0.6, mat(0xf3f1ec), 0, 0.16, 0.1));
      const local = { VCC: new THREE.Vector3(-0.25, 0.66, 0.2), GND: new THREE.Vector3(0, 0.66, 0.2), AOUT: new THREE.Vector3(0.25, 0.66, 0.2) };
      g.rotation.y = Math.PI;
      return { group: g, pins: local, anchor: new THREE.Vector3(0, 0.8, 0), apply() {} };
    },
  },
  mq2: {
    name: 'MQ-2 gas sensor module', cat: 'Sensor', icon: 'gas',
    desc: 'A heated tin-oxide sensor for smoke, LPG and other flammable gases. It needs 5 V and a warm-up; AO is up to 5 V, so read it through an ADC with a divider.',
    pins: [P('VCC', 'vcc', { range: [4.8, 5.2] }), P('GND', 'gnd'), P('DO', 'out', { level: 'vcc' }), P('AO', 'aout')],
    buy: 'MQ-2 gas sensor module (5 V, analog + digital out)', input: 'value',
    build() {
      const m = moduleBoard({ w: 3.2, d: 2.2, color: COLORS.pcbBlue, pins: ['VCC', 'GND', 'DO', 'AO'], pinEdge: 'front' });
      m.group.add(cyl(0.95, 0.95, 0.4, mat(0x2b2f36), -0.4, 0.16, -0.2));
      const meshMat = mat(0xb9bfc6, { roughness: 0.5, metalness: 0.6, unique: true, emissive: 0xff5a1f }); meshMat.emissiveIntensity = 0;
      m.group.add(cyl(0.9, 0.9, 1.1, meshMat, -0.4, 0.56, -0.2));
      m.group.add(box(0.5, 0.45, 0.5, mat(0x2a5ea8), 1.0, 0.16, -0.3));
      return { group: m.group, pins: m.pins, anchor: new THREE.Vector3(-0.4, 2.0, 0), apply(s) { meshMat.emissiveIntensity = s.gas ? 0.25 * s.gas : 0.04; } };
    },
  },
  oled: {
    name: 'OLED 0.96" (SSD1306, I2C)', cat: 'Display', icon: 'screen',
    desc: 'A 128 × 64 monochrome OLED on I2C (address 0x3C). Sharp, bright and only four wires.',
    pins: [P('GND', 'gnd'), P('VCC', 'vcc', { range: [3.3, 5] }), P('SCL', 'scl', { level: 3.3 }), P('SDA', 'sda', { level: 3.3 })],
    buy: '0.96" SSD1306 OLED, 128 × 64, I2C, 4-pin',
    build() {
      const m = moduleBoard({ w: 2.7, d: 2.8, color: COLORS.pcbBlue, pins: ['GND', 'VCC', 'SCL', 'SDA'], pinEdge: 'back' });
      m.group.add(box(2.6, 0.12, 1.75, mat(0x0b0c0e), 0, 0.16, 0.25));
      const tex = canvasTexture(256, 128, (ctx, w, h) => { ctx.fillStyle = '#05070a'; ctx.fillRect(0, 0, w, h); });
      const screen = decal(2.3, 1.15, tex, 0.285, { transparent: false, emissive: 1.0 }); screen.position.z = 0.25; m.group.add(screen);
      return { group: m.group, pins: m.pins, anchor: new THREE.Vector3(0, 1.0, 0), screen: tex, apply() {} };
    },
  },
  lcd1602: {
    name: 'LCD 16×2 with I2C backpack', cat: 'Display', icon: 'screen',
    desc: 'Two lines of 16 characters. The PCF8574 backpack (address 0x27) needs 5 V for good contrast but pulls SDA/SCL up to 5 V — remove its pull-ups or use a level shifter with the Pi.',
    pins: [P('GND', 'gnd'), P('VCC', 'vcc', { range: [4.5, 5.5] }), P('SDA', 'sda', { level: 'vcc' }), P('SCL', 'scl', { level: 'vcc' })],
    buy: '1602 LCD (HD44780) with PCF8574 I2C backpack + bidirectional I2C level shifter',
    build() {
      const g = new THREE.Group();
      g.add(slab(8.0, 3.6, 0.16, mat(COLORS.pcbGreen), 0.15));
      g.add(box(7.1, 0.7, 2.4, mat(0x1d2025), 0, 0.16, 0));
      const tex = canvasTexture(512, 128, (ctx, w, h) => { ctx.fillStyle = '#7dc242'; ctx.fillRect(0, 0, w, h); });
      const screen = decal(6.4, 1.6, tex, 0.865, { transparent: false, emissive: 0.6 }); g.add(screen);
      const bp = moduleBoard({ w: 4.2, d: 1.9, color: 0x1d2025, pins: ['GND', 'VCC', 'SDA', 'SCL'], pinEdge: 'front' });
      bp.group.position.set(-1.6, -0.0, 2.6); g.add(bp.group);
      const local = {}; for (const [k, v] of Object.entries(bp.pins)) local[k] = v.clone().add(bp.group.position);
      return { group: g, pins: local, anchor: new THREE.Vector3(0, 1.4, 0), screen: tex, lcd: true, apply() {} };
    },
  },
  epaper: {
    name: 'E-ink display 2.13" (SPI)', cat: 'Display', icon: 'screen',
    desc: 'An e-paper panel (250 × 122): it only uses power while it changes and keeps the picture with the power off. A full refresh takes a few seconds and flashes.',
    pins: [P('VCC', 'vcc', { range: [3.0, 5.5] }), P('GND', 'gnd'), P('DIN', 'mosi'), P('CLK', 'sck'), P('CS', 'cs'), P('DC', 'in', { max: 3.6 }), P('RST', 'in', { max: 3.6 }), P('BUSY', 'out', { level: 3.3 })],
    buy: '2.13" e-paper module 250 × 122, SPI, 3.3 V (Waveshare-style, 8-pin)',
    build() {
      const m = moduleBoard({ w: 6.5, d: 3.0, color: 0x1d2025, pins: ['VCC', 'GND', 'DIN', 'CLK', 'CS', 'DC', 'RST', 'BUSY'], pinEdge: 'front' });
      m.group.add(box(5.6, 0.1, 2.5, mat(0xf3f1ec), 0, 0.16, -0.15));
      const tex = canvasTexture(500, 244, (ctx, w, h) => { ctx.fillStyle = '#e9e6de'; ctx.fillRect(0, 0, w, h); });
      const screen = decal(4.85, 2.37, tex, 0.265, { transparent: false }); screen.position.set(-0.1, 0.265, -0.15); m.group.add(screen);
      return { group: m.group, pins: m.pins, anchor: new THREE.Vector3(0, 1.0, 0), screen: tex, apply() {} };
    },
  },
  matrix: {
    name: '8×8 LED matrix (MAX7219)', cat: 'Display', icon: 'matrix',
    desc: '64 red LEDs driven by a MAX7219 over SPI: three data wires, any pattern. Powered from 5 V; the Pi’s 3.3 V SPI signals usually drive it fine.',
    pins: [P('VCC', 'vcc', { range: [4, 5.5] }), P('GND', 'gnd'), P('DIN', 'mosi'), P('CS', 'cs'), P('CLK', 'sck')],
    buy: 'MAX7219 8×8 LED matrix module, 5 V, SPI',
    build() {
      const m = moduleBoard({ w: 3.3, d: 4.4, color: COLORS.pcbBlue, pins: ['VCC', 'GND', 'DIN', 'CS', 'CLK'], pinEdge: 'front' });
      m.group.add(box(3.25, 0.6, 3.25, mat(0x15171a), 0, 0.16, -0.4));
      const tex = canvasTexture(256, 256, () => {});
      const face = decal(3.15, 3.15, tex, 0.765, { transparent: false, emissive: 1.0 }); face.position.z = -0.4; m.group.add(face);
      const inst = { group: m.group, pins: m.pins, anchor: new THREE.Vector3(0, 1.3, 0), screen: tex,
        apply(s) {
          const ctx = tex.userData.ctx; ctx.fillStyle = '#121315'; ctx.fillRect(0, 0, 256, 256);
          const rows = s.rows || [];
          for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
            const on = (rows[y] >> (7 - x)) & 1;
            ctx.fillStyle = on ? '#ff3b2f' : '#3a1513';
            ctx.beginPath(); ctx.arc(16 + x * 32, 16 + y * 32, 11, 0, 7); ctx.fill();
          }
          tex.needsUpdate = true;
        } };
      inst.apply({ rows: [] });
      return inst;
    },
  },
  ring: {
    name: 'NeoPixel ring (12 × WS2812B)', cat: 'Output', icon: 'ring',
    desc: 'Twelve addressable RGB LEDs on one data wire. On the Pi 5 drive it from SPI MOSI (GPIO 10) with the neopixel_spi library — the older PWM/DMA method does not work on RP1.',
    pins: [P('5V', 'vcc', { range: [3.5, 5.3] }), P('GND', 'gnd'), P('DIN', 'in', { max: 5.5 })],
    buy: '12-LED WS2812B ring, 5 V (+ 74AHCT125 level shifter recommended)',
    build() {
      const g = new THREE.Group();
      const ringGeo = new THREE.RingGeometry(1.45, 2.2, 48); ringGeo.rotateX(-Math.PI / 2);
      const pcb = new THREE.Mesh(ringGeo, mat(0x1d2025, { extra: { side: THREE.DoubleSide } })); pcb.position.y = 0.16; g.add(pcb);
      const leds = [];
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
        const m = mat(0xf3f1ec, { unique: true, emissive: 0x000000 });
        const l = box(0.5, 0.16, 0.5, m, Math.cos(a) * 1.82, 0.16, Math.sin(a) * 1.82); l.rotation.y = -a; g.add(l);
        leds.push(m);
      }
      const local = { '5V': new THREE.Vector3(-0.3, 0.2, 2.25), GND: new THREE.Vector3(0, 0.2, 2.25), DIN: new THREE.Vector3(0.3, 0.2, 2.25) };
      return { group: g, pins: local, anchor: new THREE.Vector3(0, 0.8, 0),
        apply(s) { const px = s.pixels || []; leds.forEach((m, i) => { const c = px[i]; if (c) { m.emissive.setRGB(c[0] / 255, c[1] / 255, c[2] / 255); m.emissiveIntensity = 1.3; } else { m.emissive.setRGB(0, 0, 0); } }); } };
    },
  },
  servo: {
    name: 'Micro servo (SG90)', cat: 'Motion', icon: 'servo',
    desc: 'A small motor that turns to an angle (about 0–180°) set by a 50 Hz pulse of 0.5–2.5 ms. Power it from 5 V; the 3.3 V signal is enough.',
    pins: [P('GND', 'gnd'), P('V+', 'vcc', { range: [4.8, 6] }), P('SIG', 'pwm', { max: 5.5 })],
    buy: 'SG90 micro servo, 5 V, 180°',
    build() {
      const g = new THREE.Group();
      g.add(box(2.3, 2.2, 1.2, mat(0x2a6fd6, { roughness: 0.4, extra: { transparent: true, opacity: 0.94 } })));
      g.add(box(3.2, 0.14, 1.2, mat(0x2a6fd6), 0, 1.55, 0));
      g.add(cyl(0.6, 0.6, 0.45, mat(0x2a6fd6), -0.55, 2.2, 0));
      const horn = new THREE.Group();
      horn.add(cyl(0.25, 0.25, 0.25, mat(0xf3f1ec), 0, 0));
      const arm = box(0.32, 0.12, 1.9, mat(0xf3f1ec), 0, 0.13, -0.75); horn.add(arm);
      horn.position.set(-0.55, 2.65, 0); g.add(horn);
      const cable = [[0x5a3a22, 'GND'], [0xd8342a, 'V+'], [0xf08a24, 'SIG']];
      const local = {};
      cable.forEach(([c, n], i) => { g.add(box(0.1, 0.1, 0.9, mat(c), 1.05 + (i - 1) * 0.11, 0.3, 0.9)); local[n] = new THREE.Vector3(1.05 + (i - 1) * 0.11, 0.35, 1.35); });
      return { group: g, pins: local, anchor: new THREE.Vector3(0, 3.2, 0), horn,
        apply(s) { horn.rotation.y = THREE.MathUtils.degToRad((s.angle ?? 0)); } };
    },
  },
  motor: {
    name: 'DC gear motor + wheel', cat: 'Motion', icon: 'motor',
    desc: 'A 3–6 V “TT” gear motor. It draws hundreds of milliamps — far more than a GPIO pin can give — so it always goes through a driver.',
    pins: [P('M+', 'load'), P('M-', 'load')],
    buy: 'TT gear motor 3–6 V with 65 mm wheel',
    build() {
      const g = new THREE.Group();
      g.add(box(2.2, 1.9, 3.7, mat(0xf2c12e)));
      const wheel = new THREE.Group();
      const tyre = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.2, 1.2, 32), mat(0x23262b, { roughness: 0.9 })); tyre.rotation.z = Math.PI / 2; wheel.add(tyre);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(2.3, 2.3, 1.25, 6), mat(0xf86b1d)); hub.rotation.z = Math.PI / 2; wheel.add(hub);
      wheel.position.set(1.85, 3.2, -0.8); g.add(wheel);
      const local = { 'M+': new THREE.Vector3(-0.6, 1.95, 1.5), 'M-': new THREE.Vector3(-0.2, 1.95, 1.5) };
      let speed = 0;
      return { group: g, pins: local, anchor: new THREE.Vector3(0, 6.6, -0.8),
        apply(s) { speed = s.speed ?? 0; }, tick(t, dt) { wheel.rotation.x += speed * dt * 9; } };
    },
  },
  drv8833: {
    name: 'H-bridge driver (DRV8833)', cat: 'Interface', icon: 'chip',
    desc: 'Two H-bridges: each pair of inputs runs one motor forwards, backwards, or brakes it, at up to ~1.2 A per channel from a 2.7–10.8 V motor supply. 3.3 V logic friendly.',
    pins: [P('IN1', 'in', { max: 5.5 }), P('IN2', 'in', { max: 5.5 }), P('IN3', 'in', { max: 5.5 }), P('IN4', 'in', { max: 5.5 }), P('OUT1', 'drv'), P('OUT2', 'drv'), P('OUT3', 'drv'), P('OUT4', 'drv'), P('VM', 'vcc', { range: [2.7, 10.8], motor: true }), P('GND', 'gnd')],
    buy: 'DRV8833 dual H-bridge motor driver module (2.7–10.8 V, 3.3 V logic)',
    build() {
      const m = moduleBoard({ w: 2.8, d: 2.0, color: COLORS.pcbRed, pins: ['IN1', 'IN2', 'IN3', 'IN4', 'OUT1', 'OUT2', 'OUT3', 'OUT4', 'VM', 'GND'], pinEdge: 'front' });
      const c = chip(0.6, 0.5, 0.1, null); c.position.set(0, 0.16, -0.3); m.group.add(c);
      return { group: m.group, pins: m.pins, anchor: new THREE.Vector3(0, 1.0, 0), apply() {} };
    },
  },
  battery: {
    name: 'Battery pack (4 × AA)', cat: 'Power', icon: 'battery',
    desc: 'A separate supply for motors (about 6 V). Join its − to the Pi’s GND so the signals share a reference.',
    pins: [P('+', 'supply', { volts: 6 }), P('-', 'gnd')],
    buy: '4 × AA battery holder with switch (6 V)',
    build() {
      const g = new THREE.Group();
      g.add(box(5.8, 1.5, 3.0, mat(0x1d2025)));
      for (let i = 0; i < 4; i++) { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.66, 0.66, 5, 18), mat(i % 2 ? 0x2a5ea8 : 0xd8b25a)); c.rotation.z = Math.PI / 2; c.position.set(0, 1.25, -1.05 + i * 0.7); g.add(c); }
      const local = { '+': new THREE.Vector3(-2.9, 0.6, 1.6), '-': new THREE.Vector3(-2.9, 0.4, 1.3) };
      return { group: g, pins: local, anchor: new THREE.Vector3(0, 2.2, 0), apply() {} };
    },
  },
  stepper: {
    name: 'Stepper 28BYJ-48 + ULN2003', cat: 'Motion', icon: 'stepper',
    desc: 'A geared 5 V stepper (about 4096 half-steps per turn) and its ULN2003 driver board. Four GPIO pins energise the coils in sequence.',
    pins: [P('IN1', 'in', { max: 5.5 }), P('IN2', 'in', { max: 5.5 }), P('IN3', 'in', { max: 5.5 }), P('IN4', 'in', { max: 5.5 }), P('5V', 'vcc', { range: [4.5, 5.5] }), P('GND', 'gnd')],
    buy: '28BYJ-48 5 V stepper motor with ULN2003 driver board',
    build() {
      const g = new THREE.Group();
      const drv = moduleBoard({ w: 3.5, d: 3.2, color: COLORS.pcbGreen, pins: ['IN1', 'IN2', 'IN3', 'IN4', '5V', 'GND'], pinEdge: 'front' });
      drv.group.add(chip(2.0, 0.65, 0.3, ['ULN2003'], 0x1d2025).translateY(0.16).translateZ(-0.4));
      const ledMats = [];
      for (let i = 0; i < 4; i++) { const lm = mat(0xff3b30, { unique: true, emissive: 0xff3b30 }); lm.emissiveIntensity = 0; ledMats.push(lm); drv.group.add(box(0.2, 0.1, 0.2, lm, -0.6 + i * 0.4, 0.16, 0.5)); }
      drv.group.position.x = 2.4; g.add(drv.group);
      const motor = new THREE.Group();
      motor.add(cyl(1.4, 1.4, 1.9, metal(0xc4c9cf)));
      motor.add(box(1.6, 1.7, 0.9, mat(0x2a5ea8), 0, 0.1, 1.35));
      const shaft = new THREE.Group();
      shaft.add(cyl(0.12, 0.12, 0.6, metal(0xd8b25a), 0, 0));
      shaft.add(box(0.12, 0.12, 2.2, mat(0xf86b1d), 0, 0.6, 0.6));
      shaft.position.set(0, 1.9, -0.6); motor.add(shaft);
      motor.position.x = -1.8; g.add(motor);
      const local = {}; for (const [k, v] of Object.entries(drv.pins)) local[k] = v.clone().add(drv.group.position);
      return { group: g, pins: local, anchor: new THREE.Vector3(-1.8, 3, 0),
        apply(s) { shaft.rotation.y = -THREE.MathUtils.degToRad(s.angle ?? 0); const ph = s.phase ?? -1; ledMats.forEach((m, i) => { m.emissiveIntensity = ph >= 0 && ((ph >> i) & 1) ? 1.2 : 0; }); } };
    },
  },
  relay: {
    name: 'Relay module (1 channel)', cat: 'Output', icon: 'relay',
    desc: 'An electrically separate switch for a bigger load. Use a 3.3 V-trigger (or optocoupled) module; keep mains wiring to qualified people — here it switches a 12 V lamp.',
    pins: [P('VCC', 'vcc', { range: [3.3, 5.5] }), P('GND', 'gnd'), P('IN', 'in', { max: 5.5 }), P('COM', 'contact'), P('NO', 'contact')],
    buy: '1-channel relay module with optocoupler, 3.3 V trigger, 10 A contacts',
    build() {
      const m = moduleBoard({ w: 2.6, d: 5.0, color: COLORS.pcbBlue, pins: ['VCC', 'GND', 'IN'], pinEdge: 'front' });
      m.group.add(box(1.9, 1.55, 1.5, mat(0x2a5ea8, { roughness: 0.4 }), 0, 0.16, -0.6));
      const lab = silk(['SRD-05VDC', '10A 250VAC'], 1.8, 1.4, { size: 16 }); const ld = decal(1.7, 1.3, lab, 1.715); ld.position.z = -0.6; m.group.add(ld);
      m.group.add(box(1.6, 0.9, 0.8, mat(0x2a7dd6), 0, 0.16, -2.0));
      const lm = mat(0xff3b30, { unique: true, emissive: 0xff3b30 }); lm.emissiveIntensity = 0; m.group.add(box(0.2, 0.1, 0.2, lm, 0.9, 0.16, 1.0));
      m.pins.COM = new THREE.Vector3(-0.3, 1.1, -2.2); m.pins.NO = new THREE.Vector3(0.3, 1.1, -2.2);
      return { group: m.group, pins: m.pins, anchor: new THREE.Vector3(0, 2.2, 0), apply(s) { lm.emissiveIntensity = s.on ? 1.4 : 0; } };
    },
  },
  lamp: {
    name: '12 V lamp', cat: 'Output', icon: 'bulb',
    desc: 'A low-voltage bulb with its own 12 V supply, switched by the relay contacts.',
    pins: [P('L1', 'load'), P('L2', 'load')],
    buy: '12 V lamp or LED bulb with holder + 12 V DC adapter',
    build() {
      const g = new THREE.Group();
      g.add(cyl(0.9, 1.1, 0.8, mat(0x2b2f36)));
      const bm = mat(0xfff1c9, { unique: true, transparent: true, opacity: 0.85, emissive: 0xffc860, roughness: 0.2 }); bm.emissiveIntensity = 0;
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(1.0, 24, 16), bm); bulb.position.y = 1.7; g.add(bulb);
      const glow = glowSprite(0xffd27a, 5); glow.position.y = 1.7; g.add(glow);
      const local = { L1: new THREE.Vector3(-0.4, 0.5, 0.9), L2: new THREE.Vector3(0.4, 0.5, 0.9) };
      return { group: g, pins: local, anchor: new THREE.Vector3(0, 3, 0), apply(s) { bm.emissiveIntensity = s.on ? 1.3 : 0; glow.material.opacity = s.on ? 0.9 : 0; } };
    },
  },
  psu12: {
    name: '12 V DC supply', cat: 'Power', icon: 'battery',
    desc: 'A wall adapter for the lamp circuit, kept separate from the Pi.',
    pins: [P('+', 'supply', { volts: 12 }), P('-', 'gnd')],
    buy: '12 V DC wall adapter + DC barrel jack terminal adapter',
    build() {
      const g = new THREE.Group();
      g.add(box(2.4, 1.6, 3.2, mat(0x23262b)));
      g.add(box(1.0, 0.8, 1.0, mat(0x1d2025), 0, 0, 2.0));
      const local = { '+': new THREE.Vector3(-0.25, 0.85, 2.4), '-': new THREE.Vector3(0.25, 0.85, 2.4) };
      return { group: g, pins: local, anchor: new THREE.Vector3(0, 2.1, 0), apply() {} };
    },
  },
  trafficlight: {
    name: 'Traffic light module', cat: 'Output', icon: 'traffic',
    desc: 'Red, amber and green LEDs with resistors already fitted; common GND.',
    pins: [P('R', 'in', { max: 5.5 }), P('Y', 'in', { max: 5.5 }), P('G', 'in', { max: 5.5 }), P('GND', 'gnd')],
    buy: 'Traffic-light LED module (R/Y/G, resistors on board)',
    build() {
      const m = moduleBoard({ w: 1.4, d: 5.6, color: 0x1d2025, pins: ['R', 'Y', 'G', 'GND'], pinEdge: 'front' });
      const lens = [];
      [[0xff3b30, -1.7], [0xffb020, -0.4], [0x30d158, 0.9]].forEach(([c, z]) => {
        const lm = mat(c, { unique: true, emissive: c, transparent: true, opacity: 0.9 }); lm.emissiveIntensity = 0.05;
        const l = cyl(0.5, 0.5, 0.35, lm, 0, 0.16, z); m.group.add(l);
        const gl = glowSprite(c, 2.2); gl.position.set(0, 0.8, z); m.group.add(gl);
        lens.push([lm, gl]);
      });
      return { group: m.group, pins: m.pins, anchor: new THREE.Vector3(0, 1.2, -0.4),
        apply(s) { ['r', 'y', 'g'].forEach((k, i) => { const on = s[k] ? 1 : 0; lens[i][0].emissiveIntensity = 0.05 + on * 1.5; lens[i][1].material.opacity = on * 0.85; }); } };
    },
  },
  keypad: {
    name: 'Keypad 3×4 (membrane)', cat: 'Input', icon: 'keypad',
    desc: 'Twelve keys on a grid of 4 rows and 3 columns: drive one column at a time and read the rows — 7 wires for 12 keys.',
    pins: [P('R1', 'io'), P('R2', 'io'), P('R3', 'io'), P('R4', 'io'), P('C1', 'io'), P('C2', 'io'), P('C3', 'io')],
    buy: '3×4 membrane keypad, 7-pin', input: 'keys',
    build() {
      const g = new THREE.Group();
      g.add(slab(5.0, 6.6, 0.08, mat(0x1d2025), 0.25));
      const tex = canvasTexture(250, 330, (ctx) => {
        ctx.fillStyle = '#1d2025'; ctx.fillRect(0, 0, 250, 330);
        const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];
        ctx.font = '700 30px "Barlow", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        keys.forEach((k, i) => { const x = 22 + (i % 3) * 72, y = 18 + Math.floor(i / 3) * 76; ctx.fillStyle = k === '*' || k === '#' ? '#c4442f' : '#2f5fb8'; ctx.beginPath(); ctx.roundRect(x, y, 62, 62, 10); ctx.fill(); ctx.fillStyle = '#fff'; ctx.fillText(k, x + 31, y + 33); });
      });
      const d = decal(4.8, 6.3, tex, 0.085); g.add(d);
      g.add(box(1.8, 0.04, 2.2, mat(0xd8b25a), 0, 0, 4.3));
      const local = {}; ['R1', 'R2', 'R3', 'R4', 'C1', 'C2', 'C3'].forEach((n, i) => { local[n] = new THREE.Vector3(-0.76 + i * 0.254, 0.08, 5.4); });
      return { group: g, pins: local, anchor: new THREE.Vector3(0, 0.6, 0), apply() {} };
    },
  },
  cooler: {
    name: 'Raspberry Pi Active Cooler', cat: 'Pi 5', icon: 'fan',
    desc: 'The official clip-on heatsink and blower fan for Pi 5. It plugs into the fan header and the firmware speeds it up as the CPU warms.',
    pins: [P('FAN', 'fan')], board: 'pi5',
    buy: 'Raspberry Pi Active Cooler (official, for Pi 5)',
    build() {
      const g = new THREE.Group();
      g.add(box(5.2, 0.5, 3.6, metal(0x9aa3ad)));
      for (let i = 0; i < 9; i++) g.add(box(0.12, 0.6, 3.4, metal(0xaab2bb), -2.4 + i * 0.25, 0.5, 0));
      const fan = new THREE.Group();
      fan.add(cyl(1.15, 1.15, 0.12, mat(0x23262b), 0, 0));
      const blades = new THREE.Group();
      for (let i = 0; i < 7; i++) { const b = box(0.9, 0.06, 0.25, mat(0x2f3339), 0.5, 0.12, 0); const holder = new THREE.Group(); holder.add(b); holder.rotation.y = (i / 7) * Math.PI * 2; blades.add(holder); }
      fan.add(blades);
      fan.add(cyl(0.35, 0.35, 0.2, mat(0x1d2025), 0, 0.1));
      fan.position.set(1.2, 0.95, 0); g.add(fan);
      const local = { FAN: new THREE.Vector3(2.5, 0.4, -1.6) };
      let speed = 0.2;
      return { group: g, pins: local, anchor: new THREE.Vector3(0, 1.5, 0),
        apply(s) { speed = s.speed ?? 0.2; }, tick(t, dt) { blades.rotation.y += speed * dt * 40; } };
    },
  },
  cam3: {
    name: 'Camera Module 3', cat: 'Pi 5', icon: 'camera',
    desc: 'The 12 MP Sony IMX708 camera with autofocus and HDR. On Pi 5 it plugs into a CAM/DISP port with a 22-to-15-pin FPC cable; Picamera2 drives it from Python.',
    pins: [P('CSI', 'csi')], board: 'pi5',
    buy: 'Raspberry Pi Camera Module 3 (12 MP, autofocus) + Pi 5 camera cable (22-pin to 15-pin)',
    build() {
      const g = new THREE.Group();
      g.add(slab(2.5, 2.4, 0.1, mat(COLORS.pcbGreen), 0.12));
      g.add(box(0.85, 0.5, 0.85, mat(0x1d2025), 0, 0.1, -0.15));
      g.add(cyl(0.38, 0.38, 0.35, mat(0x15171a), 0, 0.6, -0.15));
      const glass = new THREE.Mesh(new THREE.CircleGeometry(0.26, 24), new THREE.MeshStandardMaterial({ color: 0x223a66, roughness: 0.05, metalness: 0.6 })); glass.rotation.x = -Math.PI / 2; glass.position.set(0, 0.96, -0.15); g.add(glass);
      g.add(box(1.6, 0.2, 0.45, mat(0xf0ece2), 0, 0.1, 0.95));
      const local = { CSI: new THREE.Vector3(0, 0.3, 1.1) };
      // stand it up, facing forward
      const holder = new THREE.Group(); holder.add(g); g.rotation.x = Math.PI / 2 - 0.25; g.position.y = 1.4;
      holder.add(box(2.2, 0.3, 1.4, mat(0x2b2f36), 0, 0, 0.4));
      const pin = local.CSI.clone().applyEuler(g.rotation).add(g.position);
      return { group: holder, pins: { CSI: pin }, anchor: new THREE.Vector3(0, 2.8, 0), apply() {} };
    },
  },
  aikit: {
    name: 'AI Kit (M.2 HAT+ with Hailo-8L)', cat: 'Pi 5', icon: 'ai',
    desc: 'A Hailo-8L neural accelerator (13 TOPS) on an M.2 HAT+, linked to the Pi 5 over PCIe. rpicam-apps and Picamera2 run detection and pose models on it in real time.',
    pins: [P('PCIe', 'pcie')], board: 'pi5',
    buy: 'Raspberry Pi AI Kit (M.2 HAT+ with Hailo-8L, 13 TOPS) or AI HAT+ — plus Pi 5 Active Cooler',
    build() {
      const g = new THREE.Group();
      g.add(slab(6.5, 5.6, 0.16, mat(COLORS.pcbGreen), 0.3));
      g.add(box(4.2, 0.16, 2.2, mat(0x1d2025), 0.4, 0.16, 0.6));
      g.add(chip(1.2, 1.2, 0.12, ['HAILO'], 0x23262b).translateX(0.9).translateY(0.32).translateZ(0.6));
      const lab = silk(['M.2 HAT+'], 2.0, 0.5, { size: 15 }); const ld = decal(2, 0.5, lab, 0.163); ld.position.set(-1.6, 0.163, -1.8); g.add(ld);
      const lm = mat(0x30d158, { unique: true, emissive: 0x30d158 }); lm.emissiveIntensity = 0.1; g.add(box(0.15, 0.08, 0.1, lm, 2.9, 0.16, -2.2));
      g.add(box(0.35, 0.28, 1.35, mat(0xf0ece2), -3.0, 0.16, 0.75));
      const local = { PCIe: new THREE.Vector3(-3.0, 0.45, 0.75) };
      return { group: g, pins: local, anchor: new THREE.Vector3(0, 1.0, 0), apply(s) { lm.emissiveIntensity = s.busy ? 1.4 : 0.1; } };
    },
  },
  levelshift: {
    name: 'Logic level shifter (4-ch, BSS138)', cat: 'Power', icon: 'chip',
    desc: 'Bidirectional 3.3 V ↔ 5 V translator for I2C and other slow signals. LV goes to 3.3 V, HV to 5 V, grounds together; LV1–LV2 face the Pi, HV1–HV2 face the 5 V device.',
    pins: [P('LV', 'vcc', { range: [1.8, 3.6] }), P('LV1', 'shift', { side: 'lv' }), P('LV2', 'shift', { side: 'lv' }), P('GND', 'gnd'), P('HV', 'vcc', { range: [3.3, 5.5] }), P('HV1', 'shift', { side: 'hv' }), P('HV2', 'shift', { side: 'hv' })],
    buy: 'Bidirectional logic level converter, 4-channel, BSS138, 3.3 V ↔ 5 V',
    build() {
      const m = moduleBoard({ w: 2.0, d: 1.6, color: COLORS.pcbRed, pins: ['LV', 'LV1', 'LV2', 'GND', 'HV', 'HV1', 'HV2'], pinEdge: 'front' });
      for (let i = 0; i < 4; i++) m.group.add(box(0.28, 0.1, 0.16, mat(0x1b1d21), -0.6 + i * 0.4, 0.16, -0.3));
      return { group: m.group, pins: m.pins, anchor: new THREE.Vector3(0, 0.9, 0), apply() {} };
    },
  },
};

export const PART_TYPES = Object.keys(PARTS);

// Build one placed part instance.
export function makePart(type, opts = {}) {
  const def = PARTS[type];
  if (!def) throw new Error(`Unknown part type: ${type}`);
  const inst = def.build(opts);
  inst.type = type;
  inst.def = def;
  inst.state = {};
  inst.set = (patch) => { Object.assign(inst.state, patch); inst.apply?.(inst.state); };
  inst.group.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
  return inst;
}

// Draw helpers for the screen parts.
export function drawScreen(inst, fn) {
  if (!inst?.screen) return;
  const { ctx, canvas } = inst.screen.userData;
  fn(ctx, canvas.width, canvas.height);
  inst.screen.needsUpdate = true;
}
