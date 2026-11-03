// M11: Canvas mode end-to-end. node m11-canvas.mjs  (BASE=http://127.0.0.1:8080 by default; SHOTS=dir)
import { chromium } from 'playwright';
import fs from 'fs';
const BASE = process.env.BASE || 'http://127.0.0.1:8080';
const SHOTS = process.env.SHOTS || '/tmp/m11-shots';
fs.mkdirSync(SHOTS, { recursive: true });
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const R = []; let fails = 0;
const ok = (name, cond, info = '') => { R.push(`${cond ? 'PASS' : 'FAIL'} ${name}${info ? ` — ${info}` : ''}`); if (!cond) fails++; console.log(R.at(-1)); };
const errs = [];
async function page(opts = {}, dark = false) {
  const c = await b.newContext({ viewport: { width: 1600, height: 900 }, ...opts });
  if (dark) await c.addInitScript(() => localStorage.setItem('circuitdeck:theme', 'dark'));
  await c.route(() => true, (r) => { const u = r.request().url(); if (u.startsWith(BASE) || /^(blob|data):/.test(u)) return r.continue(); return r.abort(); });
  const p = await c.newPage();
  p.on('pageerror', (e) => errs.push(`pageerror ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error' && !/ai\/(status|chat)|api\//.test(m.text())) errs.push(`console ${m.text()}`); });
  p.on('dialog', (d) => d.accept(d.type() === 'prompt' ? (d.defaultValue() || 'x') : undefined));
  return p;
}
const ready = (p) => p.waitForFunction(() => window.__cv && !document.documentElement.classList.contains('is-loading'), null, { timeout: 60000 });
const W = (p, ms) => p.waitForTimeout(ms);
// wait (up to 6 s on a slow software-GL box) until the part has reported an active state
const settle = (p, id) => p.waitForFunction((id) => { const s = __cv.partState[id]; return s && (s.on || s.angle != null || s.speed); }, id, { timeout: 6000 }).catch(() => {});
// build a circuit on a blank canvas: board + parts + wires + code
async function build(p, { board, lang, parts, wires, code }) {
  return p.evaluate(({ board, lang, parts, wires, code }) => {
    __cv.loadStarter('blank');
    __cv.addBoard(board, lang);
    const ids = parts.map((t) => __cv.addPart(t));
    const ref = (s) => s.replace(/\$(\d)/g, (_, i) => ids[+i]);
    for (const [a, c] of wires) __cv.addWire(ref(a), ref(c));
    __cv.showBoard('b1'); __cv.setCode(code);
    return { ids, wires: __cv.model.wires.length, issues: __cv.issues.filter((i) => i.sev === 'error').map((i) => i.msg) };
  }, { board, lang, parts, wires, code });
}
const ps = (p, id) => p.evaluate((id) => __cv.partState[id] || null, id);
async function sample(p, id, key, n = 12, gap = 150) { const seen = new Set(); for (let i = 0; i < n; i++) { const s = await ps(p, id); seen.add(JSON.stringify(s?.[key] ?? null)); await W(p, gap); } return [...seen]; }

const p = await page();
await p.goto(`${BASE}/canvas/`, { waitUntil: 'load' }); await ready(p);
ok('page loads with ESP32 starter', await p.evaluate(() => __cv.model.boards.length === 1 && __cv.model.parts.length === 2));
ok('track switcher has Canvas active', await p.evaluate(() => document.querySelector('.cd-tracks a[aria-current=page], .cd-tracks a.is-on')?.textContent.trim() === 'Canvas'));
ok('AI context is canvas', await p.evaluate(() => __cdAIContext().track === 'canvas' && __cdAIContext().code.includes('LED_PIN')));

// ---------------- ESP32 (Arduino C++)
let r = await build(p, { board: 'esp32', lang: 'cpp', parts: ['resistor', 'led'], wires: [['b1:GPIO26', '$0.1'], ['$0.2', '$1.A'], ['$1.K', 'b1:GND@14']],
  code: 'void setup(){ Serial.begin(115200); pinMode(26, OUTPUT); Serial.println("boot ok"); }\nvoid loop(){ digitalWrite(26, HIGH); delay(250); digitalWrite(26, LOW); delay(250); }\n' });
await p.evaluate(() => __cv.start()); await W(p, 400);
let seen = await sample(p, r.ids[1], 'on');
ok('ESP32 C++ blink toggles the LED', seen.includes('1') && seen.includes('0'), seen.join(','));
ok('ESP32 serial output', (await p.evaluate(() => __cv.console)).includes('boot ok'));
await p.evaluate(() => __cv.stop());

r = await build(p, { board: 'esp32', lang: 'cpp', parts: ['button', 'resistor', 'led'], wires: [['b1:GPIO4', '$0.1'], ['$0.2', 'b1:GND@14'], ['b1:GPIO26', '$1.1'], ['$1.2', '$2.A'], ['$2.K', 'b1:GND@29']],
  code: 'void setup(){ pinMode(4, INPUT_PULLUP); pinMode(26, OUTPUT); }\nvoid loop(){ digitalWrite(26, digitalRead(4) == LOW ? HIGH : LOW); delay(10); }\n' });
await p.evaluate(() => __cv.start()); await W(p, 500);
const offB = (await ps(p, r.ids[2]))?.on;
await p.evaluate((id) => __cv.setInput(id, { pressed: true }), r.ids[0]); await W(p, 500);
const onB = (await ps(p, r.ids[2]))?.on;
ok('ESP32 button drives LED', offB === 0 && onB === 1, `${offB}->${onB}`);
await p.evaluate(() => __cv.stop());

r = await build(p, { board: 'esp32', lang: 'cpp', parts: ['buzzer'], wires: [['b1:GPIO25', '$0.+'], ['$0.-', 'b1:GND@14']],
  code: 'void setup(){ tone(25, 1000); }\nvoid loop(){ delay(100); }\n' });
await p.evaluate(() => __cv.start()); await W(p, 700);
await settle(p, r.ids[0]);
let st = await ps(p, r.ids[0]);
ok('ESP32 buzzer tone', st?.on && st.freq === 1000, JSON.stringify(st));
await p.evaluate(() => __cv.stop());

r = await build(p, { board: 'esp32', lang: 'cpp', parts: ['servo'], wires: [['b1:GPIO13', '$0.SIG'], ['$0.V+', 'b1:VIN'], ['$0.GND', 'b1:GND@14']],
  code: '#include <ESP32Servo.h>\nServo s;\nvoid setup(){ s.attach(13); s.write(150); }\nvoid loop(){}\n' });
await p.evaluate(() => __cv.start()); await W(p, 800);
await settle(p, r.ids[0]);
st = await ps(p, r.ids[0]);
ok('ESP32 servo angle', st && Math.abs(st.angle - 60) < 3, JSON.stringify(st));
await p.screenshot({ path: `${SHOTS}/servo-esp32.png` });
await p.evaluate(() => __cv.stop());

// outputs: relay + motor + LCD + OLED on one ESP32
r = await build(p, { board: 'esp32', lang: 'cpp', parts: ['lcd1602', 'oled', 'relay'],
  wires: [['$0.SDA', 'b1:GPIO21'], ['$0.SCL', 'b1:GPIO22'], ['$0.VCC', 'b1:3V3@30'], ['$0.GND', 'b1:GND@14'], ['$1.SDA', 'b1:GPIO21'], ['$1.SCL', 'b1:GPIO22'], ['$1.VCC', 'b1:3V3@30'], ['$1.GND', 'b1:GND@29'], ['$2.IN', 'b1:GPIO27'], ['$2.VCC', 'b1:VIN'], ['$2.GND', 'b1:GND@14']],
  code: '#include <Wire.h>\n#include <LiquidCrystal_I2C.h>\n#include <Adafruit_SSD1306.h>\nLiquidCrystal_I2C lcd(0x27, 16, 2);\nAdafruit_SSD1306 oled(128, 64, &Wire, -1);\nvoid setup(){ lcd.init(); lcd.backlight(); lcd.print("Hello LCD"); oled.begin(SSD1306_SWITCHCAPVCC, 0x3C); oled.clearDisplay(); oled.setTextSize(1); oled.setTextColor(SSD1306_WHITE); oled.setCursor(0,0); oled.print("Hi OLED"); oled.drawRect(0,20,40,20,SSD1306_WHITE); oled.display(); pinMode(27, OUTPUT); digitalWrite(27, HIGH); }\nvoid loop(){ delay(50); }\n' });
ok('outputs circuit wires cleanly', !r.issues.length, r.issues.join(' | '));
await p.evaluate(() => __cv.start()); await W(p, 900);
const scr = await p.evaluate((ids) => ({ lcd: __cv.screens[ids[0]], oled: __cv.screens[ids[1]], relay: __cv.partState[ids[2]], err: __cv.error }), r.ids);
ok('LCD shows text', scr.lcd?.lines?.[0]?.includes('Hello LCD'), JSON.stringify(scr.lcd || scr.err));
ok('OLED draws', scr.oled && JSON.stringify(scr.oled).includes('Hi OLED'), JSON.stringify(scr.oled || scr.err).slice(0, 160));
ok('relay switches', scr.relay?.on === true, JSON.stringify(scr.relay));
await p.screenshot({ path: `${SHOTS}/outputs.png` });
await p.evaluate(() => __cv.stop());

// ---------------- Pi 5 (Python)
r = await build(p, { board: 'pi5', lang: 'py', parts: ['resistor', 'led'], wires: [['b1:GPIO17', '$0.1'], ['$0.2', '$1.A'], ['$1.K', 'b1:GND@6']],
  code: 'from gpiozero import LED\nfrom time import sleep\nled = LED(17)\nprint("pi up")\nwhile True:\n    led.toggle()\n    sleep(0.25)\n' });
await p.evaluate(() => __cv.start()); await W(p, 400);
seen = await sample(p, r.ids[1], 'on');
ok('Pi 5 gpiozero blink', seen.includes('1') && seen.includes('0'), seen.join(','));
ok('Pi 5 print output', (await p.evaluate(() => __cv.console)).includes('pi up'));
await p.evaluate(() => __cv.stop());

r = await build(p, { board: 'pi5', lang: 'py', parts: ['button', 'resistor', 'led'], wires: [['b1:GPIO27', '$0.1'], ['$0.2', 'b1:GND@6'], ['b1:GPIO17', '$1.1'], ['$1.2', '$2.A'], ['$2.K', 'b1:GND@9']],
  code: 'import RPi.GPIO as GPIO\nimport time\nGPIO.setmode(GPIO.BCM)\nGPIO.setup(27, GPIO.IN, pull_up_down=GPIO.PUD_UP)\nGPIO.setup(17, GPIO.OUT)\nwhile True:\n    GPIO.output(17, GPIO.input(27) == GPIO.LOW)\n    time.sleep(0.01)\n' });
await p.evaluate(() => __cv.start()); await W(p, 500);
const offP = (await ps(p, r.ids[2]))?.on;
await p.evaluate((id) => __cv.setInput(id, { pressed: true }), r.ids[0]);
await p.waitForFunction((id) => __cv.partState[id]?.on === 1, r.ids[2], { timeout: 6000 }).catch(() => {});
const onP = (await ps(p, r.ids[2]))?.on;
ok('Pi 5 RPi.GPIO button drives LED', !offP && onP === 1, `${offP}->${onP}`);
await p.evaluate(() => __cv.stop());

r = await build(p, { board: 'pi5', lang: 'py', parts: ['buzzer'], wires: [['b1:GPIO18', '$0.+'], ['$0.-', 'b1:GND@6']],
  code: 'from gpiozero import TonalBuzzer\nfrom signal import pause\nb = TonalBuzzer(18)\nb.play(880)\npause()\n' });
await p.evaluate(() => __cv.start()); await W(p, 700);
await settle(p, r.ids[0]);
st = await ps(p, r.ids[0]);
ok('Pi 5 TonalBuzzer', st?.on && Math.abs(st.freq - 880) < 2, JSON.stringify(st));
await p.evaluate(() => __cv.stop());

r = await build(p, { board: 'pi5', lang: 'py', parts: ['servo'], wires: [['b1:GPIO12', '$0.SIG'], ['$0.V+', 'b1:5V@2'], ['$0.GND', 'b1:GND@6']],
  code: 'from gpiozero import AngularServo\nfrom signal import pause\ns = AngularServo(12, min_angle=-90, max_angle=90, min_pulse_width=0.5/1000, max_pulse_width=2.5/1000)\ns.angle = 45\npause()\n' });
await p.evaluate(() => __cv.start()); await W(p, 800);
await settle(p, r.ids[0]);
st = await ps(p, r.ids[0]);
ok('Pi 5 servo angle', st && Math.abs(Math.abs(st.angle) - 45) < 3, JSON.stringify(st));
await p.evaluate(() => __cv.stop());

// ---------------- MicroPython + sensor input
r = await build(p, { board: 'esp32', lang: 'py', parts: ['pot'], wires: [['$0.1', 'b1:GND@14'], ['$0.3', 'b1:3V3@30'], ['$0.W', 'b1:GPIO34']],
  code: 'from machine import Pin, ADC\nimport time\nadc = ADC(Pin(34))\nadc.atten(ADC.ATTN_11DB)\nwhile True:\n    print("pot", adc.read())\n    time.sleep(0.2)\n' });
await p.evaluate(() => __cv.start()); await W(p, 500);
await p.evaluate((id) => __cv.setInput(id, { value: 1 }), r.ids[0]);
await p.waitForFunction(() => /pot (3[5-9]|40)\d\d\s*$/.test(__cv.console), null, { timeout: 8000 }).catch(() => {});
const con = await p.evaluate(() => __cv.console);
const last = +(con.trim().split('\n').at(-1).match(/pot (\d+)/)?.[1] ?? -1);
ok('MicroPython ADC follows the pot input', last > 3500, `last=${last}`);
ok('inputs panel shows the pot', await p.evaluate(() => !!document.querySelector('#cd-panel input[type=range]')));
await p.evaluate(() => __cv.stop());

// ---------------- errors with line numbers, never a crash
async function errOf(board, lang, code) {
  await p.evaluate(({ board, lang, code }) => { __cv.loadStarter('blank'); __cv.addBoard(board, lang); __cv.showBoard('b1'); __cv.setCode(code); __cv.start(); }, { board, lang, code });
  await p.waitForFunction(() => __cv.error, null, { timeout: 6000 }).catch(() => {});
  const e = await p.evaluate(() => ({ e: __cv.error, running: __cv.running, bar: document.querySelector('.cv-errbar:not([hidden])')?.textContent || '' }));
  await p.evaluate(() => __cv.stop());
  return e;
}
let e = await errOf('esp32', 'cpp', 'void setup(){\n  Serial.begin(9600);\n  WiFi.begin("a", "b");\n}\nvoid loop(){}\n');
ok('C++ unsupported API → line 3', e.e?.line === 3 && /WiFi|Wi-Fi/.test(e.e.msg) && e.bar.includes('3'), JSON.stringify(e.e));
e = await errOf('esp32', 'cpp', 'void setup(){\n  int x = 1\n}\nvoid loop(){}\n');
ok('C++ syntax error has a line', e.e?.kind === 'compile' && e.e.line >= 2 && e.e.line <= 3, JSON.stringify(e.e));
e = await errOf('esp32', 'py', 'import time\nimport network\nwlan = network.WLAN()\n');
ok('MicroPython unsupported module → line 2', e.e?.line === 2, JSON.stringify(e.e));
e = await errOf('pi5', 'py', 'from gpiozero import LED\nled = LED(17)\nx = 1\nled.flash_wildly()\n');
ok('Pi runtime error → line 4', e.e?.line === 4 && e.e.kind === 'runtime', JSON.stringify(e.e));
e = await errOf('pi5', 'py', 'import time\nprint(undefined_name)\n');
ok('Pi NameError → line 2', e.e?.line === 2, JSON.stringify(e.e));
ok('page still alive after errors', await p.evaluate(() => typeof __cv.start === 'function' && !__cv.running));

// ---------------- generate code from wiring
await p.evaluate(() => { __cv.loadStarter('esp32'); }); await W(p, 200);
await p.evaluate(() => { __cv.setCode('// empty\nvoid setup(){}\nvoid loop(){}\n'); __cv.genCode(); });
const gen = await p.evaluate(() => __cv.model.files.b1[0].code);
ok('generate code from wiring', /26/.test(gen) && /pinMode/.test(gen), gen.slice(0, 80).replace(/\n/g, ' '));
await p.evaluate(() => __cv.start()); await W(p, 1600);
seen = await sample(p, 'led1', 'on', 30, 150);
ok('generated code runs', seen.includes('1'), seen.join(','));
await p.evaluate(() => __cv.stop());

// ---------------- undo / redo, copy/paste, keyboard, UI add part + wiring tab
await p.evaluate(() => __cv.loadStarter('esp32'));
const n0 = await p.evaluate(() => __cv.model.parts.length);
await p.click('[data-nav=parts]'); await W(p, 300);
await p.click('#flyout [data-add=buzzer]'); await W(p, 300);
const n1 = await p.evaluate(() => __cv.model.parts.length);
ok('add part from the Components flyout', n1 === n0 + 1);
await p.keyboard.press('Escape'); await p.mouse.click(5, 880); await W(p, 100);
await p.evaluate(() => document.activeElement?.blur());
await p.keyboard.press('Control+z'); await W(p, 200);
ok('Ctrl+Z undoes the add', (await p.evaluate(() => __cv.model.parts.length)) === n0);
await p.keyboard.press('Control+Shift+z'); await W(p, 200);
ok('Ctrl+Shift+Z redoes it', (await p.evaluate(() => __cv.model.parts.length)) === n1);
await p.evaluate(() => __cv.select('part', 'led1')); await p.keyboard.press('Control+d'); await W(p, 200);
ok('Ctrl+D duplicates', (await p.evaluate(() => __cv.model.parts.length)) === n1 + 1);
await p.keyboard.press('Delete'); await W(p, 200);
ok('Delete removes the selection', (await p.evaluate(() => __cv.model.parts.length)) === n1);
await p.evaluate(() => __cv.select('part', 'led1')); await p.keyboard.press(']'); await W(p, 100);
ok('] rotates', (await p.evaluate(() => __cv.model.parts.find((x) => x.id === 'led1').rot)) === 90);
await p.evaluate(() => { __cv.select('part', 'r1'); __cv.copySel(); __cv.paste(); });
ok('copy + paste', (await p.evaluate(() => __cv.model.parts.length)) === n1 + 1);
const w0 = await p.evaluate(() => __cv.model.wires.length);
await p.click('.info-card [role=tab]:nth-child(2)'); await W(p, 200);
const bz = await p.evaluate(() => __cv.model.parts.find((x) => x.type === 'buzzer').id);
await p.selectOption('[data-w=a]', 'b1:GPIO25'); await p.selectOption('[data-w=b]', `${bz}.+`);
await p.click('[data-act=addwire]'); await W(p, 200);
ok('Wiring tab adds a wire (any pin to any pin)', (await p.evaluate(() => __cv.model.wires.length)) === w0 + 1);
await p.click('.info-card [role=tab]:nth-child(3)'); await W(p, 200);
ok('Checks tab renders', await p.evaluate(() => /Checks/.test(document.querySelector('.info-content').textContent)));
await p.click('.info-card [role=tab]:nth-child(4)'); await W(p, 200);
ok('APIs tab lists supported calls', await p.evaluate(() => /digitalWrite/.test(document.querySelector('.cv-apis')?.textContent || '')));
// file tabs
await p.evaluate(() => __cv.showBoard('b1'));
const tabsN = await p.evaluate(() => document.querySelectorAll('.code-card [data-file]').length);
await p.click('.code-card [data-addfile]'); await W(p, 200);
ok('add a file tab', (await p.evaluate(() => document.querySelectorAll('.code-card [data-file]').length)) === tabsN + 1);

// ---------------- save / load / share / export roundtrip
await p.evaluate(() => { __cv.loadStarter('multi'); __cv.model.name = 'Roundtrip test'; });
await p.evaluate(() => __cv.setCode('// roundtrip marker\nvoid setup(){ Serial.begin(115200); Serial.println("rt"); }\nvoid loop(){}\n'));
const snap = await p.evaluate(() => JSON.stringify(__cv.M.serialize(__cv.model)));
const url = await p.evaluate(() => __cv.share());
ok('share link created', /#[cj]=/.test(url), `${url.length} chars`);
await p.evaluate(() => __cv.saveNamed()); await W(p, 600);
// park the main page while other pages load (two live WebGL pages starve each other under SwiftShader)
await p.goto('about:blank');
const p2 = await page();
await p2.goto(url, { waitUntil: 'commit' }); await ready(p2);
const snap2 = await p2.evaluate(() => JSON.stringify(__cv.M.serialize(__cv.model)));
const diffAt = [...snap].findIndex((ch, i) => ch !== snap2[i]);
ok('share link roundtrip is identical', snap2.includes('Roundtrip test') && snap2 === snap, diffAt < 0 ? `len ${snap.length} vs ${snap2.length}: ${snap2.slice(snap.length, snap.length + 80)} name=${JSON.parse(snap2).name}` : `differs at ${diffAt}: ${snap.slice(diffAt - 30, diffAt + 40)} ⟂ ${snap2.slice(diffAt - 30, diffAt + 40)}`);
await p2.context().close();
const bad = await page();
await bad.goto(`${BASE}/canvas/#c=garbage!!`, { waitUntil: 'commit' }); await ready(bad);
ok('broken share link shows a notice, not a crash', await bad.evaluate(() => /could not be opened/.test(document.querySelector('.sb-notice')?.textContent || '')));
await bad.context().close();
await p.goto(`${BASE}/canvas/`, { waitUntil: 'load' }); await ready(p);
ok('autosave restores after reload', await p.evaluate(() => __cv.model.name === 'Roundtrip test' && __cv.model.files.b1[0].code.includes('roundtrip marker')));
await p.click('[data-nav=lessons]'); await W(p, 600);
ok('My saves lists the saved canvas', await p.evaluate(() => [...document.querySelectorAll('#flyout [data-load]')].some((x) => x.textContent.includes('Roundtrip test'))));
await p.keyboard.press('Escape');
const exp = await p.evaluate(() => __cv.M.serialize(__cv.model));
await p.evaluate(() => __cv.loadStarter('blank'));
await p.evaluate((j) => __cv.importJSON(j), exp);
ok('JSON export → import roundtrip', (await p.evaluate(() => JSON.stringify(__cv.M.serialize(__cv.model)))) === snap);
await p.evaluate(() => __cv.undo());
ok('undo after import goes back', await p.evaluate(() => __cv.model.boards.length === 0));

// ---------------- multi-board run + screenshot
await p.evaluate(() => __cv.loadStarter('multi')); await W(p, 300);
await p.evaluate(() => __cv.start()); await W(p, 1500);
ok('multi-board run prefixes serial', /\[b1\][\s\S]*\[b2\]|\[b2\][\s\S]*\[b1\]/.test(await p.evaluate(() => __cv.console)));
await p.screenshot({ path: `${SHOTS}/desktop-light.png` });
await p.evaluate(() => __cv.stop());
await p.context().close();

// ---------------- dark + mobile
for (const dark of [false, true]) {
  const m = await page({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, dark);
  await m.goto(`${BASE}/canvas/`, { waitUntil: 'commit' }); await ready(m);
  const lay = await m.evaluate(() => ({ ox: document.documentElement.scrollWidth - document.documentElement.clientWidth, run: !!document.querySelector('.btn-run')?.getBoundingClientRect().width, compact: document.documentElement.classList.contains('compact'), theme: document.documentElement.dataset.theme || 'light' }));
  ok(`mobile ${dark ? 'dark' : 'light'}: no overflow, Run visible`, lay.ox <= 0 && lay.run && lay.compact, JSON.stringify(lay));
  await m.evaluate(() => __cv.start()); await W(m, 1200);
  ok(`mobile ${dark ? 'dark' : 'light'}: runs`, await m.waitForFunction(() => __cv.running && __cv.console.includes('Hello'), null, { timeout: 8000 }).then(() => true, () => false));
  await m.screenshot({ path: `${SHOTS}/mobile-${dark ? 'dark' : 'light'}.png` });
  await m.evaluate(() => __cv.stop());
  await m.context().close();
}
const d = await page({}, true);
await d.goto(`${BASE}/canvas/`, { waitUntil: 'commit' }); await ready(d);
await d.evaluate(() => __cv.loadStarter('pi5')); await d.evaluate(() => __cv.start()); await W(d, 1200);
await d.screenshot({ path: `${SHOTS}/desktop-dark.png` });
await d.context().close();

ok('0 console errors', errs.length === 0, errs.slice(0, 5).join(' | '));
console.log(`\n${R.length - fails}/${R.length} passed`);
await b.close();
process.exit(fails ? 1 : 0);
