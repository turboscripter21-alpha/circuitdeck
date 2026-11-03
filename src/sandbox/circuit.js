// The sandbox's circuit model: endpoints, nets, and every wiring check.
// A circuit is plain JSON:
//   { v: 1, board: 'esp32' | 'pi5', name, parts: [{ id, type, opts, x, z, rot, on }], wires: [[a, b], ...] }
// An endpoint is a board pin id from boardPins() ("GPIO17", "GND@6", "CAM0") or "<partId>.<pin>".
import { PARTS } from '../core/parts.js';
import { boardPins, ESP_FLAGS, PI_PIN_NUMBER } from '../core/boards.js';

export const BOARDS = {
  esp32: { name: 'ESP32 DevKit', short: 'ESP32', logic: 3.3 },
  pi5: { name: 'Raspberry Pi 5', short: 'Pi 5', logic: 3.3 },
};
// M11 · boards the canvas also offers (not in the sandbox's board switch)
export const BOARDS_ALL = { ...BOARDS, esp32s3: { name: 'ESP32-S3 board', short: 'ESP32-S3', logic: 3.3 } };
// The hardware buses' default pins on each board.
export const BUS = {
  pi5: { sda: ['GPIO2'], scl: ['GPIO3'], mosi: ['GPIO10'], miso: ['GPIO9'], sck: ['GPIO11'], cs: ['GPIO8', 'GPIO7'] },
  esp32: { sda: ['GPIO21'], scl: ['GPIO22'], mosi: ['GPIO23'], miso: ['GPIO19'], sck: ['GPIO18'], cs: ['GPIO5', 'GPIO15'] },
  esp32s3: { sda: ['GPIO8'], scl: ['GPIO9'], mosi: ['GPIO11'], miso: ['GPIO13'], sck: ['GPIO12'], cs: ['GPIO10'] },
};
const PORT_FOR = { csi: ['CAM0', 'CAM1'], pcie: ['PCIE'], fan: ['FAN'] };
const LED_VF = { red: 2.0, yellow: 2.1, orange: 2.1, green: 2.2, blue: 3.0, white: 3.0 };
const OHMS = { 220: 220, 330: 330, '1k': 1000, '2k': 2000, '10k': 10000 };
export const ohms = (p) => OHMS[p.opts?.ohms || '330'] || 330;

const pinCache = {};
export function pinsOf(board) { return (pinCache[board] ||= boardPins(board)); }
export function boardPin(board, id) { return pinsOf(board).find((p) => p.id === id); }
export const isBoardRef = (ref) => !ref.includes('.');
export function splitRef(ref) { const i = ref.indexOf('.'); return [ref.slice(0, i), ref.slice(i + 1)]; }
export function partPinDef(type, pin) { return PARTS[type]?.pins.find((p) => p.n === pin); }

// Human label for any endpoint.
export function refLabel(c, ref) {
  if (isBoardRef(ref)) {
    const p = boardPin(c.board, ref);
    if (!p) return ref;
    if (p.kind === 'gpio' && c.board === 'pi5') return `${p.name} (pin ${p.phys})`;
    if (p.phys) return `${p.name} (pin ${p.phys})`;
    return p.name;
  }
  const [id, pin] = splitRef(ref);
  const part = c.parts.find((x) => x.id === id);
  if (!part) return ref;
  const d = partPinDef(part.type, pin);
  return `${partName(c, part)} · ${d?.label || pin}`;
}
export function partName(c, part) {
  const same = c.parts.filter((x) => x.type === part.type);
  const base = PARTS[part.type].name.replace(/ \(.*\)$/, '');
  return same.length > 1 ? `${base} ${same.indexOf(part) + 1}` : base;
}

// ---------------------------------------------------------------- nets
// Wires join endpoints into nets (union-find). Parts never join their own pins:
// a resistor, button or relay contact is a component between two nets.
export function nets(c) {
  const parent = new Map();
  const find = (x) => { if (!parent.has(x)) parent.set(x, x); let r = x; while (parent.get(r) !== r) r = parent.get(r); parent.set(x, r); return r; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
  for (const [a, b] of c.wires) union(a, b);
  const byRoot = new Map();
  for (const x of parent.keys()) { const r = find(x); if (!byRoot.has(r)) byRoot.set(r, []); byRoot.get(r).push(x); }
  const list = [...byRoot.values()].map((members, i) => ({ i, members }));
  const netOf = new Map();
  for (const n of list) for (const m of n.members) netOf.set(m, n);
  return { list, netOf };
}

// What a net is tied to: board power/ground/gpio, supplies, and part pins with roles.
function describe(c, net) {
  const d = { board: [], gpio: [], power: [], gnd: false, supply: [], pins: [] };
  for (const ref of net.members) {
    if (isBoardRef(ref)) {
      const p = boardPin(c.board, ref);
      if (!p) continue;
      d.board.push(p);
      if (p.kind === 'gpio') d.gpio.push(p.name);
      else if (p.kind === 'power') d.power.push(p);
      else if (p.kind === 'gnd') d.gnd = true;
    } else {
      const [id, pin] = splitRef(ref);
      const part = c.parts.find((x) => x.id === id);
      const def = part && partPinDef(part.type, pin);
      if (!def) continue;
      d.pins.push({ ref, part, def });
      if (def.role === 'gnd') d.gnd = true; // a part's ground pin carries ground only when wired to one; resolved below
      if (def.role === 'supply') d.supply.push({ part, volts: def.volts });
    }
  }
  return d;
}

// Voltage of a net: board rail, external supply, ground, or unknown (null).
function netVolts(info) {
  if (info.power.length) return Math.max(...info.power.map((p) => p.volts));
  if (info.supply.length) return Math.max(...info.supply.map((s) => s.volts));
  if (info.realGnd) return 0;
  return null;
}

// ---------------------------------------------------------------- analysis
// Returns { issues: [{ sev: 'error'|'warn'|'info', msg, parts: [ids], refs: [] }], conn } where
// conn lets the code generator and simulation ask "which GPIO drives this pin?".
export function analyse(c) {
  const { list, netOf } = nets(c);
  const info = new Map(list.map((n) => [n, describe(c, n)]));
  const issues = [];
  const add = (sev, msg, parts = [], refs = []) => issues.push({ sev, msg, parts, refs });
  const ledLoad = [];
  const net = (ref) => netOf.get(ref) || null;
  const I = (ref) => { const n = net(ref); return n ? info.get(n) : null; };
  const label = (ref) => refLabel(c, ref);
  const board = c.board;
  const B = BOARDS_ALL[board];

  // A ground net is one tied to the board's GND or a supply's minus terminal.
  for (const [n, d] of info) d.realGnd = d.board.some((p) => p.kind === 'gnd') || d.pins.some((p) => p.def.role === 'gnd' && p.part.type in { battery: 1, psu12: 1 });
  // propagate: grounds that share a supply's minus with the board are the same ground
  const volts = (ref) => { const d = I(ref); return d ? netVolts(d) : null; };

  // Hop through one resistor (or LDR): the nets on the far side of every resistor in this net.
  const viaR = (n) => {
    const out = [];
    for (const p of info.get(n).pins) {
      if (p.def.role !== 'pass') continue;
      const other = PARTS[p.part.type].pins.find((x) => x.n !== p.def.n);
      const on = net(`${p.part.id}.${other.n}`);
      if (on) out.push({ net: on, r: p.part });
    }
    return out;
  };

  // ---- shorts and rails
  for (const [n, d] of info) {
    const rails = new Set(d.power.map((p) => p.volts));
    const hasGnd = d.realGnd;
    if (rails.size && hasGnd) add('error', `Short circuit: ${d.power[0].name} is wired straight to ground. That can reset or damage the board.`, [], n.members);
    else if (rails.size > 1) add('error', 'Short circuit: the 3.3 V and 5 V rails are wired together.', [], n.members);
    if (d.supply.length && hasGnd) add('error', `Short circuit: ${partName(c, d.supply[0].part)} + is wired to ground.`, [d.supply[0].part.id], n.members);
    if (d.supply.length && rails.size) add('error', `${partName(c, d.supply[0].part)} (${d.supply[0].volts} V) is wired into the board’s ${d.power[0].name} rail — never back-feed the board from an external supply.`, [d.supply[0].part.id], n.members);
    if (d.supply.length && d.gpio.length) add('error', `${partName(c, d.supply[0].part)} (${d.supply[0].volts} V) is wired straight to ${d.gpio[0]} — that would destroy the pin.`, [d.supply[0].part.id], n.members);
    if (d.gpio.length > 1) add('error', `Pin conflict: ${d.gpio.join(' and ')} are wired together. If both are outputs they fight each other.`, [], n.members);
    if (d.gpio.length && (rails.size || hasGnd)) add('error', `${d.gpio[0]} is wired straight to ${rails.size ? d.power[0].name : 'GND'}. Set as an output it shorts — put a part (or a resistor) in between.`, [], n.members);
    if (board === 'esp32') for (const g of d.gpio) {
      const num = +g.slice(4);
      if (ESP_FLAGS.flash.includes(num)) add('error', `${g} is used by the ESP32’s flash chip — using it crashes the board.`, [], n.members);
    }
  }

  // ---- per-part checks
  const gpioUse = new Map(); // gpio -> [{part, pin, role}]
  const bus = { sda: [], scl: [] };
  for (const part of c.parts) {
    const def = PARTS[part.type];
    const name = partName(c, part);
    if (def.board && def.board !== board) { add('error', `${name} only works with the Raspberry Pi 5 — remove it or switch boards.`, [part.id]); continue; }
    const vccPins = def.pins.filter((p) => p.role === 'vcc');
    const gndPins = def.pins.filter((p) => p.role === 'gnd');
    let powered = true;
    for (const p of vccPins) {
      const ref = `${part.id}.${p.n}`;
      const v = volts(ref);
      if (v == null) { if (!p.ref) { add('error', `${name} has no power: wire ${p.label || p.n} to ${p.range[0] > 3.6 ? '5 V' : '3.3 V'}${p.motor ? ' or a battery pack' : ''}.`, [part.id], [ref]); powered = false; } continue; }
      if (v === 0) { add('error', `${name}: ${p.n} is on ground — it needs ${p.range[0]}–${p.range[1]} V.`, [part.id], [ref]); powered = false; continue; }
      if (v > p.range[1] + 0.05) { add('error', `Over-voltage: ${name} ${p.n} gets ${v} V but takes at most ${p.range[1]} V — it would be damaged.`, [part.id], [ref]); powered = false; }
      else if (v < p.range[0] - 0.05) { add('warn', `Under-voltage: ${name} ${p.n} gets ${v} V but needs ${p.range[0]}–${p.range[1]} V — it may not work reliably.`, [part.id], [ref]); }
      if (p.motor && I(ref).power.length) add('warn', `${name} runs its motors from the board’s ${I(ref).power[0].name} pin. Motors are noisy and hungry — a separate battery pack is safer.`, [part.id], [ref]);
    }
    for (const p of gndPins) {
      const ref = `${part.id}.${p.n}`;
      if (['battery', 'psu12'].includes(part.type)) continue;
      const d = I(ref);
      if (!d) { add('error', `${name} has no ground: wire ${p.n} to GND.`, [part.id], [ref]); powered = false; }
      else if (!d.realGnd && !d.pins.some((x) => x.def.role === 'switch' || x.def.role === 'pass')) { add('error', `${name}: ${p.n} is not connected to ground.`, [part.id], [ref]); }
    }
    // signal pins
    let usesGpio = false;
    for (const p of def.pins) {
      const ref = `${part.id}.${p.n}`;
      const n = net(ref);
      if (['vcc', 'gnd', 'supply'].includes(p.role)) continue;
      if (!n) {
        if (['in', 'out', 'pwm', 'aout', 'sda', 'scl', 'mosi', 'sck', 'cs', 'io', 'csi', 'pcie', 'fan'].includes(p.role) && !(def.pins.length > 6 && p.role === 'ain') && !(p.role === 'miso')) add('info', `${name}: ${p.label || p.n} is not connected yet.`, [part.id], [ref]);
        continue;
      }
      const d = info.get(n);
      // through one resistor (for LEDs and dividers)
      const far = viaR(n);
      const gpioHere = d.gpio, gpioFar = far.flatMap((f) => info.get(f.net).gpio);
      if (p.role !== 'pass') for (const g of gpioHere) { usesGpio = true; (gpioUse.get(g) || gpioUse.set(g, []).get(g)).push({ part, pin: p, direct: true }); }
      if (p.role === 'in' || p.role === 'pwm' || p.role === 'io' || p.role === 'switch') for (const g of gpioFar) { usesGpio = true; (gpioUse.get(g) || gpioUse.set(g, []).get(g)).push({ part, pin: p, direct: false }); }

      if (p.role === 'csi' || p.role === 'pcie' || p.role === 'fan') {
        const ok = d.board.some((b) => PORT_FOR[p.role].includes(b.id));
        if (!ok) add('error', `${name} must plug into the Pi 5’s ${PORT_FOR[p.role].join(' or ')} connector.`, [part.id], [ref]);
        const devices = d.pins.filter((x) => ['csi', 'pcie', 'fan'].includes(x.def.role));
        if (devices.length > 1 && devices[0].part === part) add('error', `Two devices share the ${d.board[0]?.name || 'same'} connector — each takes its own port.`, devices.map((x) => x.part.id), [ref]);
        continue;
      }
      if (d.board.some((b) => ['csi', 'pcie', 'fan'].includes(b.kind))) { add('error', `${name} ${p.n} is wired to a ribbon/fan connector — those only take the camera, AI Kit or cooler.`, [part.id], [ref]); continue; }

      // logic level going into the board
      if (p.role === 'out' || p.role === 'sda' || p.role === 'scl' || p.role === 'miso' || p.role === 'io') {
        const lvl = p.level === 'vcc' ? Math.max(0, ...vccPins.map((v) => volts(`${part.id}.${v.n}`) ?? 0)) : p.level ?? 3.3;
        if (lvl > 3.6 && gpioHere.length) add('error', `Voltage: ${name} ${p.n} outputs ${lvl} V into ${gpioHere[0]}, but the ${B.short}’s GPIO is 3.3 V only — add a level shifter or a 1 kΩ/2 kΩ divider.`, [part.id], [ref]);
        if (lvl > 3.6 && !gpioHere.length && gpioFar.length) {
          // a divider? R1 from the output to the GPIO node, R2 from that node to ground
          for (const f of far) {
            const node = info.get(f.net);
            if (!node.gpio.length) continue;
            const r1 = ohms(f.r);
            const r2s = viaR(f.net).filter((x) => x.r !== f.r && info.get(x.net).realGnd).map((x) => ohms(x.r));
            if (!r2s.length) add('error', `Voltage: ${name} ${p.n} (${lvl} V) reaches ${node.gpio[0]} through one resistor only — a series resistor does not lower the voltage. Add a second resistor from ${node.gpio[0]} to GND (a divider).`, [part.id], [ref]);
            else {
              const r2 = r2s[0], vout = +(lvl * r2 / (r1 + r2)).toFixed(2);
              if (vout > 3.6) add('error', `Voltage: the divider gives ${vout} V on ${node.gpio[0]} — still above 3.3 V. Swap the resistors (bigger one to GND).`, [part.id], [ref]);
              else if (vout < 2.0) add('warn', `The divider gives only ${vout} V on ${node.gpio[0]}; the pin may not read it as HIGH.`, [part.id], [ref]);
            }
          }
        }
        if (p.role === 'out' && d.pins.filter((x) => x.def.role === 'out').length > 1 && d.pins.find((x) => x.def.role === 'out').part === part) add('error', `Pin conflict: two outputs (${d.pins.filter((x) => x.def.role === 'out').map((x) => partName(c, x.part)).join(', ')}) drive the same wire.`, [part.id], [ref]);
        if (p.role === 'out' && d.pins.some((x) => x.def.role === 'shift' && x.def.side === 'lv') && lvl > 3.6) add('error', `${name} is a ${lvl} V signal: connect it to the level shifter’s HV side, not LV.`, [part.id], [ref]);
      }
      if (p.role === 'aout') {
        if (gpioHere.length && board === 'pi5') add('error', `${name} gives an analog voltage, but the Pi 5 has no analog inputs — read it through an MCP3008 ADC.`, [part.id], [ref]);
        if (gpioHere.length && board === 'esp32') {
          const num = +gpioHere[0].slice(4);
          const top = Math.max(0, ...vccPins.map((v) => volts(`${part.id}.${v.n}`) ?? 0));
          if (top > 3.6) add('error', `Voltage: ${name} runs on ${top} V, so its analog output can exceed 3.3 V on ${gpioHere[0]}. Power it from 3V3.`, [part.id], [ref]);
          if (!ESP_FLAGS.adc1.includes(num)) add('warn', `${gpioHere[0]} is not an ADC1 pin — analogRead() there stops working when Wi-Fi is on. Use GPIO 32–39.`, [part.id], [ref]);
        }
        if (!gpioHere.length && !d.pins.some((x) => x.def.role === 'ain')) add('info', `${name}: the analog output is not read by anything.`, [part.id], [ref]);
      }
      if (p.role === 'ain' && d.pins.some((x) => x.def.role === 'aout')) {
        const src = d.pins.find((x) => x.def.role === 'aout');
        const sv = Math.max(0, ...PARTS[src.part.type].pins.filter((v) => v.role === 'vcc').map((v) => volts(`${src.part.id}.${v.n}`) ?? 0));
        const ref2 = def.pins.find((x) => x.n === 'VREF');
        const vref = ref2 ? volts(`${part.id}.VREF`) : null;
        if (vref != null && sv > vref + 0.05) add('warn', `${partName(c, src.part)} runs on ${sv} V but the ADC’s VREF is ${vref} V — readings above ${vref} V clip at the top.`, [part.id, src.part.id], [ref]);
      }
      // buses on the default pins
      const busRole = { sda: 'sda', scl: 'scl', mosi: 'mosi', miso: 'miso', sck: 'sck', cs: 'cs' }[p.role];
      if (busRole && gpioHere.length) {
        if (!BUS[board][busRole].includes(gpioHere[0])) add('warn', `${name} ${p.n} is on ${gpioHere[0]}; the ${B.short}’s hardware ${busRole.toUpperCase()} pin is ${BUS[board][busRole].join(' or ')}. The template code assumes the hardware bus.`, [part.id], [ref]);
        if (busRole === 'sda') bus.sda.push(part);
      }
      // loads need a driver
      if (p.role === 'load') {
        if (gpioHere.length || d.power.length) add('error', `${name} is wired straight to the board (${gpioHere[0] || d.power[0].name}). A GPIO can give about 16 mA — a motor or lamp needs a driver (H-bridge or relay).`, [part.id], [ref]);
      }
      // LEDs: a series resistor, the right way round
      if (part.type === 'led' || part.type === 'rgbled') {
        if (p.role === 'in' && (gpioHere.length || d.power.length)) add('error', `${name} has no current-limiting resistor on ${p.n} — it will draw too much current and can burn out ${gpioHere[0] || 'the LED'}. Put a 220–330 Ω resistor in series.`, [part.id], [ref]);
        if (p.role === 'in' && d.realGnd) add('warn', `${name} looks backwards: its anode is on ground. The long leg (anode) goes towards the GPIO.`, [part.id], [ref]);
        // M8: current through the series resistor — too dim, or too much for the pin
        if (p.role === 'in' && !gpioHere.length && !d.power.length) for (const f of far) {
          const fd = info.get(f.net);
          const src = fd.gpio.length ? 3.3 : fd.power.length ? Math.max(...fd.power.map((x) => x.volts)) : null;
          if (src == null) continue;
          const vf = LED_VF[part.opts?.color] ?? 2.0, R = ohms(f.r), mA = Math.max(0, (src - vf) / R * 1000);
          const rTxt = `${f.r.opts?.ohms || '330'} Ω`;
          if (fd.gpio.length) ledLoad.push({ part, mA, g: fd.gpio[0] });
          if (mA < 0.5) add('warn', `${name} will be very dim: (${src} V − ${vf} V) ÷ ${rTxt} ≈ ${mA.toFixed(2)} mA. Use 220–330 Ω${vf >= 2.8 && src < 4 ? ' — a blue or white LED needs about 3 V, so 3.3 V leaves little headroom' : ''}.`, [part.id, f.r.id], [ref]);
          else if (mA > 16) add(fd.gpio.length ? 'error' : 'warn', `${name}: ${rTxt} lets about ${mA.toFixed(0)} mA through${fd.gpio.length ? ` — more than ${fd.gpio[0]} should supply (aim for 2–10 mA)` : ''}. Use a bigger resistor.`, [part.id, f.r.id], [ref]);
        }
      }
      // buttons: GPIO on one side, GND (or 3V3) on the other
      if (p.role === 'switch') {
        const other = def.pins.find((x) => x.n !== p.n);
        const od = I(`${part.id}.${other.n}`);
        if (p === def.pins[0] && od) {
          if ((d.power.length && od.realGnd) || (d.realGnd && od.power.length)) add('error', `Pressing ${name} would short ${d.power[0]?.name || od.power[0]?.name} to GND.`, [part.id], [ref]);
          else if ((d.gpio.length && od.power.some((x) => x.volts > 3.6)) || (od.gpio.length && d.power.some((x) => x.volts > 3.6))) add('error', `Pressing ${name} puts 5 V on ${d.gpio[0] || od.gpio[0]} — the ${B.short}’s GPIO is 3.3 V only. Wire the other side to GND instead.`, [part.id], [ref]);
          else if ((d.gpio.length && !od.realGnd && !od.power.length && !od.gpio.length) || (od.gpio.length && !d.realGnd && !d.power.length && !d.gpio.length)) add('warn', `${name}: wire the other side to GND (the code uses the internal pull-up).`, [part.id], [ref]);
        }
      }
      // relay contacts carry the load circuit, never the board
      if (p.role === 'contact' && (gpioHere.length || d.power.length)) add('warn', `${name} ${p.n} is a switch contact: it should carry the separate load circuit (12 V supply → lamp), not a board pin.`, [part.id], [ref]);
      // level shifter sides
      if (p.role === 'shift') {
        const side = p.side;
        const hvVolts = volts(`${part.id}.HV`), lvVolts = volts(`${part.id}.LV`);
        if (side === 'hv' && gpioHere.length && hvVolts > 3.6) add('error', `${gpioHere[0]} is on the level shifter’s 5 V side (${p.n}). The ${B.short} goes on LV1/LV2.`, [part.id], [ref]);
        if (lvVolts != null && hvVolts != null && lvVolts > hvVolts) add('warn', 'Level shifter: LV must be the lower voltage (3.3 V) and HV the higher one (5 V).', [part.id], [ref]);
      }
      // ESP32 pin rules
      if (board === 'esp32') for (const g of (p.role === 'in' || p.role === 'pwm' ? [...gpioHere, ...gpioFar] : gpioHere)) {
        const num = +g.slice(4);
        const drives = ['in', 'pwm', 'mosi', 'sck', 'cs', 'scl', 'sda', 'io'].includes(p.role);
        if (drives && ESP_FLAGS.inputOnly.includes(num)) add('error', `${g} is input-only on the ESP32 — it cannot drive ${name} ${p.n}. Pick another pin.`, [part.id], [ref]);
        if (ESP_FLAGS.strapping.includes(num) && num !== 2) add('warn', `${g} is a strapping pin: if ${name} pulls it the wrong way at power-on, the ESP32 may not boot.`, [part.id], [ref]);
        if (ESP_FLAGS.uart0.includes(num)) add('warn', `${g} is the USB serial line (UART0) — using it breaks uploads and the Serial monitor.`, [part.id], [ref]);
      }
      if (board === 'pi5') for (const g of gpioHere) if (g === 'GPIO0' || g === 'GPIO1') add('warn', `${g} is reserved for HAT ID EEPROMs (ID_SD/ID_SC). Prefer another pin.`, [part.id], [ref]);
    }
    // common ground for parts with their own supply
    if (usesGpio && gndPins.length && powered && !['battery', 'psu12'].includes(part.type)) {
      const grounded = gndPins.some((p) => I(`${part.id}.${p.n}`)?.board.some((b) => b.kind === 'gnd'));
      if (!grounded) add('error', `${name} talks to the ${B.short} but its ground is not joined to the board’s GND. Signals need a common ground.`, [part.id]);
    }
    // power budget
    if (part.type === 'ring' && I(`${part.id}.5V`)?.power.some((p) => p.volts < 4)) add('warn', `${name} on 3V3: twelve pixels at full white draw ~700 mA — far more than the 3.3 V regulator spares. Use 5 V and keep brightness low.`, [part.id]);
  }
  // shared pins
  for (const [g, users] of gpioUse) {
    const distinct = [...new Map(users.map((u) => [u.part.id, u])).values()].filter((u) => !['sda', 'scl', 'mosi', 'miso', 'sck'].includes(u.pin.role));
    if (distinct.length > 1) add('warn', `Pin conflict: ${g} is used by ${distinct.map((u) => partName(c, u.part)).join(' and ')}. One pin, one job (except shared buses).`, distinct.map((u) => u.part.id));
  }
  // I2C address clashes
  const i2cTypes = bus.sda.map((p) => p.type);
  for (const t of new Set(i2cTypes)) if (i2cTypes.filter((x) => x === t).length > 1) add('warn', `Two ${PARTS[t].name} on one I2C bus share the same address — change one board’s address jumper.`, bus.sda.filter((p) => p.type === t).map((p) => p.id));
  // M8: I2C lines swapped (SDA on the board's SCL pin and the other way round)
  if (BUS[board]) for (const part of c.parts) {
    const pins = PARTS[part.type]?.pins || [];
    const sda = pins.find((x) => x.role === 'sda'), scl = pins.find((x) => x.role === 'scl');
    if (!sda || !scl) continue;
    const gs = I(`${part.id}.${sda.n}`)?.gpio || [], gc = I(`${part.id}.${scl.n}`)?.gpio || [];
    if (!(gs.some((g) => BUS[board].scl.includes(g)) && gc.some((g) => BUS[board].sda.includes(g)))) continue;
    // the swap error replaces the two per-pin "not the hardware bus" warnings for this part
    for (let k = issues.length - 1; k >= 0; k--) if (issues[k].sev === 'warn' && issues[k].parts.length === 1 && issues[k].parts[0] === part.id && /hardware (SDA|SCL) pin/.test(issues[k].msg)) issues.splice(k, 1);
    add('error', `${partName(c, part)}: SDA and SCL are swapped — SDA goes to ${BUS[board].sda[0]} and SCL to ${BUS[board].scl[0]}.`, [part.id]);
  }
  // M8: total LED current from the GPIO pins
  const totalmA = ledLoad.reduce((a, x) => a + x.mA, 0);
  if (board === 'pi5' && totalmA > 50) add('warn', `${ledLoad.length} LEDs draw about ${totalmA.toFixed(0)} mA from the GPIO pins together — the Pi 5’s GPIO bank is only good for about 50 mA in total. Use bigger resistors or a transistor driver.`, ledLoad.map((x) => x.part.id));
  // servo budget
  const servos = c.parts.filter((p) => p.type === 'servo' && I(`${p.id}.V+`)?.power.length);
  if (servos.length > 2) add('warn', `${servos.length} servos on the board’s 5 V pin can brown it out when they move together. Give them their own 5–6 V supply.`, servos.map((p) => p.id));

  // dedupe
  const seen = new Set();
  const out = issues.filter((x) => { const k = x.sev + x.msg; if (seen.has(k)) return false; seen.add(k); return true; });
  out.sort((a, b) => ({ error: 0, warn: 1, info: 2 }[a.sev] - { error: 0, warn: 1, info: 2 }[b.sev]));
  return { issues: out, conn: connections(c, net, info, viaR) };
}

// For code and simulation: the GPIO each part pin ends up on (directly or through one resistor),
// plus whether the part is powered and grounded.
function connections(c, net, info, viaR) {
  const out = {};
  for (const part of c.parts) {
    const pins = {};
    for (const p of PARTS[part.type].pins) {
      const n = net(`${part.id}.${p.n}`);
      if (!n) continue;
      const d = info.get(n);
      let g = d.gpio[0] || null, via = null;
      if (!g) for (const f of viaR(n)) { const fg = info.get(f.net).gpio[0]; if (fg) { g = fg; via = f.r.id; break; } }
      const port = d.board.find((b) => ['csi', 'pcie', 'fan'].includes(b.kind))?.id || null;
      // what else is on this net (for ADC channels, relays, H-bridge outputs)
      const peers = d.pins.filter((x) => x.part !== part).map((x) => `${x.part.id}.${x.def.n}`);
      pins[p.n] = { gpio: g, via, port, peers, volts: netVolts(d) };
    }
    out[part.id] = pins;
  }
  return out;
}

export const gpioNum = (g) => (g ? +String(g).replace('GPIO', '') : null);
export { PI_PIN_NUMBER };
