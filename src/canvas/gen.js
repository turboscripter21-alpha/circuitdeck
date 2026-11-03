// Canvas mode · "Generate starter code from my wiring": looks at which part pins reach which
// GPIOs of one board (directly or through a resistor) and writes a small program that uses them.
import { PARTS } from '../core/parts.js';

// part pin -> the board pins (names like 'GPIO17', 'GND@6') on the same net, resistors passed through
export function wiringOf(model, bid) {
  const parent = new Map();
  const find = (x) => { while (parent.has(x) && parent.get(x) !== x) x = parent.get(x); return x; };
  const join = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); if (!parent.has(rb)) parent.set(rb, rb); };
  for (const w of model.wires) join(w.a, w.b);
  for (const p of model.parts) if (p.type === 'resistor') join(`${p.id}.1`, `${p.id}.2`);
  const boardRefs = new Map();
  for (const w of model.wires) for (const r of [w.a, w.b]) if (r.startsWith(`${bid}:`)) { const k = find(r); (boardRefs.get(k) || boardRefs.set(k, new Set()).get(k)).add(r.slice(bid.length + 1)); }
  const at = (ref) => [...(boardRefs.get(find(ref)) || [])];
  const gpio = (ref) => { const g = at(ref).find((x) => /^GPIO\d+$/.test(x)); return g ? +g.slice(4) : null; };
  return { at, gpio };
}

const cap = (s) => s.replace(/[^A-Za-z0-9]/g, '_');
export function generateFromWiring(model, bid) {
  const b = model.boards.find((x) => x.id === bid);
  if (!b) return null;
  const { gpio } = wiringOf(model, bid);
  const uses = [];
  for (const p of model.parts) {
    if (p.type === 'resistor') continue;
    const pin = (n) => gpio(`${p.id}.${n}`);
    const u = { id: p.id, v: cap(p.id), type: p.type };
    switch (p.type) {
      case 'led': case 'buzzer': if ((u.pin = pin(p.type === 'led' ? 'A' : '+')) != null) uses.push(u); break;
      case 'relay': if ((u.pin = pin('IN')) != null) uses.push(u); break;
      case 'servo': if ((u.pin = pin('SIG')) != null) uses.push(u); break;
      case 'button': if ((u.pin = pin('1') ?? pin('2')) != null) uses.push(u); break;
      case 'pir': if ((u.pin = pin('OUT')) != null) uses.push(u); break;
      case 'pot': if ((u.pin = pin('W')) != null) uses.push(u); break;
      case 'soil': if ((u.pin = pin('AOUT')) != null) uses.push(u); break;
      case 'mq2': if ((u.pin = pin('AO') ?? pin('DO')) != null) { u.digital = pin('AO') == null; uses.push(u); } break;
      case 'dht22': if ((u.pin = pin('DATA')) != null) uses.push(u); break;
      case 'ring': if ((u.pin = pin('DIN')) != null) uses.push(u); break;
      case 'hcsr04': u.trig = pin('TRIG'); u.echo = pin('ECHO'); if (u.trig != null && u.echo != null) uses.push(u); break;
      case 'rgbled': u.pins = ['R', 'G', 'B'].map(pin); if (u.pins.some((x) => x != null)) uses.push(u); break;
      case 'trafficlight': u.pins = ['R', 'Y', 'G'].map(pin); if (u.pins.some((x) => x != null)) uses.push(u); break;
      case 'oled': case 'lcd1602': if (pin('SDA') != null && pin('SCL') != null) { u.sda = pin('SDA'); u.scl = pin('SCL'); uses.push(u); } break;
      default: {
        const any = PARTS[p.type].pins.map((d) => [d.n, gpio(`${p.id}.${d.n}`)]).filter(([, g]) => g != null);
        if (any.length) uses.push({ ...u, other: any });
      }
    }
  }
  if (b.lang === 'cpp') return { file: 'sketch.ino', code: cpp(b, uses) };
  return { file: 'main.py', code: b.type === 'pi5' ? pi(uses) : mpy(uses) };
}

function cpp(b, uses) {
  const inc = new Set(), glob = [], setup = ['  Serial.begin(115200);'], loop = [];
  const outs = [];
  for (const u of uses) {
    const P = `PIN_${u.v.toUpperCase()}`;
    if (u.other) { glob.push(`// ${u.id} (${PARTS[u.type].name}) uses ${u.other.map(([n, g]) => `${n} → GPIO${g}`).join(', ')} — no starter code for it yet`); continue; }
    if (u.pin != null) glob.push(`const int ${P} = ${u.pin};`);
    switch (u.type) {
      case 'led': case 'relay': setup.push(`  pinMode(${P}, OUTPUT);`); outs.push(P); break;
      case 'buzzer': setup.push(`  pinMode(${P}, OUTPUT);`); loop.push(`  tone(${P}, on ? 1000 : 1500, 150);`); break;
      case 'servo': inc.add('ESP32Servo.h'); glob.push(`Servo ${u.v};`); setup.push(`  ${u.v}.attach(${P});`); loop.push(`  ${u.v}.write(on ? 150 : 30);`); break;
      case 'button': setup.push(`  pinMode(${P}, INPUT_PULLUP);`); loop.push(`  if (digitalRead(${P}) == LOW) Serial.println("${u.id} pressed");`); break;
      case 'pir': setup.push(`  pinMode(${P}, INPUT);`); loop.push(`  if (digitalRead(${P}) == HIGH) Serial.println("${u.id}: motion!");`); break;
      case 'pot': case 'soil': case 'mq2': if (u.digital) { setup.push(`  pinMode(${P}, INPUT);`); loop.push(`  Serial.printf("${u.id}: %d\\n", digitalRead(${P}));`); } else loop.push(`  Serial.printf("${u.id}: %d\\n", analogRead(${P}));`); break;
      case 'dht22': inc.add('DHT.h'); glob.push(`DHT ${u.v}(${P}, DHT22);`); setup.push(`  ${u.v}.begin();`); loop.push(`  Serial.printf("${u.id}: %.1f C  %.0f %%\\n", ${u.v}.readTemperature(), ${u.v}.readHumidity());`); break;
      case 'ring': inc.add('Adafruit_NeoPixel.h'); glob.push(`Adafruit_NeoPixel ${u.v}(12, ${P}, NEO_GRB + NEO_KHZ800);`); setup.push(`  ${u.v}.begin();`); loop.push(`  ${u.v}.fill(on ? ${u.v}.Color(0, 80, 255) : ${u.v}.Color(255, 40, 0));`, `  ${u.v}.show();`); break;
      case 'hcsr04': glob.push(`const int TRIG_${u.v.toUpperCase()} = ${u.trig};`, `const int ECHO_${u.v.toUpperCase()} = ${u.echo};`);
        setup.push(`  pinMode(TRIG_${u.v.toUpperCase()}, OUTPUT);`, `  pinMode(ECHO_${u.v.toUpperCase()}, INPUT);`);
        loop.push(`  digitalWrite(TRIG_${u.v.toUpperCase()}, HIGH);`, '  delayMicroseconds(10);', `  digitalWrite(TRIG_${u.v.toUpperCase()}, LOW);`, `  Serial.printf("${u.id}: %.1f cm\\n", pulseIn(ECHO_${u.v.toUpperCase()}, HIGH) / 58.0);`); break;
      case 'rgbled': case 'trafficlight': u.pins.forEach((g, i) => { if (g == null) return; const n = `${P}_${(u.type === 'rgbled' ? 'RGB' : 'RYG')[i]}`; glob.push(`const int ${n} = ${g};`); setup.push(`  pinMode(${n}, OUTPUT);`); outs.push(u.type === 'trafficlight' && i === 1 ? `!${n}` : n); }); break;
      case 'oled': inc.add('Wire.h'); inc.add('Adafruit_SSD1306.h'); glob.push(`Adafruit_SSD1306 ${u.v}(128, 64, &Wire, -1);`); setup.push(`  Wire.begin(${u.sda}, ${u.scl});`, `  ${u.v}.begin(SSD1306_SWITCHCAPVCC, 0x3C);`); loop.push(`  ${u.v}.clearDisplay();`, `  ${u.v}.setTextSize(2);`, `  ${u.v}.setTextColor(SSD1306_WHITE);`, `  ${u.v}.setCursor(0, 0);`, `  ${u.v}.println("Count");`, `  ${u.v}.println(count);`, `  ${u.v}.display();`); break;
      case 'lcd1602': inc.add('Wire.h'); inc.add('LiquidCrystal_I2C.h'); glob.push(`LiquidCrystal_I2C ${u.v}(0x27, 16, 2);`); setup.push(`  Wire.begin(${u.sda}, ${u.scl});`, `  ${u.v}.init();`, `  ${u.v}.backlight();`); loop.push(`  ${u.v}.setCursor(0, 0);`, `  ${u.v}.print("Count: ");`, `  ${u.v}.print(count);`); break;
      default:
    }
  }
  const cleaned = glob.filter((l) => !/= (undefined|null);$/.test(l));
  const outLines = outs.map((P) => (P.startsWith('!') ? `  digitalWrite(${P.slice(1)}, on ? LOW : HIGH);` : `  digitalWrite(${P}, on ? HIGH : LOW);`));
  return `// Generated from the wiring on this ${b.type === 'esp32s3' ? 'ESP32-S3' : 'ESP32'} — edit anything.
${[...inc].map((i) => `#include <${i}>`).join('\n')}${inc.size ? '\n' : ''}
${cleaned.join('\n')}${cleaned.length ? '\n' : ''}bool on = false;
int count = 0;

void setup() {
${setup.join('\n')}
  Serial.println("Ready");
}

void loop() {
  on = !on;
  count++;
${[...outLines, ...loop].join('\n') || '  // nothing wired to a GPIO yet'}
  delay(500);
}
`;
}

function mpy(uses) {
  const imp = new Set(['from machine import Pin', 'import time']), init = [], loop = [], outs = [];
  for (const u of uses) {
    if (u.other) { init.push(`# ${u.id} (${PARTS[u.type].name}) uses ${u.other.map(([n, g]) => `${n} → GPIO${g}`).join(', ')} — no starter code for it yet`); continue; }
    switch (u.type) {
      case 'led': case 'relay': init.push(`${u.v} = Pin(${u.pin}, Pin.OUT)`); outs.push(u.v); break;
      case 'buzzer': imp.add('from machine import Pin, PWM'); init.push(`${u.v} = PWM(Pin(${u.pin}), freq=1000, duty=0)`); loop.push(`${u.v}.freq(1000 if on else 1500)`, `${u.v}.duty(512)`, 'time.sleep(0.15)', `${u.v}.duty(0)`); break;
      case 'servo': imp.add('from machine import Pin, PWM'); init.push(`${u.v} = PWM(Pin(${u.pin}), freq=50)`); loop.push(`${u.v}.duty(${'115 if on else 40'})  # 40..115 ≈ 0..180°`); break;
      case 'button': init.push(`${u.v} = Pin(${u.pin}, Pin.IN, Pin.PULL_UP)`); loop.push(`if ${u.v}.value() == 0:`, `    print("${u.id} pressed")`); break;
      case 'pir': init.push(`${u.v} = Pin(${u.pin}, Pin.IN)`); loop.push(`if ${u.v}.value():`, `    print("${u.id}: motion!")`); break;
      case 'pot': case 'soil': case 'mq2': if (u.digital) { init.push(`${u.v} = Pin(${u.pin}, Pin.IN)`); loop.push(`print("${u.id}:", ${u.v}.value())`); } else { imp.add('from machine import Pin, ADC'); init.push(`${u.v} = ADC(Pin(${u.pin}))`, `${u.v}.atten(ADC.ATTN_11DB)`); loop.push(`print("${u.id}:", ${u.v}.read())`); } break;
      case 'dht22': imp.add('import dht'); init.push(`${u.v} = dht.DHT22(Pin(${u.pin}))`); loop.push(`${u.v}.measure()`, `print("${u.id}:", ${u.v}.temperature(), "C", ${u.v}.humidity(), "%")`); break;
      case 'ring': imp.add('import neopixel'); init.push(`${u.v} = neopixel.NeoPixel(Pin(${u.pin}), 12)`); loop.push(`${u.v}.fill((0, 80, 255) if on else (255, 40, 0))`, `${u.v}.write()`); break;
      case 'hcsr04': imp.add('from machine import Pin, time_pulse_us'); init.push(`${u.v}_trig = Pin(${u.trig}, Pin.OUT)`, `${u.v}_echo = Pin(${u.echo}, Pin.IN)`); loop.push(`${u.v}_trig.value(1)`, 'time.sleep_us(10)', `${u.v}_trig.value(0)`, `print("${u.id}:", time_pulse_us(${u.v}_echo, 1) / 58, "cm")`); break;
      case 'rgbled': case 'trafficlight': u.pins.forEach((g, i) => { if (g == null) return; const n = `${u.v}_${(u.type === 'rgbled' ? 'rgb' : 'ryg')[i]}`; init.push(`${n} = Pin(${g}, Pin.OUT)`); outs.push(u.type === 'trafficlight' && i === 1 ? `!${n}` : n); }); break;
      case 'oled': imp.add('from machine import Pin, SoftI2C'); imp.add('import ssd1306'); init.push(`${u.v} = ssd1306.SSD1306_I2C(128, 64, SoftI2C(scl=Pin(${u.scl}), sda=Pin(${u.sda})))`); loop.push(`${u.v}.fill(0)`, `${u.v}.text("Count", 0, 0)`, `${u.v}.text(str(count), 0, 16)`, `${u.v}.show()`); break;
      case 'lcd1602': imp.add('from machine import Pin, SoftI2C'); imp.add('from i2c_lcd import I2cLcd'); init.push(`${u.v} = I2cLcd(SoftI2C(scl=Pin(${u.scl}), sda=Pin(${u.sda})), 0x27, 2, 16)`); loop.push(`${u.v}.move_to(0, 0)`, `${u.v}.putstr("Count: " + str(count))`); break;
      default:
    }
  }
  const body = [...outs.map((n) => (n.startsWith('!') ? `${n.slice(1)}.value(0 if on else 1)` : `${n}.value(1 if on else 0)`)), ...loop];
  return `# Generated from the wiring on this board (MicroPython) — edit anything.
${[...imp].join('\n')}

${init.join('\n')}${init.length ? '\n' : ''}on = False
count = 0
print("Ready")
while True:
    on = not on
    count += 1
${(body.length ? body : ['pass  # nothing wired to a GPIO yet']).map((l) => `    ${l}`).join('\n')}
    time.sleep(0.5)
`;
}

function pi(uses) {
  const cls = new Set(), init = [], loop = [], cb = [], outs = [];
  let extra = '';
  for (const u of uses) {
    if (u.other) { init.push(`# ${u.id} (${PARTS[u.type].name}) uses ${u.other.map(([n, g]) => `${n} → GPIO${g}`).join(', ')} — no starter code for it yet`); continue; }
    switch (u.type) {
      case 'led': cls.add('LED'); init.push(`${u.v} = LED(${u.pin})`); outs.push(u.v); break;
      case 'relay': cls.add('OutputDevice'); init.push(`${u.v} = OutputDevice(${u.pin})`); outs.push(u.v); break;
      case 'buzzer': cls.add('TonalBuzzer'); extra = 'from gpiozero.tones import Tone\n'; init.push(`${u.v} = TonalBuzzer(${u.pin})`); loop.push(`${u.v}.play(Tone(frequency=880 if on else 660))`, 'sleep(0.15)', `${u.v}.stop()`); break;
      case 'servo': cls.add('AngularServo'); init.push(`${u.v} = AngularServo(${u.pin}, min_angle=-90, max_angle=90)`); loop.push(`${u.v}.angle = 60 if on else -60`); break;
      case 'button': cls.add('Button'); init.push(`${u.v} = Button(${u.pin})`); cb.push(`${u.v}.when_pressed = lambda: print("${u.id} pressed")`); break;
      case 'pir': cls.add('MotionSensor'); init.push(`${u.v} = MotionSensor(${u.pin})`); cb.push(`${u.v}.when_motion = lambda: print("${u.id}: motion!")`); break;
      case 'hcsr04': cls.add('DistanceSensor'); init.push(`${u.v} = DistanceSensor(echo=${u.echo}, trigger=${u.trig})`); loop.push(`print("${u.id}:", round(${u.v}.distance * 100, 1), "cm")`); break;
      case 'rgbled': if (u.pins.every((g) => g != null)) { cls.add('RGBLED'); init.push(`${u.v} = RGBLED(${u.pins.join(', ')})`); loop.push(`${u.v}.color = (0, 0.3, 1) if on else (1, 0.2, 0)`); } break;
      case 'trafficlight': if (u.pins.every((g) => g != null)) { cls.add('TrafficLights'); init.push(`${u.v} = TrafficLights(${u.pins.join(', ')})`); loop.push(`${u.v}.value = (1, 0, 0) if on else (0, 0, 1)`); } break;
      case 'pot': case 'soil': case 'mq2': init.push(`# ${u.id} is analog — the Pi has no ADC; read it through an MCP3008`); break;
      default: init.push(`# ${u.id} (${PARTS[u.type].name}) on GPIO${u.pin ?? u.sda} — see the APIs tab for what the canvas supports`);
    }
  }
  const body = [...outs.map((n) => `${n}.value = 1 if on else 0`), ...loop];
  return `# Generated from the wiring on this Pi 5 (gpiozero) — edit anything.
${cls.size ? `from gpiozero import ${[...cls].join(', ')}\n` : ''}${extra}from time import sleep

${init.join('\n')}${init.length ? '\n' : ''}${cb.join('\n')}${cb.length ? '\n' : ''}on = False
print("Ready")
while True:
    on = not on
${(body.length ? body : ['pass  # nothing wired to a GPIO yet']).map((l) => `    ${l}`).join('\n')}
    sleep(0.5)
`;
}
