// M11 · Canvas mode: an Arduino C++ subset for the simulated ESP32 / ESP32-S3.
// The sketch is parsed, type-checked (enough to get int vs float maths and
// printing right) and translated to JavaScript generator functions, so delay()
// is a `yield` and an endless loop can be paused every few thousand steps
// without freezing the page. Anything outside the subset is a compile error
// with the line number, like the Arduino IDE would print.
//
// Supported: #include / #define (object- and function-like) / #ifdef, globals,
// functions (any order, prototypes optional), int/long/byte/bool/float/double/
// char/String/uintN_t/size_t, const/static/volatile, enums, 1-D and 2-D arrays
// with initialisers, pointers to arrays, if/else, for, while, do-while,
// switch, break/continue/return, every C operator, casts, sizeof, ternary.
// The runtime ($) supplies the Arduino core and the libraries (see API below).

export class CompileError extends Error {
  constructor(line, msg) { super(msg); this.line = line; this.kind = 'compile'; }
}

// ------------------------------------------------------------------ libraries
// #include name -> 1 (simulated), or a reason string (not simulated)
export const INCLUDES = {
  'Arduino.h': 1, 'Wire.h': 1, 'SPI.h': 1, 'math.h': 1, 'stdint.h': 1, 'stdlib.h': 1, 'string.h': 1, 'stdio.h': 1, 'Adafruit_Sensor.h': 1, 'Adafruit_GFX.h': 1,
  'Servo.h': 1, 'ESP32Servo.h': 1, 'LiquidCrystal_I2C.h': 1, 'Adafruit_SSD1306.h': 1, 'DHT.h': 1, 'Adafruit_BME280.h': 1,
  'Adafruit_NeoPixel.h': 1, 'LedControl.h': 1, 'Stepper.h': 1, 'Keypad.h': 1,
  'WiFi.h': 'Wi-Fi is not simulated in the canvas (there is no network). Remove it, or try the ESP32 track’s Wi-Fi lesson.',
  'WebServer.h': 'web servers need Wi-Fi, which is not simulated in the canvas.', 'HTTPClient.h': 'HTTP needs Wi-Fi, which is not simulated in the canvas.',
  'BluetoothSerial.h': 'Bluetooth is not simulated in the canvas.', 'BLEDevice.h': 'Bluetooth LE is not simulated in the canvas.', 'esp_now.h': 'ESP-NOW is not simulated in the canvas.',
  'GxEPD2_BW.h': 'the e-paper library (GxEPD2) is not simulated in the canvas yet — use the OLED or LCD.', 'esp_camera.h': 'the camera is not simulated in the canvas — try the TinyML track.',
  'TensorFlowLite_ESP32.h': 'TensorFlow Lite Micro is not simulated in the canvas — use the Train panel in the sandbox.',
};
const T = (b, x = {}) => ({ b, ...x });
const INT = T('int', { bits: 32 }), UINT = T('int', { bits: 32, uns: true }), FLOAT = T('float'), BOOL = T('bool'), STR = T('str'), VOID = T('void'), CHAR = T('int', { bits: 8, ch: true }), BYTE = T('int', { bits: 8, uns: true }), ANY = T('any');
const OBJ = (cls) => T('obj', { cls });
const M = (ret, extra = {}) => ({ ret, ...extra });
const GFX = {
  begin: M(BOOL), clearDisplay: M(VOID), display: M(VOID), setTextSize: M(VOID), setTextColor: M(VOID), setCursor: M(VOID), print: M(INT, { print: 1 }), println: M(INT, { print: 1 }),
  drawPixel: M(VOID), drawLine: M(VOID), drawRect: M(VOID), fillRect: M(VOID), drawCircle: M(VOID), fillCircle: M(VOID), drawRoundRect: M(VOID), fillRoundRect: M(VOID), drawTriangle: M(VOID), fillTriangle: M(VOID),
  fillScreen: M(VOID), invertDisplay: M(VOID), width: M(INT), height: M(INT), setRotation: M(VOID), dim: M(VOID), drawFastHLine: M(VOID), drawFastVLine: M(VOID), setTextWrap: M(VOID), cp437: M(VOID), startscrollright: M(VOID), stopscroll: M(VOID),
};
export const CLASSES = {
  Servo: { attach: M(INT), detach: M(VOID), write: M(VOID), writeMicroseconds: M(VOID), read: M(INT), readMicroseconds: M(INT), attached: M(BOOL), setPeriodHertz: M(VOID) },
  LiquidCrystal_I2C: { init: M(VOID), begin: M(VOID), backlight: M(VOID), noBacklight: M(VOID), clear: M(VOID), home: M(VOID), setCursor: M(VOID), print: M(INT, { print: 1 }), println: M(INT, { print: 1 }), write: M(INT), noDisplay: M(VOID), display: M(VOID), cursor: M(VOID), noCursor: M(VOID), blink: M(VOID), noBlink: M(VOID), scrollDisplayLeft: M(VOID), scrollDisplayRight: M(VOID) },
  Adafruit_SSD1306: GFX,
  DHT: { begin: M(VOID), readTemperature: M(FLOAT), readHumidity: M(FLOAT), computeHeatIndex: M(FLOAT) },
  Adafruit_BME280: { begin: M(BOOL), readTemperature: M(FLOAT), readHumidity: M(FLOAT), readPressure: M(FLOAT), readAltitude: M(FLOAT) },
  Adafruit_NeoPixel: { begin: M(VOID), show: M(VOID), clear: M(VOID), setPixelColor: M(VOID), getPixelColor: M(UINT), setBrightness: M(VOID), getBrightness: M(INT), numPixels: M(INT), fill: M(VOID), Color: M(UINT), ColorHSV: M(UINT), gamma32: M(UINT) },
  LedControl: { shutdown: M(VOID), setIntensity: M(VOID), clearDisplay: M(VOID), setRow: M(VOID), setColumn: M(VOID), setLed: M(VOID), getDeviceCount: M(INT) },
  Stepper: { setSpeed: M(VOID), step: M(VOID, { block: 1 }) },
  Keypad: { getKey: M(T('int', { bits: 8, ch: true })), waitForKey: M(T('int', { bits: 8, ch: true }), { block: 1 }), getState: M(INT), setDebounceTime: M(VOID), setHoldTime: M(VOID) },
  HardwareSerial: {
    begin: M(VOID), end: M(VOID), print: M(INT, { print: 1 }), println: M(INT, { print: 1 }), printf: M(INT, { printf: 1 }), write: M(INT), available: M(INT), read: M(INT), peek: M(INT), flush: M(VOID),
    readString: M(STR, { block: 1 }), readStringUntil: M(STR, { block: 1 }), parseInt: M(INT, { block: 1 }), parseFloat: M(FLOAT, { block: 1 }), setTimeout: M(VOID),
  },
  TwoWire: { begin: M(BOOL), setClock: M(VOID), beginTransmission: M(VOID), endTransmission: M(INT), write: M(INT), requestFrom: M(INT), available: M(INT), read: M(INT) },
  EspClass: { restart: M(VOID), getFreeHeap: M(UINT), getChipModel: M(STR), getCpuFreqMHz: M(INT), getChipCores: M(INT) },
};
const GLOBAL_OBJECTS = { Serial: 'HardwareSerial', Serial1: 'HardwareSerial', Serial2: 'HardwareSerial', Wire: 'TwoWire', ESP: 'EspClass' };
const UNSUPPORTED_GLOBALS = { WiFi: 'Wi-Fi is not simulated in the canvas.', SerialBT: 'Bluetooth is not simulated in the canvas.', SPIFFS: 'files (SPIFFS) are not simulated in the canvas.', Preferences: 'Preferences (flash storage) are not simulated in the canvas.' };
const F = (ret, min, max = min, block = 0) => ({ ret, min, max, block });
export const FUNCS = {
  pinMode: F(VOID, 2), digitalWrite: F(VOID, 2), digitalRead: F(INT, 1), analogRead: F(INT, 1), analogReadMilliVolts: F(INT, 1), analogWrite: F(VOID, 2), analogReadResolution: F(VOID, 1), analogWriteResolution: F(VOID, 1, 2), analogSetAttenuation: F(VOID, 1),
  delay: F(VOID, 1, 1, 1), delayMicroseconds: F(VOID, 1, 1, 1), millis: F(UINT, 0), micros: F(UINT, 0), yield: F(VOID, 0, 0, 1),
  tone: F(VOID, 2, 3), noTone: F(VOID, 1), pulseIn: F(UINT, 2, 3, 1), pulseInLong: F(UINT, 2, 3, 1),
  ledcSetup: F(INT, 3), ledcAttachPin: F(VOID, 2), ledcAttach: F(BOOL, 3), ledcAttachChannel: F(BOOL, 4), ledcWrite: F(VOID, 2), ledcWriteTone: F(INT, 2), ledcDetach: F(BOOL, 1), ledcDetachPin: F(VOID, 1), ledcRead: F(INT, 1), ledcChangeFrequency: F(INT, 3),
  attachInterrupt: F(VOID, 3), detachInterrupt: F(VOID, 1), digitalPinToInterrupt: F(INT, 1), interrupts: F(VOID, 0), noInterrupts: F(VOID, 0), touchRead: F(INT, 1), temperatureRead: F(FLOAT, 0),
  map: F(INT, 5), constrain: F(ANY, 3), min: F(ANY, 2), max: F(ANY, 2), abs: F(ANY, 1), sq: F(ANY, 1), sqrt: F(FLOAT, 1), pow: F(FLOAT, 2), sin: F(FLOAT, 1), cos: F(FLOAT, 1), tan: F(FLOAT, 1), asin: F(FLOAT, 1), acos: F(FLOAT, 1), atan: F(FLOAT, 1), atan2: F(FLOAT, 2),
  floor: F(FLOAT, 1), ceil: F(FLOAT, 1), round: F(INT, 1), fabs: F(FLOAT, 1), fmod: F(FLOAT, 2), log: F(FLOAT, 1), log10: F(FLOAT, 1), exp: F(FLOAT, 1), radians: F(FLOAT, 1), degrees: F(FLOAT, 1), isnan: F(BOOL, 1), isinf: F(BOOL, 1),
  random: F(INT, 1, 2), randomSeed: F(VOID, 1), esp_random: F(UINT, 0),
  bitRead: F(INT, 2), bitSet: F(INT, 2), bitClear: F(INT, 2), bitWrite: F(INT, 3), bit: F(UINT, 1), highByte: F(BYTE, 1), lowByte: F(BYTE, 1),
  isDigit: F(BOOL, 1), isAlpha: F(BOOL, 1), isAlphaNumeric: F(BOOL, 1), isSpace: F(BOOL, 1), isUpperCase: F(BOOL, 1), isLowerCase: F(BOOL, 1), toupper: F(CHAR, 1), tolower: F(CHAR, 1),
  strlen: F(INT, 1), strcmp: F(INT, 2), atoi: F(INT, 1), atol: F(INT, 1), atof: F(FLOAT, 1), makeKeymap: F(ANY, 1), F: F(STR, 1),
  sprintf: F(INT, 2, 99), snprintf: F(INT, 3, 99), dtostrf: F(STR, 4), strcpy: F(STR, 2), strcat: F(STR, 2),
};
export const CONSTS = {
  HIGH: 1, LOW: 0, INPUT: 1, OUTPUT: 3, INPUT_PULLUP: 5, INPUT_PULLDOWN: 9, RISING: 1, FALLING: 2, CHANGE: 3, ONLOW: 4, ONHIGH: 5,
  LED_BUILTIN: 2, true: 1, false: 0, NULL: 0, nullptr: 0, DEC: 10, HEX: 16, OCT: 8, BIN: 2,
  A0: 36, A3: 39, A4: 32, A5: 33, A6: 34, A7: 35, A10: 4, A11: 0, A12: 2, A13: 15, A14: 13, A15: 12, A16: 14, A17: 27, A18: 25, A19: 26,
  DHT11: 11, DHT22: 22, DHT21: 21, AM2301: 21, SSD1306_SWITCHCAPVCC: 2, SSD1306_EXTERNALVCC: 1, SSD1306_WHITE: 1, SSD1306_BLACK: 0, SSD1306_INVERSE: 2, WHITE: 1, BLACK: 0, INVERSE: 2,
  NEO_GRB: 82, NEO_RGB: 6, NEO_GRBW: 210, NEO_KHZ800: 0, NEO_KHZ400: 256, SERIAL_8N1: 0x800001c, ADC_11db: 3, ADC_0db: 0, ADC_6db: 2, ADC_2_5db: 1,
  NO_KEY: 0, PRESSED: 1, RELEASED: 2, HOLD: 3, PI: Math.PI, HALF_PI: Math.PI / 2, TWO_PI: Math.PI * 2, DEG_TO_RAD: Math.PI / 180, RAD_TO_DEG: 180 / Math.PI, EULER: Math.E,
  INT_MAX: 2147483647, INT_MIN: -2147483648, UINT32_MAX: 4294967295, LONG_MAX: 2147483647,
};
const FLOAT_CONSTS = new Set(['PI', 'HALF_PI', 'TWO_PI', 'DEG_TO_RAD', 'RAD_TO_DEG', 'EULER']);

// ------------------------------------------------------------------ preprocessor + lexer
const OPS = ['<<=', '>>=', '...', '->', '++', '--', '<<', '>>', '<=', '>=', '==', '!=', '&&', '||', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '::',
  '+', '-', '*', '/', '%', '<', '>', '=', '!', '~', '&', '|', '^', '?', ':', ';', ',', '.', '(', ')', '[', ']', '{', '}'];

export function lex(src) {
  const toks = [];
  const defines = new Map(); // name -> { params, body: tokens, at }
  const includes = [];
  const cond = [];
  const active = () => cond.every((c) => c.on);
  let i = 0, line = 1, atLineStart = true;
  const n = src.length;
  const err = (msg, l = line) => { throw new CompileError(l, msg); };
  const pushTok = (t) => { if (active()) toks.push(t); };
  while (i < n) {
    const ch = src[i];
    if (ch === '\n') { line++; i++; atLineStart = true; continue; }
    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\f' || ch === '\v') { i++; continue; }
    if (ch === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (ch === '/' && src[i + 1] === '*') {
      const s = line; i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') line++; i++; }
      if (i >= n) err('unterminated comment', s);
      i += 2; continue;
    }
    if (ch === '#' && atLineStart) {
      const l0 = line;
      let txt = '';
      i++;
      while (i < n && src[i] !== '\n') {
        if (src[i] === '\\' && src[i + 1] === '\n') { i += 2; line++; continue; }
        if (src[i] === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; break; }
        if (src[i] === '/' && src[i + 1] === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') line++; i++; } i += 2; continue; }
        txt += src[i++];
      }
      directive(txt.trim(), l0);
      continue;
    }
    atLineStart = false;
    if (!active()) {
      if (ch === '"' || ch === "'") { i++; while (i < n && src[i] !== ch && src[i] !== '\n') { if (src[i] === '\\') i++; i++; } i++; } else i++;
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src[i + 1]))) {
      const m = /^(0[xX][0-9a-fA-F']+|0[bB][01']+|(?:\d[\d']*\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)([uUlLfF]*)/.exec(src.slice(i, i + 64));
      const raw = m[1].replace(/'/g, '');
      let v, fl = false;
      if (/^0[xX]/.test(raw)) v = parseInt(raw.slice(2), 16);
      else if (/^0[bB]/.test(raw)) v = parseInt(raw.slice(2), 2);
      else if (/[.eE]/.test(raw) || /[fF]/.test(m[2])) { v = parseFloat(raw); fl = true; }
      else if (/^0\d+$/.test(raw)) v = parseInt(raw, 8);
      else v = parseInt(raw, 10);
      pushTok({ t: 'num', v, fl, uns: /u/i.test(m[2]), line });
      i += m[0].length; continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i + 1; while (j < n && /[A-Za-z0-9_]/.test(src[j])) j++;
      const w = src.slice(i, j);
      if (/^B[01]{1,8}$/.test(w)) pushTok({ t: 'num', v: parseInt(w.slice(1), 2), fl: false, uns: false, line });
      else pushTok({ t: 'id', v: w, line });
      i = j; continue;
    }
    if (ch === '"' || ch === "'") {
      let j = i + 1, s = '';
      while (j < n && src[j] !== ch) {
        if (src[j] === '\n') err(`missing terminating ${ch} character`);
        if (src[j] === '\\') {
          const e = src[j + 1]; j += 2;
          if (e === 'n') s += '\n'; else if (e === 't') s += '\t'; else if (e === 'r') s += '\r'; else if (e === '0') s += '\0';
          else if (e === 'x') { const h = /^[0-9a-fA-F]{1,2}/.exec(src.slice(j))?.[0] || '0'; s += String.fromCharCode(parseInt(h, 16)); j += h.length; }
          else s += e;
          continue;
        }
        s += src[j++];
      }
      if (j >= n) err(`missing terminating ${ch} character`);
      if (ch === '"') pushTok({ t: 'str', v: s, line });
      else { if (!s.length) err('empty character constant'); pushTok({ t: 'num', v: s.charCodeAt(0), ch: true, line }); }
      i = j + 1; continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (!op) err(`stray '${ch}' in program`);
    pushTok({ t: 'op', v: op, line }); i += op.length;
  }
  if (cond.length) err('unterminated #if');
  toks.push({ t: 'eof', v: '', line });

  function directive(d, l) {
    const m = /^(\w+)\s*([\s\S]*)$/.exec(d);
    if (!m) return;
    const [, name, rest] = m;
    if (name === 'ifdef' || name === 'ifndef') { const on = defines.has(rest.trim()) === (name === 'ifdef'); cond.push({ on, done: on }); return; }
    if (name === 'if') { const on = evalIf(rest); cond.push({ on, done: on }); return; }
    if (name === 'elif') { const c = cond[cond.length - 1]; if (!c) err('#elif without #if', l); const on = !c.done && evalIf(rest); c.on = on; c.done ||= on; return; }
    if (name === 'else') { const c = cond[cond.length - 1]; if (!c) err('#else without #if', l); c.on = !c.done; c.done = true; return; }
    if (name === 'endif') { if (!cond.pop()) err('#endif without #if', l); return; }
    if (!active()) return;
    if (name === 'include') {
      const inc = /^[<"]([^>"]+)[>"]/.exec(rest);
      if (!inc) err('#include expects "FILENAME" or <FILENAME>', l);
      const f = inc[1].split('/').pop();
      const k = INCLUDES[f];
      if (!k) err(`${f}: No such file or directory — this library is not simulated in the canvas. Simulated libraries: ${Object.keys(INCLUDES).filter((x) => INCLUDES[x] === 1 && !/^(Arduino|math|std|string|Adafruit_Sensor|Adafruit_GFX)/.test(x)).join(', ')}.`, l);
      if (k !== 1) err(`${f}: ${k}`, l);
      includes.push(f);
      return;
    }
    if (name === 'define') {
      const dm = /^([A-Za-z_]\w*)(\(([^)]*)\))?\s*([\s\S]*)$/.exec(rest);
      if (!dm) err('macro names must be identifiers', l);
      const params = dm[2] ? dm[3].split(',').map((s) => s.trim()).filter(Boolean) : null;
      const body = dm[4] ? lex(dm[4]).toks.slice(0, -1).map((t) => ({ ...t, line: l })) : [];
      defines.set(dm[1], { params, body, at: toks.length });
      return;
    }
    if (name === 'undef') { defines.delete(rest.trim()); return; }
    if (name === 'pragma' || name === 'line' || name === 'warning') return;
    if (name === 'error') err(`#error ${rest}`, l);
    err(`invalid preprocessing directive #${name}`, l);
  }
  function evalIf(e) {
    e = e.replace(/defined\s*\(?\s*(\w+)\s*\)?/g, (_, x) => (defines.has(x) ? '1' : '0')).trim();
    if (/^\d+$/.test(e)) return +e !== 0;
    if (/^\w+$/.test(e)) { const d = defines.get(e); return !!(d && d.body[0] && d.body[0].v); }
    return true;
  }
  return { toks: expand(toks, defines), includes, defines };
}

function expand(toks, defines, depth = 0) {
  if (!defines.size || depth > 20) return toks;
  const out = [];
  let changed = false;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    const d = t.t === 'id' && defines.get(t.v);
    if (!d || (d.at != null && i < d.at)) { out.push(t); continue; }
    if (d.params) {
      if (toks[i + 1]?.v !== '(') { out.push(t); continue; }
      const args = [[]]; let j = i + 2, dep = 0;
      for (; j < toks.length; j++) {
        const x = toks[j];
        if (x.t === 'op' && (x.v === '(' || x.v === '[' || x.v === '{')) dep++;
        if (x.t === 'op' && (x.v === ')' || x.v === ']' || x.v === '}')) { if (dep === 0) break; dep--; }
        if (x.t === 'op' && x.v === ',' && dep === 0) { args.push([]); continue; }
        args[args.length - 1].push(x);
      }
      const wrap = !d.body.some((b) => b.v === ';' || b.v === '{') && !['do', 'if', 'for', 'while'].includes(d.body[0]?.v);
      if (wrap) out.push({ t: 'op', v: '(', line: t.line });
      for (const b of d.body) {
        const k = b.t === 'id' ? d.params.indexOf(b.v) : -1;
        if (k >= 0) out.push({ t: 'op', v: '(', line: t.line }, ...(args[k] || []).map((a) => ({ ...a, line: t.line })), { t: 'op', v: ')', line: t.line });
        else out.push({ ...b, line: t.line });
      }
      if (wrap) out.push({ t: 'op', v: ')', line: t.line });
      i = j; changed = true;
    } else { out.push(...d.body.map((b) => ({ ...b, line: t.line }))); changed = true; }
  }
  if (!changed) return out;
  const d2 = new Map([...defines].map(([k, v]) => [k, { ...v, at: null }]));
  return expand(out, d2, depth + 1);
}

// ------------------------------------------------------------------ parser
const BASE_TYPES = new Set(['void', 'int', 'long', 'short', 'char', 'float', 'double', 'bool', 'boolean', 'byte', 'word', 'unsigned', 'signed', 'String', 'size_t', 'uint8_t', 'int8_t', 'uint16_t', 'int16_t', 'uint32_t', 'int32_t', 'uint64_t', 'int64_t', 'auto']);
const QUALS = new Set(['const', 'static', 'volatile', 'inline', 'IRAM_ATTR', 'constexpr', 'extern', 'register', 'PROGMEM', 'unsigned', 'signed']);
const CLASS_NAMES = new Set(Object.keys(CLASSES));

export function parse(toks) {
  let p = 0;
  const enums = new Map();
  const enumTypes = new Set();
  const peek = (k = 0) => toks[Math.min(p + k, toks.length - 1)];
  const next = () => toks[Math.min(p++, toks.length - 1)];
  const is = (v, k = 0) => { const t = peek(k); return (t.t === 'op' || t.t === 'id') && t.v === v; };
  const desc = (t) => (t.t === 'eof' ? 'end of file' : t.t === 'str' ? 'string constant' : `'${t.v}'`);
  const err = (msg, t = peek()) => { throw new CompileError(t.line, msg); };
  const expect = (v) => {
    if (!is(v)) {
      // a missing ';' is reported on the line of the previous token, like gcc
      const prev = toks[p - 1];
      if (v === ';' && prev && prev.line < peek().line) err(`expected ';' at the end of this line`, prev);
      err(`expected '${v}' before ${desc(peek())}`);
    }
    return next();
  };
  const isTypeWord = (t) => t && t.t === 'id' && (BASE_TYPES.has(t.v) || QUALS.has(t.v) || CLASS_NAMES.has(t.v) || enumTypes.has(t.v) || t.v === 'struct' || t.v === 'class' || t.v === 'GxEPD2_BW');
  function startsDecl() {
    const t = peek();
    if (!isTypeWord(t)) return false;
    if (t.v === 'String' || CLASS_NAMES.has(t.v) || enumTypes.has(t.v)) { const n = peek(1); return n.t === 'id' || (n.t === 'op' && (n.v === '*' || n.v === '&')); }
    return true;
  }
  function parseType() {
    const t0 = peek();
    const words = [];
    let cls = null, isConst = false, isStatic = false;
    for (;;) {
      const t = peek();
      if (t.t !== 'id') break;
      if (t.v === 'const' || t.v === 'constexpr') { isConst = true; next(); continue; }
      if (QUALS.has(t.v) && t.v !== 'unsigned' && t.v !== 'signed') { if (t.v === 'static') isStatic = true; next(); continue; }
      if (t.v === 'struct' || t.v === 'class') err('structs and classes are not supported by the canvas interpreter yet — use separate variables or arrays.');
      if (t.v === 'GxEPD2_BW') err('the e-paper library (GxEPD2) is not simulated in the canvas yet.');
      if (CLASS_NAMES.has(t.v) && !words.length && !cls) { cls = next().v; continue; }
      if (enumTypes.has(t.v) && !words.length) { next(); words.push('int'); continue; }
      if (BASE_TYPES.has(t.v) && !cls) { words.push(next().v); continue; }
      break;
    }
    if (!words.length && !cls) err(`'${t0.v}' does not name a type`, t0);
    let ty;
    if (cls) ty = OBJ(cls);
    else {
      const uns = words.includes('unsigned');
      const b = words.filter((x) => x !== 'unsigned' && x !== 'signed').join(' ') || 'int';
      if (b === 'void') ty = VOID;
      else if (b === 'float' || b === 'double' || b === 'long double') ty = FLOAT;
      else if (b === 'bool' || b === 'boolean') ty = BOOL;
      else if (b === 'String') ty = STR;
      else if (b === 'auto') ty = ANY;
      else if (b === 'char') ty = uns ? BYTE : CHAR;
      else if (b === 'byte' || b === 'uint8_t') ty = BYTE;
      else if (b === 'int8_t') ty = T('int', { bits: 8 });
      else if (b === 'short' || b === 'int16_t' || b === 'short int') ty = T('int', { bits: 16, uns });
      else if (b === 'word' || b === 'uint16_t') ty = T('int', { bits: 16, uns: true });
      else if (b === 'uint32_t' || b === 'size_t') ty = UINT;
      else if (b === 'int32_t') ty = INT;
      else if (b === 'long long' || b === 'int64_t' || b === 'long long int') ty = T('int', { bits: 64, uns });
      else if (b === 'uint64_t') ty = T('int', { bits: 64, uns: true });
      else if (b === 'int' || b === 'long' || b === 'long int') ty = uns ? UINT : INT;
      else err(`unknown type '${words.join(' ')}'`, t0);
    }
    if (isConst) ty = { ...ty, cst: true };
    if (isStatic) ty = { ...ty, st: true };
    if (is('<')) err('templates are not supported by the canvas interpreter.');
    return ty;
  }
  function declarator(base) {
    let ty = base, ptr = 0;
    while (is('*') || is('&')) { const o = next().v; if (o === '*') ptr++; else err('reference variables (&) are not supported by the canvas interpreter — use a plain variable.'); }
    while (is('const')) next();
    const nameTok = next();
    if (nameTok.t !== 'id') err(`expected a variable name before ${desc(nameTok)}`, nameTok);
    const dims = [];
    while (is('[')) { next(); if (is(']')) { next(); dims.push(null); } else { dims.push(expr()); expect(']'); } }
    if (ptr) {
      if (ty.b === 'int' && ty.ch) ty = { ...STR, cst: ty.cst };
      else ty = T('arr', { of: ty, ptr: true });
    }
    if (dims.length) {
      if (ty.b === 'int' && ty.ch && dims.length === 1) ty = { ...STR, chararr: true };
      else if (ty.b === 'str' && ptr && dims.length === 1) ty = T('arr', { of: STR, n: dims[0] });
      else for (let k = dims.length - 1; k >= 0; k--) ty = T('arr', { of: ty, n: dims[k] });
    }
    let init = null, ctor = null;
    if (is('=')) { next(); init = is('{') ? initList() : assign(); }
    else if (is('(') && ty.b === 'obj') { next(); ctor = args(); }
    else if (is('{') && ty.b !== 'arr') { init = initList(); init = init.items[0] || null; }
    return { name: nameTok.v, ty, init, ctor, line: nameTok.line };
  }
  function initList() {
    const t = expect('{');
    const items = [];
    while (!is('}')) { items.push(is('{') ? initList() : assign()); if (!is('}')) expect(','); }
    next();
    return { k: 'init', items, line: t.line };
  }
  function args() {
    const out = [];
    if (is(')')) { next(); return out; }
    for (;;) { out.push(assign()); if (is(')')) { next(); return out; } expect(','); }
  }
  function program() {
    const items = [];
    while (peek().t !== 'eof') {
      if (is(';')) { next(); continue; }
      if (is('enum')) { items.push(enumDecl()); continue; }
      if (is('typedef') || is('using') || is('namespace') || is('template')) err(`'${peek().v}' is not supported by the canvas interpreter.`);
      if (!isTypeWord(peek())) {
        const t = peek();
        if (t.t === 'id' && is('(', 1)) err(`'${t.v}' needs a return type — write void ${t.v}() { … } (statements belong inside setup() or loop()).`, t);
        err(t.t === 'id' ? `'${t.v}' does not name a type` : `expected a declaration before ${desc(t)}`, t);
      }
      const line = peek().line;
      const ty = parseType();
      let q = 0; while (is('*', q)) q++;
      if (peek(q).t === 'id' && is('(', q + 1) && !(ty.b === 'obj' && !q && !isTypeWord(peek(2)) && !is(')', 2))) {
        p += q;
        const name = next().v;
        next();
        const params = [];
        if (!is(')')) {
          if (is('void') && is(')', 1)) next();
          else for (;;) {
            const pt = parseType();
            let ptr = 0; while (is('*')) { next(); ptr++; }
            if (is('&')) err('reference parameters (&) are not supported by the canvas interpreter — return a value or use a global.');
            let pname = null; if (peek().t === 'id') pname = next().v;
            let arr = 0; while (is('[')) { next(); while (!is(']') && peek().t !== 'eof') next(); next(); arr++; }
            const pty = ptr || arr ? (pt.b === 'int' && pt.ch && arr <= 1 ? STR : T('arr', { of: arr > 1 ? T('arr', { of: pt }) : pt, ptr: true })) : pt;
            let def = null; if (is('=')) { next(); def = assign(); }
            params.push({ name: pname, ty: pty, def });
            if (is(')')) break;
            expect(',');
          }
        }
        expect(')');
        while (is('const')) next();
        if (is(';')) { next(); items.push({ k: 'proto', name, ret: ty, params, line }); continue; }
        if (!is('{')) err(`expected '{' to start the body of ${name}()`);
        const body = block();
        items.push({ k: 'func', name, ret: ty, params, body, line });
        continue;
      }
      const decls = [declarator(ty)];
      while (is(',')) { next(); decls.push(declarator(ty)); }
      expect(';');
      items.push({ k: 'decl', decls, line });
    }
    return items;
  }
  function enumDecl() {
    const t = next();
    if (is('class')) next();
    let name = null; if (peek().t === 'id') name = next().v;
    if (name) enumTypes.add(name);
    if (is(':')) { next(); parseType(); }
    expect('{');
    let v = 0;
    const list = [];
    while (!is('}')) {
      const id = next(); if (id.t !== 'id') err('expected a name in the enum', id);
      if (is('=')) { next(); v = constEval(cond()); }
      enums.set(id.v, v); list.push([id.v, v]); v++;
      if (!is('}')) expect(',');
    }
    next();
    if (peek().t === 'id') next();
    expect(';');
    return { k: 'enum', list, line: t.line };
  }
  function constEval(e) {
    if (e.k === 'num') return e.v;
    if (e.k === 'un' && e.op === '-') return -constEval(e.a);
    if (e.k === 'bin') { const a = constEval(e.a), b = constEval(e.b); return { '+': a + b, '-': a - b, '*': a * b, '/': Math.trunc(a / b), '<<': a << b, '|': a | b }[e.op] ?? 0; }
    err('enum values must be constants');
  }
  function block() {
    const t = expect('{');
    const body = [];
    while (!is('}')) { if (peek().t === 'eof') err("expected '}' at end of input — a { has no matching }", t); body.push(stmt()); }
    next();
    return { k: 'block', body, line: t.line };
  }
  function stmt() {
    const t = peek();
    if (is('{')) return block();
    if (is(';')) { next(); return { k: 'empty', line: t.line }; }
    if (t.t === 'id') {
      switch (t.v) {
        case 'if': { next(); expect('('); const c = commaExpr(); expect(')'); const a = stmt(); let b = null; if (is('else')) { next(); b = stmt(); } return { k: 'if', c, a, b, line: t.line }; }
        case 'while': { next(); expect('('); const c = commaExpr(); expect(')'); return { k: 'while', c, body: stmt(), line: t.line }; }
        case 'do': { next(); const body = stmt(); if (!is('while')) err("expected 'while' after the do { … } body"); next(); expect('('); const c = commaExpr(); expect(')'); expect(';'); return { k: 'do', c, body, line: t.line }; }
        case 'for': {
          next(); expect('(');
          let init = null;
          if (is(';')) next();
          else if (startsDecl()) { const ty = parseType(); const decls = [declarator(ty)]; while (is(',')) { next(); decls.push(declarator(ty)); } expect(';'); init = { k: 'decl', decls, line: t.line }; }
          else { init = { k: 'expr', e: commaExpr(), line: t.line }; expect(';'); }
          const c = is(';') ? null : commaExpr(); expect(';');
          const step = is(')') ? null : commaExpr(); expect(')');
          return { k: 'for', init, c, step, body: stmt(), line: t.line };
        }
        case 'switch': {
          next(); expect('('); const c = commaExpr(); expect(')'); expect('{');
          const cases = [];
          while (!is('}')) {
            if (peek().t === 'eof') err("expected '}' to close the switch", t);
            if (is('case')) { const ct = next(); const v = cond(); expect(':'); cases.push({ v, body: [], line: ct.line }); continue; }
            if (is('default')) { const ct = next(); expect(':'); cases.push({ v: null, body: [], line: ct.line }); continue; }
            if (!cases.length) err("statement before the first 'case' in switch");
            cases[cases.length - 1].body.push(stmt());
          }
          next();
          return { k: 'switch', c, cases, line: t.line };
        }
        case 'break': next(); expect(';'); return { k: 'break', line: t.line };
        case 'continue': next(); expect(';'); return { k: 'continue', line: t.line };
        case 'return': { next(); const e = is(';') ? null : commaExpr(); expect(';'); return { k: 'return', e, line: t.line }; }
        case 'goto': err('goto is not supported by the canvas interpreter.');
        case 'case': case 'default': err(`'${t.v}' label not within a switch statement`);
        case 'else': err("'else' without a previous 'if'");
        case 'enum': return enumDecl();
        default:
      }
      if (startsDecl()) {
        const ty = parseType();
        const decls = [declarator(ty)];
        while (is(',')) { next(); decls.push(declarator(ty)); }
        expect(';');
        return { k: 'decl', decls, line: t.line };
      }
    }
    const e = commaExpr();
    expect(';');
    return { k: 'expr', e, line: t.line };
  }
  function commaExpr() {
    const a = assign();
    if (!is(',')) return a;
    const list = [a];
    while (is(',')) { next(); list.push(assign()); }
    return { k: 'comma', list, line: a.line };
  }
  function expr() { return assign(); }
  const ASSIGN = new Set(['=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>=']);
  function assign() {
    const a = cond();
    if (peek().t === 'op' && ASSIGN.has(peek().v)) {
      const op = next().v;
      if (is('{')) err('a brace list {…} can only initialise a variable where it is declared.');
      const b = assign();
      return { k: 'assign', op, a, b, line: a.line };
    }
    return a;
  }
  function cond() {
    const c = binary(0);
    if (is('?')) { next(); const a = commaExpr(); expect(':'); const b = assign(); return { k: 'tern', c, a, b, line: c.line }; }
    return c;
  }
  const PREC = [['||'], ['&&'], ['|'], ['^'], ['&'], ['==', '!='], ['<', '>', '<=', '>='], ['<<', '>>'], ['+', '-'], ['*', '/', '%']];
  function binary(level) {
    if (level >= PREC.length) return unary();
    let a = binary(level + 1);
    while (peek().t === 'op' && PREC[level].includes(peek().v)) {
      const op = next().v;
      const b = binary(level + 1);
      a = { k: 'bin', op, a, b, line: a.line };
    }
    return a;
  }
  function unary() {
    const t = peek();
    if (t.t === 'op') {
      if (t.v === '++' || t.v === '--') { next(); return { k: 'pre', op: t.v, a: unary(), line: t.line }; }
      if (t.v === '-' || t.v === '+' || t.v === '!' || t.v === '~') { next(); return { k: 'un', op: t.v, a: unary(), line: t.line }; }
      if (t.v === '&') { next(); return { k: 'addr', a: unary(), line: t.line }; }
      if (t.v === '*') { next(); return { k: 'deref', a: unary(), line: t.line }; }
      if (t.v === '(' && isTypeWord(peek(1)) && !(peek(1).v === 'String' && is('(', 2))) {
        next(); const ty = parseType(); let ptr = 0; while (is('*')) { next(); ptr++; } expect(')');
        return { k: 'cast', ty: ptr ? T('arr', { of: ty, ptr: true }) : ty, a: unary(), line: t.line };
      }
    }
    if (t.t === 'id' && t.v === 'sizeof') {
      next();
      if (is('(') && isTypeWord(peek(1))) { next(); const ty = parseType(); while (is('*')) next(); expect(')'); return { k: 'sizeofT', ty, line: t.line }; }
      return { k: 'sizeof', a: unary(), line: t.line };
    }
    return postfix(primary());
  }
  function postfix(a) {
    for (;;) {
      const t = peek();
      if (t.t !== 'op') return a;
      if (t.v === '(') { next(); a = { k: 'call', f: a, args: args(), line: t.line }; continue; }
      if (t.v === '[') { next(); const i = commaExpr(); expect(']'); a = { k: 'index', a, i, line: t.line }; continue; }
      if (t.v === '.' || t.v === '->') { next(); const n = next(); if (n.t !== 'id') err(`expected a member name after '${t.v}'`, n); a = { k: 'member', a, name: n.v, line: t.line }; continue; }
      if (t.v === '++' || t.v === '--') { next(); a = { k: 'post', op: t.v, a, line: t.line }; continue; }
      if (t.v === '::') err("'::' scopes are not supported by the canvas interpreter.");
      return a;
    }
  }
  function primary() {
    const t = next();
    if (t.t === 'num') return { k: 'num', v: t.v, fl: t.fl, ch: t.ch, uns: t.uns, line: t.line };
    if (t.t === 'str') { let v = t.v; while (peek().t === 'str') v += next().v; return { k: 'str', v, line: t.line }; }
    if (t.t === 'id') {
      if (enums.has(t.v)) return { k: 'num', v: enums.get(t.v), line: t.line };
      if (BASE_TYPES.has(t.v) && t.v !== 'String' && is('(')) { p--; const ty = parseType(); expect('('); const a = commaExpr(); expect(')'); return { k: 'cast', ty, a, line: t.line }; }
      if (t.v === 'new' || t.v === 'delete') err(`'${t.v}' (dynamic memory) is not supported by the canvas interpreter.`, t);
      if (t.v === 'this') err("'this' is not supported (no classes) in the canvas interpreter.", t);
      if (isTypeWord(t) && t.v !== 'String' && !CLASS_NAMES.has(t.v)) err(`expected an expression before '${t.v}' — declarations go on their own line`, t);
      return { k: 'id', name: t.v, line: t.line };
    }
    if (t.t === 'op' && t.v === '(') { const e = commaExpr(); expect(')'); return e; }
    if (t.t === 'op' && t.v === '[') err('lambdas are not supported by the canvas interpreter.', t);
    if (t.t === 'op' && t.v === '{') { p--; return initList(); }
    err(`expected an expression before ${desc(t)}`, t);
  }
  return program();
}

// ------------------------------------------------------------------ type helpers
const isNum = (t) => t.b === 'int' || t.b === 'float' || t.b === 'bool' || t.b === 'any';
const tagOf = (t) => (t.b === 'float' ? 'f' : t.b === 'bool' ? 'b' : t.b === 'str' ? 's' : t.b === 'int' ? (t.ch ? 'c' : t.uns ? 'u' : 'i') : t.b === 'any' ? 'a' : 'o');
const tname = (t) => (t.b === 'obj' ? t.cls : t.b === 'arr' ? `${tname(t.of)}[]` : t.b === 'str' ? 'String' : t.b === 'int' ? (t.ch ? 'char' : `${t.uns ? 'unsigned ' : ''}${t.bits === 8 ? 'char' : t.bits === 16 ? 'short' : t.bits === 64 ? 'long long' : 'int'}`) : t.b === 'fn' ? 'function' : t.b);
function coerce(code, from, to) {
  if (!to || to.b === 'any' || to.b === 'void' || to.b === 'arr' || to.b === 'obj') return code;
  if (to.b === 'int') {
    if (from && from.b === 'int' && (from.bits || 32) === (to.bits || 32) && !!from.uns === !!to.uns) return code;
    if (from && from.b === 'str') return `$.strNum(${code})`;
    const bits = to.bits || 32;
    if (bits === 64) return `Math.trunc(${code})`;
    if (bits === 32) return to.uns ? `((${code})>>>0)` : `((${code})|0)`;
    if (bits === 16) return to.uns ? `((${code})&65535)` : `((${code})<<16>>16)`;
    return to.uns ? `((${code})&255)` : `((${code})<<24>>24)`;
  }
  if (to.b === 'float') return from && (from.b === 'float' || from.b === 'int' || from.b === 'bool') ? code : `(+(${code}))`;
  if (to.b === 'bool') return from && from.b === 'bool' ? code : from && from.b === 'str' ? `((${code}).length?1:0)` : `((${code})?1:0)`;
  if (to.b === 'str') return from && from.b === 'str' ? code : `$.S(${code},'${from ? tagOf(from) : 'a'}')`;
  return code;
}
const sizeOfT = (t) => (t.b === 'float' ? 4 : t.b === 'bool' ? 1 : t.b === 'int' ? (t.bits || 32) / 8 : t.b === 'str' ? 1 : 4);

// ------------------------------------------------------------------ code generation
export function compileCpp(src) {
  const { toks, includes } = lex(src);
  const ast = parse(toks);
  const funcs = new Map();
  for (const it of ast) if (it.k === 'func') {
    if (funcs.has(it.name)) throw new CompileError(it.line, `redefinition of '${it.name}()' — function overloading is not supported by the canvas interpreter.`);
    if (FUNCS[it.name] || CLASSES[it.name]) throw new CompileError(it.line, `'${it.name}' is already a built-in function — pick another name.`);
    funcs.set(it.name, it);
  }
  for (const it of ast) if (it.k === 'proto' && !funcs.has(it.name)) throw new CompileError(it.line, `undefined reference to '${it.name}()' — it is declared but never defined.`);
  if (!funcs.has('setup')) throw new CompileError(1, "undefined reference to 'setup()' — every sketch needs void setup() { … }.");
  if (!funcs.has('loop')) throw new CompileError(1, "undefined reference to 'loop()' — every sketch needs void loop() { … }.");
  let tmpN = 0, maxTmp = 0;
  const tmp = () => { const v = `$t${tmpN++}`; maxTmp = Math.max(maxTmp, tmpN); return v; };
  const err = (node, msg) => { throw new CompileError(node.line, msg); };
  const globals = new Map();
  let scopes = [globals];
  const lookup = (name) => { for (let i = scopes.length - 1; i >= 0; i--) { const v = scopes[i].get(name); if (v) return v; } return null; };
  let vid = 0;
  const declare = (node, name, ty) => {
    const s = scopes[scopes.length - 1];
    if (s.has(name)) err(node, `redeclaration of '${name}'`);
    if (s === globals && funcs.has(name)) err(node, `'${name}' is already the name of a function`);
    const v = { ty, js: `v_${name}_${vid++}`, name };
    s.set(name, v);
    return v;
  };
  let curFn = null, loopDepth = 0, switchDepth = 0;
  const leaf = (t) => (t.b === 'arr' ? leaf(t.of) : t);
  const exprName = (n) => (n.k === 'id' ? n.name : n.k === 'member' ? `${exprName(n.a)}.${n.name}` : n.k === 'index' ? `${exprName(n.a)}[…]` : 'expression');
  function lev(a, b) {
    if (Math.abs(a.length - b.length) > 2) return 9;
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
  }
  function suggestIn(name, list) {
    const low = name.toLowerCase();
    const hit = list.find((x) => x.toLowerCase() === low) || list.find((x) => lev(x.toLowerCase(), low) <= (low.length > 5 ? 2 : 1));
    return hit ? ` — did you mean '${hit}'?` : '';
  }
  const suggest = (name) => suggestIn(name, [...scopes.flatMap((s) => [...s.keys()]), ...funcs.keys(), ...Object.keys(FUNCS), ...Object.keys(CONSTS), ...Object.keys(GLOBAL_OBJECTS)]);
  const truth = (x) => (x.t.b === 'str' ? `(${x.c}).length` : x.t.b === 'obj' ? '1' : x.c);
  function need(node, x) { if (!isNum(x.t)) err(node, `invalid operand of type '${tname(x.t)}' here`); }
  function lvalue(node, x) {
    if (x.lv) return;
    if (x.v && x.v.ty.cst) err(node, `assignment of read-only variable '${x.v.name}'`);
    if (x.t.cst) err(node, 'assignment of read-only location');
    err(node, 'lvalue required as left operand of assignment');
  }
  function checkAssign(node, to, from) {
    if (to.b === 'obj' || from.b === 'obj') { if (to.b !== from.b || to.cls !== from.cls) err(node, `cannot convert '${tname(from)}' to '${tname(to)}'`); return; }
    if (to.b === 'arr' && from.b !== 'arr' && from.b !== 'any') err(node, `cannot convert '${tname(from)}' to '${tname(to)}'`);
    if ((to.b === 'int' || to.b === 'float' || to.b === 'bool') && (from.b === 'arr' || from.b === 'fn')) err(node, `cannot convert '${tname(from)}' to '${tname(to)}'`);
    if (((to.b === 'int' && !to.ch) || to.b === 'float' || to.b === 'bool') && from.b === 'str') err(node, `cannot convert 'String' to '${tname(to)}' — use .toInt() or .toFloat()`);
    if (from.b === 'void') err(node, 'void value not ignored as it ought to be');
  }

  function E(node) {
    switch (node.k) {
      case '$v': return node.x;
      case 'num': return { c: String(node.v), t: node.fl ? FLOAT : node.ch ? CHAR : node.uns ? UINT : INT };
      case 'str': return { c: JSON.stringify(node.v), t: { ...STR, lit: true } };
      case 'init': err(node, 'a brace list {…} can only initialise an array or a variable.');
      case 'id': {
        const v = lookup(node.name);
        if (v) return { c: v.js, t: v.ty, lv: !v.ty.cst && v.ty.b !== 'obj' && !(v.ty.b === 'arr' && !v.ty.ptr), v };
        if (node.name in CONSTS) return { c: String(CONSTS[node.name]), t: FLOAT_CONSTS.has(node.name) ? FLOAT : INT };
        if (GLOBAL_OBJECTS[node.name]) return { c: `$.${node.name}`, t: OBJ(GLOBAL_OBJECTS[node.name]) };
        if (UNSUPPORTED_GLOBALS[node.name]) err(node, `'${node.name}': ${UNSUPPORTED_GLOBALS[node.name]}`);
        if (funcs.has(node.name)) return { c: `F_${node.name}`, t: T('fn', { name: node.name }) };
        err(node, `'${node.name}' was not declared in this scope${suggest(node.name)}`);
      }
      case 'comma': { const parts = node.list.map(E); return { c: `(${parts.map((x) => x.c).join(',')})`, t: parts[parts.length - 1].t }; }
      case 'tern': {
        const c = E(node.c), a = E(node.a), b = E(node.b);
        let t = a.t;
        if (a.t.b === 'str' || b.t.b === 'str') t = STR;
        else if (a.t.b === 'float' || b.t.b === 'float') t = FLOAT;
        else if (a.t.b === 'int' && b.t.b === 'int' && !(a.t.ch && b.t.ch)) t = (a.t.uns && b.t.uns) ? UINT : INT;
        return { c: `(${truth(c)}?${coerce(a.c, a.t, t)}:${coerce(b.c, b.t, t)})`, t: { ...t, lit: false } };
      }
      case 'un': {
        const a = E(node.a);
        if (node.op === '!') return { c: `(${truth(a)}?0:1)`, t: BOOL };
        need(node, a);
        if (node.op === '-') return { c: `(-${a.c})`, t: a.t.b === 'float' ? FLOAT : (a.t.bits === 64 ? a.t : a.t.uns ? UINT : INT) };
        if (node.op === '+') return { c: `(+${a.c})`, t: a.t.b === 'float' ? FLOAT : INT };
        if (a.t.b === 'float') err(node, "wrong type argument to bit-complement '~'");
        return { c: a.t.uns ? `((~${a.c})>>>0)` : `(~${a.c})`, t: a.t.uns ? UINT : INT };
      }
      case 'addr': return E(node.a);
      case 'deref': { const a = E(node.a); if (a.t.b === 'arr') return { c: `$.ix(${a.c},0)`, t: a.t.of }; err(node, 'pointers are only supported as array aliases in the canvas interpreter.'); }
      case 'cast': {
        const a = E(node.a);
        if (node.ty.b === 'str') return { c: coerce(a.c, a.t, STR), t: STR };
        if (node.ty.b === 'arr' || node.ty.b === 'void') return a;
        if (node.ty.b === 'int' && a.t.b === 'float') return { c: coerce(`Math.trunc(${a.c})`, INT, node.ty), t: { ...node.ty, cst: false } };
        return { c: coerce(a.c, a.t, node.ty), t: { ...node.ty, cst: false } };
      }
      case 'sizeofT': return { c: String(sizeOfT(node.ty)), t: UINT };
      case 'sizeof': {
        const a = E(node.a);
        if (a.t.b === 'arr') return { c: `$.sz(${a.c},${sizeOfT(leaf(a.t))})`, t: UINT };
        if (a.t.b === 'str') return { c: `(${a.c}.length+1)`, t: UINT };
        return { c: String(sizeOfT(a.t)), t: UINT };
      }
      case 'bin': {
        const a = E(node.a), b = E(node.b);
        if (node.op === '&&' || node.op === '||') return { c: `((${truth(a)})${node.op}(${truth(b)})?1:0)`, t: BOOL };
        return binop(node, node.op, a, b);
      }
      case 'assign': return assign(node);
      case 'pre': case 'post': {
        const a = E(node.a);
        lvalue(node.a, a);
        need(node, a);
        const d = node.op === '++' ? '+' : '-';
        const r = tmp();
        if (a.idx) {
          const [ta, ti] = [tmp(), tmp()];
          return { c: `(${ta}=${a.base},${ti}=${a.ic},${r}=$.ix(${ta},${ti}),$.st(${ta},${ti},${coerce(`${r}${d}1`, FLOAT, a.t)})${node.k === 'post' ? `,${r}` : ''})`, t: a.t };
        }
        if (node.k === 'pre') return { c: `(${a.c}=${coerce(`${a.c}${d}1`, FLOAT, a.t)})`, t: a.t };
        return { c: `(${r}=${a.c},${a.c}=${coerce(`${r}${d}1`, FLOAT, a.t)},${r})`, t: a.t };
      }
      case 'index': {
        const a = E(node.a), i = E(node.i);
        need(node.i, i);
        if (a.t.b === 'str') return { c: `$.chr(${a.c},${i.c})`, t: CHAR };
        if (a.t.b !== 'arr') err(node, `invalid types for array subscript — '${exprName(node.a)}' is not an array`);
        return { c: `$.ix(${a.c},${i.c})`, t: a.t.of, lv: !a.t.of.cst && !a.t.cst, idx: true, base: a.c, ic: i.c };
      }
      case 'member': {
        const a = E(node.a);
        err(node, a.t.b === 'obj' ? `'${exprName(node)}' is a function — call it with ()` : `request for member '${node.name}' in '${exprName(node.a)}', which is of non-class type '${tname(a.t)}'`);
      }
      case 'call': return call(node);
      default:
    }
    err(node, 'unsupported expression');
  }
  function binop(node, op, a, b) {
    if (a.t.b === 'void' || b.t.b === 'void') err(node, 'void value not ignored as it ought to be');
    if (op === '+' && (a.t.b === 'str' || b.t.b === 'str')) {
      if (a.t.lit && b.t.lit) err(node, "invalid operands to binary '+': two string literals can't be added — wrap one in String(…).");
      if (a.t.lit && b.t.b === 'int' && !b.t.ch) err(node, "adding a number to a string literal does pointer maths in C++ — wrap the text in String(…) first.");
      return { c: `(${coerce(a.c, a.t, STR)}+${coerce(b.c, b.t, STR)})`, t: STR };
    }
    if (['==', '!=', '<', '>', '<=', '>='].includes(op) && (a.t.b === 'str' || b.t.b === 'str')) {
      const s = (x) => (x.t.b === 'str' ? x.c : x.t.ch ? `String.fromCharCode(${x.c})` : coerce(x.c, x.t, STR));
      const jop = op === '==' ? '===' : op === '!=' ? '!==' : op;
      return { c: `(${s(a)}${jop}${s(b)}?1:0)`, t: BOOL };
    }
    if (a.t.b === 'arr' || b.t.b === 'arr') { if (op === '==' || op === '!=') return { c: `(${a.c}${op}=${b.c}?1:0)`, t: BOOL }; err(node, 'pointer arithmetic is not supported by the canvas interpreter — index the array instead.'); }
    if (a.t.b === 'str' || b.t.b === 'str') err(node, `invalid operands of type 'String' to binary '${op}'`);
    need(node.a || node, a); need(node.b || node, b);
    const fl = a.t.b === 'float' || b.t.b === 'float';
    const uns = (a.t.uns && (a.t.bits || 32) >= 32) || (b.t.uns && (b.t.bits || 32) >= 32);
    const big = a.t.bits === 64 || b.t.bits === 64;
    const rt = fl ? FLOAT : big ? T('int', { bits: 64, uns }) : uns ? UINT : INT;
    const intOnly = () => { if (fl) err(node, `invalid operands of type 'float' to binary '${op}'${op === '%' ? ' — use fmod()' : ''}`); };
    switch (op) {
      case '+': case '-': {
        const raw = `(${a.c}${op}${b.c})`;
        if (fl || big) return { c: raw, t: rt };
        return { c: uns ? `(${raw}>>>0)` : `(${raw}|0)`, t: rt };
      }
      case '*': if (fl || big) return { c: `(${a.c}*${b.c})`, t: rt }; return { c: uns ? `($.imul(${a.c},${b.c})>>>0)` : `$.imul(${a.c},${b.c})`, t: rt };
      case '/': if (fl) return { c: `(${a.c}/${b.c})`, t: FLOAT }; return { c: uns && !big ? `($.idiv(${a.c},${b.c})>>>0)` : `$.idiv(${a.c},${b.c})`, t: rt };
      case '%': intOnly(); return { c: `$.imod(${a.c},${b.c})`, t: rt };
      case '<': case '>': case '<=': case '>=': return { c: `(${a.c}${op}${b.c}?1:0)`, t: BOOL };
      case '==': return { c: `(${a.c}==${b.c}?1:0)`, t: BOOL };
      case '!=': return { c: `(${a.c}!=${b.c}?1:0)`, t: BOOL };
      case '&': case '|': case '^': intOnly(); return { c: uns ? `((${a.c}${op}${b.c})>>>0)` : `(${a.c}${op}${b.c})`, t: uns ? UINT : INT };
      case '<<': intOnly(); if (big) return { c: `(${a.c}*Math.pow(2,${b.c}))`, t: rt }; return { c: a.t.uns ? `((${a.c}<<${b.c})>>>0)` : `(${a.c}<<${b.c})`, t: a.t.uns ? UINT : INT };
      case '>>': intOnly(); if (big) return { c: `Math.floor(${a.c}/Math.pow(2,${b.c}))`, t: rt }; return { c: a.t.uns ? `(${a.c}>>>${b.c})` : `(${a.c}>>${b.c})`, t: a.t.uns ? UINT : INT };
      default:
    }
    err(node, `unsupported operator '${op}'`);
  }
  function assign(node) {
    const a = E(node.a);
    lvalue(node.a, a);
    const b = E(node.b);
    let rhs;
    const cur = a.idx ? '$CUR$' : a.c;
    if (node.op === '=') { checkAssign(node, a.t, b.t); rhs = coerce(b.c, b.t, a.t); }
    else {
      const op = node.op.slice(0, -1);
      if (a.t.b === 'str' && op !== '+') err(node, `invalid operator '${node.op}' on a String`);
      if (a.t.b === 'str') rhs = `(${cur}+${b.t.ch ? `String.fromCharCode(${b.c})` : coerce(b.c, b.t, STR)})`;
      else { const r = binop({ line: node.line }, op, { c: cur, t: a.t }, b); rhs = coerce(r.c, r.t, a.t); }
    }
    if (a.idx) {
      const [ta, ti] = [tmp(), tmp()];
      return { c: `(${ta}=${a.base},${ti}=${a.ic},$.st(${ta},${ti},${rhs.split('$CUR$').join(`$.ix(${ta},${ti})`)}))`, t: a.t };
    }
    return { c: `(${a.c}=${rhs})`, t: a.t };
  }
  const fmtArgs = (xs) => `[${xs.map((x) => x.c).join(',')}],[${xs.map((x) => `'${tagOf(x.t)}'`).join(',')}]`;
  function call(node) {
    const f = node.f;
    if (f.k === 'member') return method(node, f);
    if (f.k !== 'id') err(node, 'only named functions can be called');
    const name = f.name;
    if (lookup(name)) err(node, `'${name}' cannot be used as a function`);
    if (funcs.has(name)) {
      const fn = funcs.get(name);
      const ps = fn.params;
      const req = ps.filter((x) => !x.def).length;
      if (node.args.length < req) err(node, `too few arguments to function '${name}' (it takes ${req === ps.length ? req : `${req}–${ps.length}`})`);
      if (node.args.length > ps.length) err(node, `too many arguments to function '${name}' (it takes ${ps.length})`);
      const as = ps.map((pp, i) => {
        const src = node.args[i] || pp.def;
        const x = E(src);
        if (pp.ty.b === 'arr' && x.t.b !== 'arr') err(src, `cannot convert '${tname(x.t)}' to an array for argument ${i + 1} of '${name}'`);
        if (pp.ty.b === 'obj' && (x.t.b !== 'obj' || x.t.cls !== pp.ty.cls)) err(src, `cannot convert '${tname(x.t)}' to '${tname(pp.ty)}' for argument ${i + 1} of '${name}'`);
        if (pp.ty.b !== 'arr' && pp.ty.b !== 'obj') checkAssign(src, pp.ty, x.t);
        return coerce(x.c, x.t, pp.ty);
      });
      return { c: `(yield* F_${name}(${as.join(',')}))`, t: fn.ret };
    }
    if (name === 'String') {
      if (!node.args.length) return { c: '""', t: STR };
      const x = E(node.args[0]);
      if (node.args[1]) { const k = E(node.args[1]); return { c: `$.S(${x.c},'${tagOf(x.t)}',${k.c})`, t: STR }; }
      return { c: x.t.b === 'str' ? x.c : coerce(x.c, x.t, STR), t: STR };
    }
    if (CLASSES[name]) return { c: `$.make(${JSON.stringify(name)},[${node.args.map((a) => E(a).c).join(',')}],${node.line})`, t: OBJ(name) };
    if (UNSUPPORTED_GLOBALS[name]) err(node, `'${name}': ${UNSUPPORTED_GLOBALS[name]}`);
    const sig = FUNCS[name];
    if (!sig) {
      if (/^(WiFi|esp_now|esp_wifi|ble|BLE|xTask|vTask|esp_sleep|esp_deep_sleep|esp_light_sleep|xQueue|xSemaphore|SPIFFS|LittleFS)/.test(name)) err(node, `'${name}' is not simulated in the canvas (no Wi-Fi, Bluetooth, FreeRTOS tasks, files or sleep modes).`);
      err(node, `'${name}' was not declared in this scope${suggest(name)}`);
    }
    if (node.args.length < sig.min) err(node, `too few arguments to function '${name}'`);
    if (node.args.length > sig.max) err(node, `too many arguments to function '${name}'`);
    const xs = node.args.map(E);
    const c = xs.map((x) => x.c);
    xs.forEach((x, i) => { if (x.t.b === 'void') err(node.args[i], 'void value not ignored as it ought to be'); });
    switch (name) {
      case 'F': case 'makeKeymap': return xs[0];
      case 'min': case 'max': { const t = xs.some((x) => x.t.b === 'float') ? FLOAT : INT; return { c: `Math.${name}(${c[0]},${c[1]})`, t }; }
      case 'abs': return { c: `Math.abs(${c[0]})`, t: xs[0].t.b === 'float' ? FLOAT : INT };
      case 'sq': return { c: `((${c[0]})*(${c[0]}))`, t: xs[0].t.b === 'float' ? FLOAT : INT };
      case 'constrain': { const t = xs.some((x) => x.t.b === 'float') ? FLOAT : { ...xs[0].t, cst: false, lit: false }; return { c: `Math.min(Math.max(${c[0]},${c[1]}),${c[2]})`, t }; }
      case 'map': return { c: `$.map(${c.join(',')})`, t: xs.some((x) => x.t.b === 'float') ? FLOAT : INT };
      case 'sprintf': case 'snprintf': case 'dtostrf': case 'strcpy': case 'strcat': {
        const target = name === 'dtostrf' ? node.args[3] : node.args[0];
        const tv = E(target);
        if (tv.t.b !== 'str' || !tv.lv) err(target, `${name}() needs a char array to write into, e.g. char buf[32];`);
        let val;
        if (name === 'sprintf') val = `$.fmt(${c[1]},${fmtArgs(xs.slice(2))})`;
        else if (name === 'snprintf') val = `$.fmt(${c[2]},${fmtArgs(xs.slice(3))}).slice(0,Math.max(0,${c[1]}-1))`;
        else if (name === 'dtostrf') val = `$.dtostrf(${c[0]},${c[1]},${c[2]})`;
        else if (name === 'strcpy') val = coerce(c[1], xs[1].t, STR);
        else val = `(${tv.c}+${coerce(c[1], xs[1].t, STR)})`;
        return name === 'sprintf' || name === 'snprintf' ? { c: `((${tv.c}=${val}).length)`, t: INT } : { c: `(${tv.c}=${val})`, t: STR };
      }
      case 'attachInterrupt':
        if (xs[1].t.b !== 'fn') err(node.args[1], 'attachInterrupt() needs the name of a function in your sketch as the handler.');
        return { c: `$.attachInterrupt(${c[0]},${c[1]},${c[2]})`, t: VOID };
      default:
    }
    const call0 = `$.${name}(${c.join(',')})`;
    return { c: sig.block ? `(yield* ${call0})` : call0, t: sig.ret };
  }
  function method(node, f) {
    const o = E(f.a);
    const name = f.name;
    const xs = node.args.map(E);
    const c = xs.map((x) => x.c);
    if (o.t.b === 'str') return strMethod(node, o, name, xs);
    if (o.t.b !== 'obj') err(node, `request for member '${name}' in '${exprName(f.a)}', which is of non-class type '${tname(o.t)}'`);
    const cls = CLASSES[o.t.cls];
    const m = Object.prototype.hasOwnProperty.call(cls, name) ? cls[name] : null;
    if (!m) err(node, `'${o.t.cls}' has no member named '${name}' in the canvas simulator${suggestIn(name, Object.keys(cls))}`);
    if (m.print) {
      if (xs.length > 2) err(node, `too many arguments to ${name}()`);
      const v = xs.length ? `$.fmtv(${c[0]},'${tagOf(xs[0].t)}'${xs[1] ? `,${c[1]}` : ''})` : '""';
      return { c: `${o.c}.${name}(${v})`, t: INT };
    }
    if (m.printf) {
      if (!xs.length) err(node, 'printf() needs a format string');
      return { c: `${o.c}.print($.fmt(${c[0]},${fmtArgs(xs.slice(1))}))`, t: INT };
    }
    const call0 = `${o.c}.${name}(${c.join(',')})`;
    return { c: m.block ? `(yield* ${call0})` : call0, t: m.ret };
  }
  function strMethod(node, o, name, xs) {
    const c = xs.map((x) => x.c);
    const s = o.c;
    const S1 = (i) => (xs[i].t.ch ? `String.fromCharCode(${c[i]})` : coerce(c[i], xs[i].t, STR));
    const mut = (val) => { if (!o.lv) err(node, `${name}() changes the String, so call it on a String variable`); return { c: `(${s}=${val},0)`, t: VOID }; };
    const n = (k) => { if (xs.length < k) err(node, `too few arguments to String.${name}()`); };
    switch (name) {
      case 'length': return { c: `${s}.length`, t: UINT };
      case 'toInt': return { c: `$.strNum(${s})`, t: INT };
      case 'toFloat': case 'toDouble': return { c: `$.strFloat(${s})`, t: FLOAT };
      case 'charAt': n(1); return { c: `$.chr(${s},${c[0]})`, t: CHAR };
      case 'substring': n(1); return { c: `${s}.substring(${c.join(',')})`, t: STR };
      case 'indexOf': n(1); return { c: `${s}.indexOf(${S1(0)}${c[1] ? `,${c[1]}` : ''})`, t: INT };
      case 'lastIndexOf': n(1); return { c: `${s}.lastIndexOf(${S1(0)})`, t: INT };
      case 'equals': n(1); return { c: `(${s}===${S1(0)}?1:0)`, t: BOOL };
      case 'equalsIgnoreCase': n(1); return { c: `(${s}.toLowerCase()===${S1(0)}.toLowerCase()?1:0)`, t: BOOL };
      case 'startsWith': n(1); return { c: `(${s}.startsWith(${S1(0)})?1:0)`, t: BOOL };
      case 'endsWith': n(1); return { c: `(${s}.endsWith(${S1(0)})?1:0)`, t: BOOL };
      case 'c_str': return { c: s, t: STR };
      case 'isEmpty': return { c: `(${s}.length===0?1:0)`, t: BOOL };
      case 'compareTo': n(1); return { c: `$.cmp(${s},${S1(0)})`, t: INT };
      case 'toUpperCase': return mut(`${s}.toUpperCase()`);
      case 'toLowerCase': return mut(`${s}.toLowerCase()`);
      case 'trim': return mut(`${s}.trim()`);
      case 'concat': n(1); return mut(`${s}+${S1(0)}`);
      case 'replace': n(2); return mut(`${s}.split(${S1(0)}).join(${S1(1)})`);
      case 'remove': n(1); return mut(`(${s}.slice(0,${c[0]})+${c[1] ? `${s}.slice(${c[0]}+${c[1]})` : '""'})`);
      case 'setCharAt': n(2); return mut(`(${s}.slice(0,${c[0]})+String.fromCharCode(${c[1]})+${s}.slice(${c[0]}+1))`);
      default:
    }
    err(node, `'String' has no member named '${name}' in the canvas simulator`);
  }

  // ---- statements
  const ln = (node, pad) => `${pad}$.l=${node.line};`;
  function S(node, out, ind) {
    const pad = '  '.repeat(ind);
    switch (node.k) {
      case 'empty': case 'enum': return;
      case 'block': scopes.push(new Map()); for (const s of node.body) S(s, out, ind); scopes.pop(); return;
      case 'expr': out.push(`${ln(node, pad)}${E(node.e).c};`); return;
      case 'decl': for (const d of node.decls) out.push(`${ln(d, pad)}${declCode(d, false)}`); return;
      case 'if': {
        const c = E(node.c);
        out.push(`${ln(node, pad)}if(${truth(c)}){`);
        scopes.push(new Map()); S(node.a, out, ind + 1); scopes.pop();
        if (node.b) { out.push(`${pad}}else{`); scopes.push(new Map()); S(node.b, out, ind + 1); scopes.pop(); }
        out.push(`${pad}}`);
        return;
      }
      case 'while': {
        const c = E(node.c);
        out.push(`${ln(node, pad)}while(${truth(c)}){if(--$.b<0)yield 0;`);
        loopDepth++; scopes.push(new Map()); S(node.body, out, ind + 1); scopes.pop(); loopDepth--;
        out.push(`${pad}$.l=${node.line};}`);
        return;
      }
      case 'do': {
        out.push(`${ln(node, pad)}do{if(--$.b<0)yield 0;`);
        loopDepth++; scopes.push(new Map()); S(node.body, out, ind + 1); scopes.pop(); loopDepth--;
        const c = E(node.c);
        out.push(`${pad}$.l=${node.line};}while(${truth(c)});`);
        return;
      }
      case 'for': {
        scopes.push(new Map());
        const init = node.init ? (node.init.k === 'decl' ? node.init.decls.map((d) => declCode(d, false)).join('') : `${E(node.init.e).c};`) : '';
        const c = node.c ? truth(E(node.c)) : 'true';
        const step = node.step ? E(node.step).c : '';
        out.push(`${ln(node, pad)}{${init}for(;${c};${step}){if(--$.b<0)yield 0;`);
        loopDepth++; S(node.body, out, ind + 1); loopDepth--;
        out.push(`${pad}$.l=${node.line};}}`);
        scopes.pop();
        return;
      }
      case 'switch': {
        const c = E(node.c);
        out.push(`${ln(node, pad)}switch(${c.c}){`);
        switchDepth++;
        scopes.push(new Map());
        for (const k of node.cases) {
          if (k.v) { const v = E(k.v); out.push(`${pad}case ${v.c}:`); } else out.push(`${pad}default:`);
          for (const s of k.body) S(s, out, ind + 1);
        }
        scopes.pop();
        switchDepth--;
        out.push(`${pad}}`);
        return;
      }
      case 'break': if (!loopDepth && !switchDepth) err(node, 'break statement not within loop or switch'); out.push(`${ln(node, pad)}break;`); return;
      case 'continue': if (!loopDepth) err(node, 'continue statement not within a loop'); out.push(`${ln(node, pad)}continue;`); return;
      case 'return': {
        if (!node.e) { if (curFn.ret.b !== 'void') err(node, `return-statement with no value, in function returning '${tname(curFn.ret)}'`); out.push(`${ln(node, pad)}return;`); return; }
        const v = E(node.e);
        if (curFn.ret.b === 'void') err(node, "return-statement with a value, in function returning 'void'");
        checkAssign(node, curFn.ret, v.t);
        out.push(`${ln(node, pad)}return ${coerce(v.c, v.t, curFn.ret)};`);
        return;
      }
      default:
    }
    err(node, 'unsupported statement');
  }
  const zeroOf = (t) => (t.b === 'str' ? '""' : t.b === 'arr' || t.b === 'obj' ? 'null' : '0');
  function arrayInit(t, init, d) {
    const n = t.n ? E(t.n) : null;
    if (n && !isNum(n.t)) err(d, 'array size must be a whole number');
    if (init && init.k === 'str' && t.of.b === 'int' && t.of.ch) return JSON.stringify(init.v);
    if (init && init.k !== 'init') {
      const x = E(init);
      if (t.ptr && x.t.b === 'arr') return x.c;
      err(d, 'arrays are initialised with a brace list, e.g. int pins[] = {2, 4, 5};');
    }
    const items = init ? init.items : [];
    if (!n && !init) err(d, `storage size of '${d.name}' isn't known`);
    const el = t.of;
    if (el.b === 'obj') err(d, 'arrays of library objects are not supported by the canvas interpreter — declare them one by one.');
    const codes = items.map((it) => {
      if (el.b === 'arr') return arrayInit(el, it.k === 'init' || it.k === 'str' ? it : (() => err(it, 'expected a {…} row for a 2-D array'))(), d);
      if (el.b === 'str' && el.chararr) { const x = E(it); return coerce(x.c, x.t, STR); }
      if (it.k === 'init') err(it, 'too many braces around initializer');
      const x = E(it);
      checkAssign(it, el, x.t);
      return coerce(x.c, x.t, el);
    });
    const fill = el.b === 'arr' ? `()=>${arrayInit(el, null, d)}` : `()=>${zeroOf(el)}`;
    return `$.arr([${codes.join(',')}],${n ? n.c : codes.length},${fill},${d.line})`;
  }
  function declCode(d, global) {
    let ty = d.ty;
    if (ty.b === 'void') err(d, `variable '${d.name}' declared void`);
    let code;
    if (ty.b === 'any') { if (!d.init) err(d, `declaration of 'auto ${d.name}' has no initializer`); const x = E(d.init); ty = { ...x.t, lit: false }; code = x.c; }
    else if (ty.b === 'obj') {
      if (d.init) { const x = E(d.init); if (x.t.b !== 'obj' || x.t.cls !== ty.cls) err(d, `conversion from '${tname(x.t)}' to '${ty.cls}' requested`); code = x.c; }
      else code = `$.make(${JSON.stringify(ty.cls)},[${(d.ctor || []).map((a) => E(a).c).join(',')}],${d.line})`;
    } else if (ty.b === 'arr' && !ty.ptr) code = arrayInit(ty, d.init, d);
    else if (ty.b === 'arr') { if (!d.init) code = 'null'; else { const x = E(d.init); if (x.t.b !== 'arr') err(d, `cannot convert '${tname(x.t)}' to '${tname(ty)}'`); code = x.c; } }
    else if (d.init) { if (d.init.k === 'init') err(d, 'a brace list {…} needs an array'); const x = E(d.init); checkAssign(d, ty, x.t); code = coerce(x.c, x.t, ty); }
    else code = zeroOf(ty);
    if (ty.cst && !d.init && ty.b !== 'obj' && ty.b !== 'arr') err(d, `uninitialized const '${d.name}'`);
    const v = declare(d, d.name, { ...ty, lit: false });
    if (!global && d.ty.st) { gl.push(v.js, `${v.js}$i`); return `if(${v.js}$i===undefined){${v.js}$i=1;${v.js}=${code};}`; }
    return global ? `${v.js}=${code};` : `let ${v.js}=${code};`;
  }

  // ---- program
  const out = [], gl = [], ginit = [];
  const fnOrder = [];
  for (const it of ast) {
    if (it.k === 'decl') for (const d of it.decls) { ginit.push(`$.l=${d.line};${declCode(d, true)}`); gl.push(lookup(d.name).js); }
    if (it.k === 'func') {
      // compile functions in source order so globals declared later are not yet visible (like C++)
      fnOrder.push([it, new Map(globals)]);
    }
  }
  for (const [fn, visible] of fnOrder) {
    curFn = fn;
    tmpN = 0; maxTmp = 0;
    scopes = [visible, new Map()];
    if ((fn.name === 'setup' || fn.name === 'loop') && fn.params.length) throw new CompileError(fn.line, `${fn.name}() takes no parameters`);
    const ps = fn.params.map((pp, i) => declare({ line: fn.line }, pp.name || `$p${i}`, pp.ty).js);
    const body = [];
    S(fn.body, body, 1);
    const tmps = maxTmp ? `  let ${Array.from({ length: maxTmp }, (_, i) => `$t${i}`).join(',')};\n` : '';
    out.push(`function* F_${fn.name}(${ps.join(',')}){\n${tmps}${body.join('\n')}\n}`);
  }
  const js = `"use strict";\n${gl.length ? `let ${gl.join(',')};\n` : ''}${out.join('\n')}\nreturn {init:function*(){let $t0,$t1,$t2,$t3,$t4,$t5;${ginit.join('\n')}}, setup:F_setup, loop:F_loop};`;
  let factory;
  try { factory = new Function('$', js); } catch (e) { throw new CompileError(1, `internal compiler error (${e.message}) — please report this sketch.`); }
  return { js, factory, includes, funcs: [...funcs.keys()] };
}
