// Figures out what each part does in the program: shared by the code generator and the simulation
// so the browser run behaves exactly like the generated code says it will.
import { gpioNum } from './circuit.js';

const PY_RESERVED = new Set('and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield None True False print sleep tick board time spi i2c bus device canvas'.split(' '));
const CPP_RESERVED = new Set('auto bool break case char class const continue default delete do double else enum extern false float for goto if int long new private public return short signed sizeof static struct switch this true try typedef union unsigned void volatile while delay setup loop millis tick min max abs round display lcd pixels'.split(' '));

export function roles(c, conn) {
  const live = c.parts;
  const of = (t) => live.filter((p) => p.type === t);
  const pin = (p, n) => conn[p.id]?.[n] || null;
  const g = (p, n) => gpioNum(pin(p, n)?.gpio);
  const direct = (p, n) => { const x = pin(p, n); return x && !x.via ? gpioNum(x.gpio) : null; };
  // MCP3008 channel a pin's net is on
  const chan = (p, n) => {
    const x = pin(p, n); if (!x) return null;
    for (const peer of x.peers) { const [id, pn] = peer.split('.'); const q = live.find((y) => y.id === id); if (q?.type === 'mcp3008' && /^CH\d$/.test(pn)) return +pn.slice(2); }
    return null;
  };
  // An analog source: where its voltage is read. {pin} on ESP32, {ch} through an MCP3008 on Pi 5.
  const analog = (p) => {
    const pins = { pot: ['W'], ldr: ['2', '1'], soil: ['AOUT'], mq2: ['AO'] }[p.type] || [];
    for (const n of pins) {
      const ch = chan(p, n); if (ch != null) return { ch };
      const d = direct(p, n); if (d != null) return { pin: d };
    }
    return {};
  };
  const vars = new Map();
  const name = (p, lang) => {
    const key = lang + p.id;
    if (vars.has(key)) return vars.get(key);
    let v = p.id.replace(/[^A-Za-z0-9_]/g, '_');
    if (/^\d/.test(v)) v = `p_${v}`;
    if ((lang === 'py' ? PY_RESERVED : CPP_RESERVED).has(v)) v += '_';
    vars.set(key, v);
    return v;
  };
  const leds = of('led');
  const keypad = of('keypad')[0] || null;
  const okLed = keypad ? leds.find((l) => l.opts?.color === 'green') || leds[0] || null : null;
  const badLed = keypad ? leds.find((l) => l !== okLed && l.opts?.color === 'red') || leds.find((l) => l !== okLed) || null : null;
  // motors hang off an H-bridge output pair
  const drv = of('drv8833')[0] || null;
  const motorsOn = (d) => {
    if (!d) return [];
    const out = [];
    for (const [a, b] of [['OUT1', 'OUT2'], ['OUT3', 'OUT4']]) {
      const peers = (conn[d.id]?.[a]?.peers || []).map((x) => x.split('.')[0]);
      const m = live.find((p) => p.type === 'motor' && peers.includes(p.id));
      out.push(m ? { motor: m, fwd: g(d, a === 'OUT1' ? 'IN1' : 'IN3'), back: g(d, a === 'OUT1' ? 'IN2' : 'IN4') } : null);
    }
    return out.filter(Boolean);
  };
  const relay = of('relay')[0] || null;
  const lampOnRelay = relay ? of('lamp').find((l) => ['L1', 'L2'].some((n) => (conn[l.id]?.[n]?.peers || []).some((x) => x === `${relay.id}.NO` || x === `${relay.id}.COM`))) || null : null;
  const R = {
    board: c.board, leds, keypad, okLed, badLed, drv, motors: motorsOn(drv), relay, lampOnRelay,
    buttons: of('button'), buzzers: of('buzzer'), rgbs: of('rgbled'), pirs: of('pir'), sonars: of('hcsr04'),
    dhts: of('dht22'), bmes: of('bme280'), pots: of('pot'), ldrs: of('ldr'), soils: of('soil'), mq2s: of('mq2'),
    oleds: of('oled'), lcds: of('lcd1602'), epapers: of('epaper'), matrices: of('matrix'), rings: of('ring'),
    servos: of('servo'), steppers: of('stepper'), lights: of('trafficlight'), cams: of('cam3'), ais: of('aikit'),
    coolers: of('cooler'), adcs: of('mcp3008'),
    g, direct, chan, analog, name,
  };
  // the program's single "trigger": buttons and motion sensors (keypad has its own logic)
  R.hasTrigger = R.buttons.length > 0 || R.pirs.length > 0;
  R.trafficButton = R.lights.length > 0 && R.buttons.length > 0;
  R.ringButton = R.rings.length > 0 && R.buttons.length > 0;
  // what the LEDs follow, in order of priority
  R.ledRule = keypad ? 'lock' : R.ais.length ? 'detect' : (R.hasTrigger && !R.trafficButton && !R.ringButton) ? 'trigger' : R.ldrs.length ? 'dark' : R.soils.length ? 'dry' : R.mq2s.length ? 'gas' : R.sonars.length ? 'near' : 'blink';
  R.buzzRule = keypad ? 'lock' : R.trafficButton ? 'walk' : R.pirs.length ? 'motion' : R.buttons.length && !R.ringButton ? 'trigger' : R.mq2s.length ? 'gas' : R.sonars.length ? 'near' : 'chirp';
  R.servoRule = keypad ? 'lock' : R.pots.length ? 'pot' : 'sweep';
  R.relayRule = R.hasTrigger && !R.trafficButton ? 'trigger' : R.ldrs.length ? 'dark' : 'toggle';
  R.readings = [];
  for (const p of R.sonars) R.readings.push({ p, key: 'distance', label: 'Distance', unit: 'cm' });
  for (const p of R.dhts) R.readings.push({ p, key: 'temp', label: 'Temp', unit: '°C' }, { p, key: 'hum', label: 'Humidity', unit: '%' });
  for (const p of R.bmes) R.readings.push({ p, key: 'temp', label: 'Temp', unit: '°C' }, { p, key: 'hum', label: 'Humidity', unit: '%' }, { p, key: 'pressure', label: 'Pressure', unit: 'hPa' });
  for (const p of R.pots) R.readings.push({ p, key: 'value', label: 'Knob', unit: '%' });
  for (const p of R.ldrs) R.readings.push({ p, key: 'light', label: 'Light', unit: '%' });
  for (const p of R.soils) R.readings.push({ p, key: 'moisture', label: 'Soil', unit: '%' });
  for (const p of R.mq2s) R.readings.push({ p, key: 'gas', label: 'Gas', unit: '%' });
  return R;
}
