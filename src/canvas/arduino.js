// M11 · The Arduino-core runtime ($) for sketches compiled by cpp.js.
import { RunError, Restart, fmt, fmtv } from './runtime.js';

const MODES = { 1: 'INPUT', 3: 'OUTPUT', 5: 'INPUT_PULLUP', 9: 'INPUT_PULLDOWN' };
function lcg(seed) { let s = seed >>> 0 || 1; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
const KEYS = ['123', '456', '789', '*0#'];

export function arduinoProgram(compiled) {
  return { lang: 'cpp', make: (m) => makeRuntime(m, compiled) };
}

function makeRuntime(m, compiled) {
  const hw = m.hw, B = m.board;
  const L = () => $.l;
  const err = (msg) => { throw new RunError(msg, $.l); };
  const pinOk = (p, o) => m.checkPin(p, $.l, o);
  let rnd = lcg(12345);
  let adcBits = 12, pwmBits = 8;
  const ledcCh = {}; // channel -> { freq, bits, pins:Set }
  const ledcPin = {}; // pin -> { freq, bits, ch }
  const toneLike = (pin) => ledcPin[pin];
  const wantOut = (pin, fn) => {
    const st = hw.pin(B, pin);
    if (st.mode !== 3) {
      m.noteOnce(`mode${pin}`, `Line ${$.l}: ${fn}(${pin}, …) but pinMode(${pin}, OUTPUT) was never called — the pin stays an input, so nothing is driven. Add pinMode(${pin}, OUTPUT); in setup().`);
      return false;
    }
    return true;
  };
  const sleep = function* (ms) { if (ms > 0) yield ms; };

  const serial = (name) => {
    let inbuf = '';
    let timeout = 1000;
    const S = {
      began: false,
      begin(baud) { S.began = true; S.baud = baud; },
      end() { S.began = false; },
      print(s) { if (!S.began && name === 'Serial') m.noteOnce('serial', `Line ${$.l}: ${name}.print before ${name}.begin(115200) — on a real board nothing would appear. Add ${name}.begin(115200); in setup().`); m.out(s); return s.length; },
      println(s = '') { return S.print(s + '\r\n'); },
      write(c) { const s = typeof c === 'string' ? c : String.fromCharCode(c & 255); m.out(s); return 1; },
      available() { return inbuf.length; },
      read() { if (!inbuf.length) return -1; const c = inbuf.charCodeAt(0); inbuf = inbuf.slice(1); return c; },
      peek() { return inbuf.length ? inbuf.charCodeAt(0) : -1; },
      flush() {},
      setTimeout(ms) { timeout = ms; },
      *readString() { let waited = 0; while (!inbuf.length && waited < timeout) { yield 10; waited += 10; } const s = inbuf; inbuf = ''; return s; },
      *readStringUntil(ch) { const c = typeof ch === 'number' ? String.fromCharCode(ch) : ch; let waited = 0; while (!inbuf.includes(c) && waited < timeout) { yield 10; waited += 10; } const i = inbuf.indexOf(c); let s; if (i < 0) { s = inbuf; inbuf = ''; } else { s = inbuf.slice(0, i); inbuf = inbuf.slice(i + 1); } return s; },
      *parseInt() { let waited = 0; while (!/[-\d]/.test(inbuf) && waited < timeout) { yield 10; waited += 10; } const mm = /-?\d+/.exec(inbuf); if (!mm) { inbuf = ''; return 0; } inbuf = inbuf.slice(mm.index + mm[0].length); return parseInt(mm[0], 10); },
      *parseFloat() { let waited = 0; while (!/[-\d.]/.test(inbuf) && waited < timeout) { yield 10; waited += 10; } const mm = /-?\d*\.?\d+/.exec(inbuf); if (!mm) { inbuf = ''; return 0; } inbuf = inbuf.slice(mm.index + mm[0].length); return parseFloat(mm[0]); },
      _in(t) { inbuf += t; },
    };
    return S;
  };
  const Serial = serial('Serial');
  const Serial1 = serial('Serial1'), Serial2 = serial('Serial2');

  const $ = {
    l: 0, b: 0, target: 0,
    // ---- integer / array helpers used by the compiler
    imul: Math.imul,
    idiv(a, b) { if (b === 0) err("Guru Meditation Error: Core 1 panic'ed (IntegerDivideByZero) — you divided a whole number by zero."); return Math.trunc(a / b); },
    imod(a, b) { if (b === 0) err("Guru Meditation Error: Core 1 panic'ed (IntegerDivideByZero) — % by zero."); return a % b; },
    ix(a, i) { if (a == null) err('used an array that was never set up'); if (!(i >= 0 && i < a.length)) err(`index ${i} is outside the array (it has ${a.length} items, so valid indexes are 0…${a.length - 1}). On a real board this reads random memory.`); return a[i]; },
    st(a, i, v) { if (a == null) err('used an array that was never set up'); if (!(i >= 0 && i < a.length)) err(`index ${i} is outside the array (it has ${a.length} items, so valid indexes are 0…${a.length - 1}). On a real board this corrupts memory.`); a[i] = v; return v; },
    arr(items, n, fill, line) { n = Math.trunc(n); if (!(n >= 0) || n > 100000) throw new RunError(`array size ${n} is not valid`, line); if (items.length > n) throw new RunError(`too many initializers for an array of ${n}`, line); const a = items.slice(); while (a.length < n) a.push(fill ? fill() : 0); return a; },
    sz(a, el) { return a.length * el; },
    chr(s, i) { return i >= 0 && i < s.length ? s.charCodeAt(i) & 255 : 0; },
    S: (x, tag, arg) => fmtv(x, tag, arg),
    fmtv, fmt,
    strNum(s) { const mm = /^\s*([-+]?\d+)/.exec(String(s)); return mm ? parseInt(mm[1], 10) | 0 : 0; },
    strFloat(s) { const mm = /^\s*([-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?)/.exec(String(s)); return mm ? parseFloat(mm[1]) : 0; },
    cmp(a, b) { return a < b ? -1 : a > b ? 1 : 0; },
    map(x, a, b, c, d) {
      if (a === b) err('map(): the "from" range is empty (fromLow == fromHigh) — that divides by zero.');
      if ([x, a, b, c, d].every(Number.isInteger)) return Math.trunc(((x - a) * (d - c)) / (b - a)) + c;
      return ((x - a) * (d - c)) / (b - a) + c;
    },
    lround: Math.round,
    dtostrf(v, w, p) { return (Number.isFinite(v) ? v.toFixed(Math.max(0, p)) : 'nan').padStart(w); },
    attachInterrupt(pin, fn, mode) { pinOk(pin); m.attach(pin, fn, mode, $.l); },
    detachInterrupt(pin) { m.detach(pin); },
    digitalPinToInterrupt: (p) => p,
    interrupts() {}, noInterrupts() {},
    // ---- pins
    pinMode(pin, mode) {
      pinOk(pin, { output: mode === 3 });
      if (!MODES[mode]) err(`pinMode(${pin}, ${mode}): the mode must be INPUT, OUTPUT, INPUT_PULLUP or INPUT_PULLDOWN.`);
      hw.mode(B, pin, mode);
      if (mode !== 3) hw.release(B, pin), hw.mode(B, pin, mode);
    },
    digitalWrite(pin, v) {
      pinOk(pin, { output: true });
      if (!wantOut(pin, 'digitalWrite')) return;
      hw.write(B, pin, v ? 1 : 0);
    },
    digitalRead(pin) {
      pinOk(pin);
      const st = hw.pin(B, pin);
      if (st.mode === 0 && hw.floating(B, pin)) m.noteOnce(`float${pin}`, `Line ${$.l}: digitalRead(${pin}) on a pin with nothing pulling it — a real input would float and read random values. Use pinMode(${pin}, INPUT_PULLUP).`);
      else if (st.mode !== 3 && hw.floating(B, pin)) m.noteOnce(`float${pin}`, `Line ${$.l}: GPIO${pin} is floating (not connected to anything that sets its level), so readings are random on real hardware. Check the wiring or use INPUT_PULLUP.`);
      return hw.level(B, pin);
    },
    analogRead(pin) { pinOk(pin, { analog: true }); const v = hw.volts(B, pin); return Math.max(0, Math.min((1 << adcBits) - 1, Math.round((v / 3.3) * ((1 << adcBits) - 1)))); },
    analogReadMilliVolts(pin) { pinOk(pin, { analog: true }); return Math.round(hw.volts(B, pin) * 1000); },
    analogReadResolution(bits) { adcBits = Math.max(9, Math.min(12, bits)); },
    analogSetAttenuation() {},
    analogWriteResolution(a, b) { pwmBits = b ?? a; },
    analogWrite(pin, v) { pinOk(pin, { output: true }); const max = (1 << pwmBits) - 1; hw.pwm(B, pin, Math.max(0, Math.min(max, v)) / max, 1000); },
    // LEDC (ESP32 core v2 channels and v3 pins)
    ledcSetup(ch, freq, bits) { ledcCh[ch] = { freq, bits, pins: ledcCh[ch]?.pins || new Set() }; return freq; },
    ledcAttachPin(pin, ch) { pinOk(pin, { output: true }); if (!ledcCh[ch]) err(`ledcAttachPin(${pin}, ${ch}): call ledcSetup(${ch}, freq, bits) first.`); ledcCh[ch].pins.add(pin); ledcPin[pin] = { ch, ...ledcCh[ch] }; hw.mode(B, pin, 3); },
    ledcAttach(pin, freq, bits) { pinOk(pin, { output: true }); ledcPin[pin] = { freq, bits }; hw.mode(B, pin, 3); hw.pwm(B, pin, 0, freq); return 1; },
    ledcAttachChannel(pin, freq, bits, ch) { $.ledcAttach(pin, freq, bits); ledcCh[ch] = { freq, bits, pins: new Set([pin]) }; return 1; },
    ledcDetach(pin) { delete ledcPin[pin]; hw.release(B, pin); return 1; },
    ledcDetachPin(pin) { delete ledcPin[pin]; hw.release(B, pin); },
    ledcWrite(x, duty) {
      const targets = ledcPin[x] && !ledcCh[x] ? [x] : ledcCh[x] ? [...ledcCh[x].pins] : ledcPin[x] ? [x] : null;
      if (!targets) err(`ledcWrite(${x}, …): nothing is attached there — call ledcAttach(pin, freq, bits) first.`);
      for (const p of targets) { const c = ledcPin[p]; const max = (1 << c.bits) - 1; c.duty = duty; hw.pwm(B, p, Math.max(0, Math.min(max, duty)) / max, c.freq); }
    },
    ledcRead(x) { return (ledcPin[x] || {}).duty || 0; },
    ledcWriteTone(x, f) { const targets = ledcCh[x] ? [...ledcCh[x].pins] : [x]; for (const p of targets) { pinOk(p, { output: true }); hw.tone(B, p, f); } return f; },
    ledcChangeFrequency(x, f, bits) { const targets = ledcCh[x] ? [...ledcCh[x].pins] : [x]; for (const p of targets) if (ledcPin[p]) { ledcPin[p].freq = f; ledcPin[p].bits = bits; } return f; },
    tone(pin, f, dur) {
      pinOk(pin, { output: true });
      hw.tone(B, pin, f);
      if (dur > 0) { const end = m.now + dur; m.spawn((function* () { yield end - m.now; if (hw.pin(B, pin).tone === f) hw.tone(B, pin, 0); })(), 'tone'); }
    },
    noTone(pin) { pinOk(pin); hw.tone(B, pin, 0); hw.write(B, pin, 0); },
    *pulseIn(pin, state, timeout = 1000000) {
      pinOk(pin);
      const us = timeout;
      const echo = hw.partsAt(B, 'hcsr04', 'ECHO', pin)[0];
      if (echo) {
        const trig = hw.solve().netOf(`${echo.id}.TRIG`);
        const driven = Object.keys(hw.pins[B] || {}).some((g) => hw.solve().netOf(`${B}:GPIO${g}`) === trig && hw.pins[B][g].mode === 3);
        const cm = hw.inputs[echo.id]?.cm ?? 40;
        if (!driven) { yield Math.min(us, 1000000) / 1000; return 0; }
        if (cm > 400 || cm < 2) { yield 38; return 0; }
        const t = Math.round(cm * 58.3);
        hw.setExtra(echo.id, { ping: (hw.extra[echo.id]?.ping || 0) + 1 });
        yield t / 1000; return state ? t : 0;
      }
      const dht = hw.partsAt(B, 'dht22', 'DATA', pin)[0];
      if (dht) err('pulseIn() on a DHT22 — use the DHT library: DHT dht(pin, DHT22); dht.readTemperature();');
      yield Math.min(us, 3000000) / 1000; return 0;
    },
    *pulseInLong(pin, state, timeout) { return yield* $.pulseIn(pin, state, timeout); },
    touchRead: () => 62, temperatureRead: () => 47.8,
    // ---- time
    *delay(ms) { if (ms < 0) ms = 0; yield* sleep(ms); },
    *delayMicroseconds(us) { yield* sleep(us / 1000); },
    *yield() { yield 0.001; },
    millis: () => Math.floor(m.now) >>> 0,
    micros: () => Math.floor(m.now * 1000) >>> 0,
    // ---- math
    sqrt: Math.sqrt, pow: Math.pow, sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan, atan2: Math.atan2,
    floor: Math.floor, ceil: Math.ceil, round: Math.round, fabs: Math.abs, fmod: (a, b) => a % b, log: Math.log, log10: Math.log10, exp: Math.exp,
    radians: (d) => (d * Math.PI) / 180, degrees: (r) => (r * 180) / Math.PI, isnan: (x) => (Number.isNaN(x) ? 1 : 0), isinf: (x) => (Number.isFinite(x) || Number.isNaN(x) ? 0 : 1),
    random(a, b) { if (b === undefined) { b = a; a = 0; } if (b <= a) return a; return a + Math.floor(rnd() * (b - a)); },
    randomSeed(s) { rnd = lcg(s); },
    esp_random: () => Math.floor(rnd() * 4294967296) >>> 0,
    bitRead: (x, n) => (x >> n) & 1, bitSet: (x, n) => x | (1 << n), bitClear: (x, n) => x & ~(1 << n), bitWrite: (x, n, b) => (b ? x | (1 << n) : x & ~(1 << n)), bit: (n) => (1 << n) >>> 0,
    highByte: (x) => (x >> 8) & 255, lowByte: (x) => x & 255,
    isDigit: (c) => +(c >= 48 && c <= 57), isAlpha: (c) => +((c | 32) >= 97 && (c | 32) <= 122), isAlphaNumeric: (c) => +($.isDigit(c) || $.isAlpha(c)), isSpace: (c) => +(c === 32 || (c >= 9 && c <= 13)),
    isUpperCase: (c) => +(c >= 65 && c <= 90), isLowerCase: (c) => +(c >= 97 && c <= 122), toupper: (c) => (c >= 97 && c <= 122 ? c - 32 : c), tolower: (c) => (c >= 65 && c <= 90 ? c + 32 : c),
    strlen: (s) => String(s).length, strcmp: (a, b) => (a < b ? -1 : a > b ? 1 : 0), atoi: (s) => $.strNum(s), atol: (s) => $.strNum(s), atof: (s) => $.strFloat(s),
    // ---- objects
    Serial, Serial1, Serial2,
    Wire: { begin: () => 1, setClock() {}, beginTransmission(a) { this.addr = a; }, endTransmission() { return 0; }, write: () => 1, requestFrom: () => 0, available: () => 0, read: () => -1 },
    ESP: { restart() { throw new Restart(); }, getFreeHeap: () => 281432, getChipModel: () => (m.kind === 'esp32s3' ? 'ESP32-S3' : 'ESP32-D0WDQ6'), getCpuFreqMHz: () => 240, getChipCores: () => 2 },
    make(cls, args, line) { const f = LIBS[cls]; if (!f) throw new RunError(`'${cls}' is not simulated`, line); return f(ctx, args, line); },
  };
  const ctx = { m, hw, B, $, err, pinOk, sleep, KEYS };
  const P = compiled.factory($);
  function* main() {
    yield* P.init();
    yield* P.setup();
    for (;;) {
      yield* P.loop();
      m.now += 0.01;
      if (--$.b < 0 || m.now >= $.target) yield 0;
    }
  }
  return { $, main, serialIn: (t) => Serial._in(t) };
}

// ---------------------------------------------------------------- libraries
const color565 = (c) => (c ? '#bfe8ff' : '#04070c');
const LIBS = {
  Servo(ctx) {
    const { hw, B, pinOk, m } = ctx;
    let pin = null, lo = 500, hi = 2500, us = 1500;
    const o = {
      attach(p, a, b) { pinOk(p, { output: true }); pin = p; if (a) lo = a; if (b) hi = b; hw.mode(B, p, 3); return 1; },
      detach() { if (pin != null) hw.release(B, pin); pin = null; },
      attached: () => (pin != null ? 1 : 0),
      setPeriodHertz() {},
      write(a) { if (a < 200) { a = Math.max(0, Math.min(180, a)); us = lo + (a / 180) * (hi - lo); } else us = a; o._go(); },
      writeMicroseconds(u) { us = u; o._go(); },
      read: () => Math.round(((us - lo) / (hi - lo)) * 180),
      readMicroseconds: () => Math.round(us),
      _go() { if (pin == null) { m.noteOnce('servo-attach', `Line ${ctx.$.l}: servo.write() before servo.attach(pin) — the servo doesn't move.`); return; } hw.servo(B, pin, us); },
    };
    return o;
  },
  LiquidCrystal_I2C(ctx, [addr, cols = 16, rows = 2]) {
    const { hw, B, m } = ctx;
    const buf = Array.from({ length: rows }, () => ' '.repeat(cols));
    let cx = 0, cy = 0, light = false, on = true;
    const push = () => { const p = hw.i2c(B, 'lcd1602')[0]; if (!p) { m.noteOnce('lcd-miss', `Line ${ctx.$.l}: no LCD 1602 found on this board's I²C pins — wire its SDA and SCL to the board.`); return; } m.setScreen(p.id, { kind: 'lcd', lines: on ? buf.slice() : buf.map(() => ''), light }); };
    const o = {
      init() { push(); }, begin() { push(); }, backlight() { light = true; push(); }, noBacklight() { light = false; push(); },
      clear() { for (let i = 0; i < rows; i++) buf[i] = ' '.repeat(cols); cx = cy = 0; push(); }, home() { cx = cy = 0; },
      setCursor(c, r) { cx = Math.max(0, c); cy = Math.max(0, Math.min(rows - 1, r)); },
      print(s) { for (const ch of String(s)) { if (cx < cols) buf[cy] = buf[cy].slice(0, cx) + ch + buf[cy].slice(cx + 1); cx++; } push(); return String(s).length; },
      println(s) { return o.print(s); },
      write(c) { return o.print(typeof c === 'number' ? String.fromCharCode(c) : c); },
      noDisplay() { on = false; push(); }, display() { on = true; push(); },
      cursor() {}, noCursor() {}, blink() {}, noBlink() {},
      scrollDisplayLeft() { for (let i = 0; i < rows; i++) buf[i] = buf[i].slice(1) + buf[i][0]; push(); }, scrollDisplayRight() { for (let i = 0; i < rows; i++) buf[i] = buf[i].slice(-1) + buf[i].slice(0, -1); push(); },
    };
    return o;
  },
  Adafruit_SSD1306(ctx, [w = 128, h = 64]) {
    const { hw, B, m } = ctx;
    let ops = [], cx = 0, cy = 0, size = 1, color = 1, inv = false, rot = 0;
    const o = {
      begin() { return 1; },
      clearDisplay() { ops = []; cx = cy = 0; },
      display() { const p = hw.i2c(B, 'oled')[0]; if (!p) { m.noteOnce('oled-miss', `Line ${ctx.$.l}: no OLED found on this board's I²C pins — wire its SDA and SCL to the board.`); return; } m.setScreen(p.id, { kind: 'oled', w, h, ops: ops.slice(), inv, text: ops.filter((x) => x[0] === 'text').map((x) => x[5]).join('') }); },
      setTextSize(s) { size = Math.max(1, s | 0); }, setTextColor(c) { color = c; }, setCursor(x, y) { cx = x; cy = y; }, setTextWrap() {}, cp437() {}, setRotation(r) { rot = r; }, dim() {}, startscrollright() {}, stopscroll() {},
      print(s) {
        for (const line of String(s).split(/(\n)/)) {
          if (line === '\n') { cx = 0; cy += 8 * size; continue; }
          if (!line) continue;
          ops.push(['text', cx, cy, size, color, line.replace(/\r/g, '')]); cx += 6 * size * line.length;
        }
        return String(s).length;
      },
      println(s = '') { o.print(s + '\n'); return String(s).length + 1; },
      drawPixel(x, y, c) { ops.push(['px', x, y, c]); },
      drawLine(x0, y0, x1, y1, c) { ops.push(['line', x0, y0, x1, y1, c]); },
      drawFastHLine(x, y, l, c) { ops.push(['line', x, y, x + l - 1, y, c]); }, drawFastVLine(x, y, l, c) { ops.push(['line', x, y, x, y + l - 1, c]); },
      drawRect(x, y, ww, hh, c) { ops.push(['rect', x, y, ww, hh, 0, c]); }, fillRect(x, y, ww, hh, c) { ops.push(['rect', x, y, ww, hh, 1, c]); },
      drawRoundRect(x, y, ww, hh, r, c) { ops.push(['rect', x, y, ww, hh, 0, c]); }, fillRoundRect(x, y, ww, hh, r, c) { ops.push(['rect', x, y, ww, hh, 1, c]); },
      drawCircle(x, y, r, c) { ops.push(['circ', x, y, r, 0, c]); }, fillCircle(x, y, r, c) { ops.push(['circ', x, y, r, 1, c]); },
      drawTriangle(a, b, c2, d, e, f, c) { ops.push(['tri', a, b, c2, d, e, f, 0, c]); }, fillTriangle(a, b, c2, d, e, f, c) { ops.push(['tri', a, b, c2, d, e, f, 1, c]); },
      fillScreen(c) { ops = c ? [['rect', 0, 0, w, h, 1, 1]] : []; },
      invertDisplay(i) { inv = !!i; },
      width: () => (rot & 1 ? h : w), height: () => (rot & 1 ? w : h),
    };
    return o;
  },
  DHT(ctx, [pin, type]) {
    const { hw, B, m, pinOk } = ctx;
    pinOk(pin);
    let last = -3000, cache = null;
    const read = () => {
      const p = hw.partsAt(B, 'dht22', 'DATA', pin)[0];
      if (!p) { m.noteOnce('dht-miss', `Line ${ctx.$.l}: no DHT22 data pin on GPIO${pin} — readings are NaN. Wire the DHT22 DATA pin to GPIO${pin}.`); return null; }
      const s = hw.solve();
      if (!((s.v(`${p.id}.VCC`) ?? 0) >= 3 && s.v(`${p.id}.GND`) === 0)) { m.noteOnce('dht-pow', `Line ${ctx.$.l}: the DHT22 isn't powered — wire VCC to 3V3 and GND to GND.`); return null; }
      if (m.now - last >= 2000 || !cache) { cache = { ...hw.inputs[p.id] }; last = m.now; }
      return cache;
    };
    return {
      begin() {},
      readTemperature(f) { const r = read(); if (!r) return NaN; return f ? r.t * 1.8 + 32 : r.t; },
      readHumidity() { const r = read(); return r ? r.h : NaN; },
      computeHeatIndex(t, h, f = 1) { const T = f ? t : t * 1.8 + 32; const hi = 0.5 * (T + 61 + (T - 68) * 1.2 + h * 0.094); return f ? hi : (hi - 32) / 1.8; },
    };
  },
  Adafruit_BME280(ctx) {
    const { hw, B } = ctx;
    const dev = () => hw.i2c(B, 'bme280')[0];
    const val = (k) => { const p = dev(); return p ? hw.inputs[p.id]?.[k] : NaN; };
    return {
      begin() { return dev() ? 1 : 0; },
      readTemperature: () => val('t'), readHumidity: () => val('h'), readPressure: () => val('p') * 100,
      readAltitude(sea = 1013.25) { return 44330 * (1 - Math.pow(val('p') / sea, 0.1903)); },
    };
  },
  Adafruit_NeoPixel(ctx, [n = 12, pin]) {
    const { hw, B, m, pinOk } = ctx;
    if (pin != null) pinOk(pin, { output: true });
    const px = Array.from({ length: n }, () => 0);
    let br = 255;
    const unpack = (c) => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
    const o = {
      begin() { hw.mode(B, pin, 3); }, numPixels: () => n,
      setPixelColor(i, r, g, b) { if (i < 0 || i >= n) return; px[i] = g === undefined ? r >>> 0 : (((r & 255) << 16) | ((g & 255) << 8) | (b & 255)) >>> 0; },
      getPixelColor: (i) => px[i] || 0,
      fill(c = 0, first = 0, count = 0) { const end = count ? Math.min(n, first + count) : n; for (let i = first; i < end; i++) px[i] = c >>> 0; },
      clear() { px.fill(0); },
      setBrightness(b) { br = b & 255; }, getBrightness: () => br,
      Color: (r, g, b) => ((((r & 255) << 16) | ((g & 255) << 8) | (b & 255)) >>> 0),
      ColorHSV(h = 0, s = 255, v = 255) { h = ((h % 65536) + 65536) % 65536 / 65536 * 6; const i = Math.floor(h), f = h - i; const V = v / 255, S = s / 255; const p = V * (1 - S), q = V * (1 - S * f), t = V * (1 - S * (1 - f)); const [r, g, b] = [[V, t, p], [q, V, p], [p, V, t], [p, q, V], [t, p, V], [V, p, q]][i % 6]; return o.Color(Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)); },
      gamma32: (c) => c,
      show() {
        const p = hw.partsAt(B, 'ring', 'DIN', pin)[0];
        if (!p) { m.noteOnce('ring-miss', `Line ${ctx.$.l}: no NeoPixel ring DIN on GPIO${pin}.`); return; }
        const k = (br || 256) / 256;
        hw.setExtra(p.id, { pixels: px.map((c) => (c ? unpack(c).map((x) => Math.round(x * k)) : null)) });
      },
    };
    return o;
  },
  LedControl(ctx, [din, clk, cs, n = 1]) {
    const { hw, B, m } = ctx;
    const rows = Array.from({ length: 8 }, () => 0);
    let on = false;
    const push = () => { const p = hw.partsAt(B, 'matrix', 'DIN', din)[0]; if (!p) { m.noteOnce('mx-miss', `Line ${ctx.$.l}: no LED matrix DIN on GPIO${din}.`); return; } hw.setExtra(p.id, { rows: on ? rows.slice() : [] }); };
    return {
      shutdown(a, s) { on = !s; push(); }, setIntensity() {}, clearDisplay() { rows.fill(0); push(); },
      setRow(a, r, v) { if (r >= 0 && r < 8) rows[r] = v & 255; push(); },
      setColumn(a, c, v) { for (let r = 0; r < 8; r++) { const bit = (v >> (7 - r)) & 1; rows[r] = bit ? rows[r] | (128 >> c) : rows[r] & ~(128 >> c); } push(); },
      setLed(a, r, c, s) { if (r < 0 || r > 7 || c < 0 || c > 7) return; rows[r] = s ? rows[r] | (128 >> c) : rows[r] & ~(128 >> c); push(); },
      getDeviceCount: () => n,
    };
  },
  Stepper(ctx, [steps, p1, p2, p3, p4]) {
    const { hw, B, pinOk } = ctx;
    const pins = [p1, p2, p3, p4];
    pins.forEach((p) => { pinOk(p, { output: true }); hw.mode(B, p, 3); });
    let rpm = 10, idx = 0;
    const SEQ = [[1, 0, 1, 0], [0, 1, 1, 0], [0, 1, 0, 1], [1, 0, 0, 1]];
    return {
      setSpeed(r) { rpm = Math.max(0.1, r); },
      *step(nSteps) {
        const dir = nSteps > 0 ? 1 : -1;
        const dt = 60000 / (steps * rpm);
        for (let i = 0; i < Math.abs(nSteps); i++) {
          idx = (idx + dir + 4) % 4;
          SEQ[idx].forEach((v, k) => hw.write(B, pins[k], v));
          yield dt;
        }
      },
    };
  },
  Keypad(ctx, [keymap, rowPins, colPins, nr = 4, nc = 3]) {
    const { hw, B, m } = ctx;
    let held = '', state = 0;
    const scan = () => {
      const p = hw.partsAt(B, 'keypad', 'R1', rowPins?.[0])[0] || hw.model.parts.find((x) => x.type === 'keypad');
      if (!p) return '';
      const k = hw.inputs[p.id]?.key || '';
      if (!k) return '';
      const r = KEYS.findIndex((row) => row.includes(k)); const c = KEYS[r].indexOf(k);
      const v = keymap?.[r * nc + c] ?? keymap?.[r]?.[c];
      if (Array.isArray(keymap?.[0])) return String.fromCharCode(keymap[r][c]);
      return typeof v === 'number' ? String.fromCharCode(v) : k;
    };
    const o = {
      getKey() { const k = scan(); if (k && k !== held) { held = k; state = 1; return k.charCodeAt(0); } if (!k) { if (held) state = 2; held = ''; } return 0; },
      *waitForKey() { for (;;) { const k = o.getKey(); if (k) return k; yield 20; } },
      getState: () => state, setDebounceTime() {}, setHoldTime() {},
    };
    void m;
    return o;
  },
};
