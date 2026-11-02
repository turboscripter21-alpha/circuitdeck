// Generates a runnable program from the circuit: gpiozero Python for the Pi 5, Arduino C++ for the ESP32.
// The rules (what follows what) come from roles.js and are mirrored by sim.js.
import { roles } from './roles.js';
import { BUS } from './circuit.js';

export const RULES = {
  tickMs: 100, printEvery: 10, blinkEvery: 5, chirpEvery: 20,
  dark: 30, dry: 30, gas: 50, near: 20, robotNear: 25,
  traffic: { red: 30, green: 30, amber: 10 }, code: '1234', unlockTicks: 30,
  stepsPerTick: 40, stepsPerRev: 4096,
};
const PY_PIN = (n) => (n == null ? 'None  # TODO: wire this pin' : String(n));
const C_PIN = (n) => (n == null ? '-1  /* TODO: wire this pin */' : String(n));

export function generate(c, conn) {
  const R = roles(c, conn);
  return c.board === 'pi5' ? python(c, R) : arduino(c, R);
}

// ---------------------------------------------------------------- Python (Pi 5)
function python(c, R) {
  const T = RULES, v = (p) => R.name(p, 'py');
  const imp = new Map(); const use = (mod, name) => { if (!imp.has(mod)) imp.set(mod, new Set()); if (name) imp.get(mod).add(name); };
  const decl = [], helpers = [], state = [], fast = [], slow = [], out = [], prints = [];
  use('time', 'sleep');
  const ana = (p) => { const a = R.analog(p); if (a.ch != null) { use('gpiozero', 'MCP3008'); return `MCP3008(channel=${a.ch})`; } return 'None  # TODO: wire it to an MCP3008 channel (the Pi 5 has no ADC)'; };

  for (const p of R.leds) { use('gpiozero', 'LED'); decl.push(`${v(p)} = LED(${PY_PIN(R.g(p, 'A'))})  # ${p.opts?.color || 'red'} LED`); }
  for (const p of R.buttons) { use('gpiozero', 'Button'); decl.push(`${v(p)} = Button(${PY_PIN(R.direct(p, '1') ?? R.direct(p, '2'))})  # other leg to GND, internal pull-up`); }
  for (const p of R.buzzers) { use('gpiozero', 'Buzzer'); decl.push(`${v(p)} = Buzzer(${PY_PIN(R.g(p, '+'))})`); }
  for (const p of R.rgbs) { use('gpiozero', 'RGBLED'); decl.push(`${v(p)} = RGBLED(red=${PY_PIN(R.g(p, 'R'))}, green=${PY_PIN(R.g(p, 'G'))}, blue=${PY_PIN(R.g(p, 'B'))})`); }
  for (const p of R.pirs) { use('gpiozero', 'MotionSensor'); decl.push(`${v(p)} = MotionSensor(${PY_PIN(R.g(p, 'OUT'))})`); }
  for (const p of R.sonars) { use('gpiozero', 'DistanceSensor'); decl.push(`${v(p)} = DistanceSensor(echo=${PY_PIN(R.g(p, 'ECHO'))}, trigger=${PY_PIN(R.g(p, 'TRIG'))}, max_distance=4)`); }
  for (const p of R.dhts) { use('board'); use('adafruit_dht'); decl.push(`${v(p)} = adafruit_dht.DHT22(board.D${R.g(p, 'DATA') ?? 4})`); }
  if (R.bmes.length) { use('smbus2', 'SMBus'); use('bme280'); decl.push('bus = SMBus(1)', 'BME_ADDR = 0x76', 'bme_cal = bme280.load_calibration_params(bus, BME_ADDR)'); }
  for (const p of [...R.pots, ...R.ldrs, ...R.soils, ...R.mq2s]) decl.push(`${v(p)} = ${ana(p)}`);
  for (const p of R.oleds) { use('luma.core.interface.serial', 'i2c'); use('luma.core.render', 'canvas'); use('luma.oled.device', 'ssd1306'); decl.push(`${v(p)} = ssd1306(i2c(port=1, address=0x3C))`); }
  for (const p of R.lcds) { use('RPLCD.i2c', 'CharLCD'); decl.push(`${v(p)} = CharLCD('PCF8574', 0x27, cols=16, rows=2)`); }
  for (const p of R.epapers) { use('waveshare_epd', 'epd2in13_V4'); use('PIL', 'Image, ImageDraw'); decl.push(`${v(p)} = epd2in13_V4.EPD()`, `${v(p)}.init()`); }
  for (const p of R.matrices) { use('luma.core.interface.serial', 'spi, noop'); use('luma.led_matrix.device', 'max7219'); use('luma.core.render', 'canvas'); decl.push(`${v(p)} = max7219(spi(port=0, device=0, gpio=noop()), cascaded=1)`); }
  for (const p of R.rings) { use('board'); use('neopixel_spi as neopixel'); decl.push(`${v(p)} = neopixel.NeoPixel_SPI(board.SPI(), 12, brightness=0.3, auto_write=False)  # data on MOSI (GPIO10)`); }
  for (const p of R.servos) { use('gpiozero', 'AngularServo'); decl.push(`${v(p)} = AngularServo(${PY_PIN(R.g(p, 'SIG'))}, min_angle=0, max_angle=180, min_pulse_width=0.0005, max_pulse_width=0.0025)`); }
  for (const m of R.motors) { use('gpiozero', 'Motor'); decl.push(`${v(m.motor)} = Motor(forward=${PY_PIN(m.fwd)}, backward=${PY_PIN(m.back)})  # via DRV8833`); }
  for (const p of R.steppers) { use('gpiozero', 'OutputDevice'); decl.push(`${v(p)}_coils = [OutputDevice(n) for n in (${['IN1', 'IN2', 'IN3', 'IN4'].map((n) => R.g(p, n) ?? 'None').join(', ')})]`); }
  if (R.relay) { use('gpiozero', 'OutputDevice'); decl.push(`${v(R.relay)} = OutputDevice(${PY_PIN(R.g(R.relay, 'IN'))}, active_high=True)  # relay module`); }
  for (const p of R.lights) { use('gpiozero', 'TrafficLights'); decl.push(`${v(p)} = TrafficLights(red=${PY_PIN(R.g(p, 'R'))}, amber=${PY_PIN(R.g(p, 'Y'))}, green=${PY_PIN(R.g(p, 'G'))})`); }
  if (R.keypad) {
    use('gpiozero', 'OutputDevice'); use('gpiozero', 'Button');
    const k = R.keypad;
    decl.push(`rows = [OutputDevice(n, initial_value=True) for n in (${['R1', 'R2', 'R3', 'R4'].map((n) => R.g(k, n) ?? 'None').join(', ')})]`,
      `cols = [Button(n) for n in (${['C1', 'C2', 'C3'].map((n) => R.g(k, n) ?? 'None').join(', ')})]`, 'KEYS = ["123", "456", "789", "*0#"]');
    helpers.push('def read_key():', '    for r, row in enumerate(rows):', '        row.off()  # pull one row low', '        for c, col in enumerate(cols):', '            if col.is_pressed:', '                row.on()', '                while col.is_pressed:', '                    sleep(0.01)', '                return KEYS[r][c]', '        row.on()', '    return None', '');
    state.push('entered = ""', 'unlock_left = 0', 'wrong_left = 0');
  }
  for (const p of R.steppers) helpers.push('SEQ = [[1,0,0,0],[1,1,0,0],[0,1,0,0],[0,1,1,0],[0,0,1,0],[0,0,1,1],[0,0,0,1],[1,0,0,1]]', `def ${v(p)}_step(i):`, `    for coil, on in zip(${v(p)}_coils, SEQ[i % 8]):`, '        coil.value = on', '');
  if (R.cams.length) {
    use('picamera2', 'Picamera2');
    decl.push('cam = Picamera2()');
    if (R.ais.length) { use('picamera2.devices', 'Hailo'); decl.push('hailo = Hailo("/usr/share/hailo-models/yolov8s_h8l.hef")  # AI Kit (Hailo-8L)', 'model_h, model_w, _ = hailo.get_input_shape()', 'cam.configure(cam.create_preview_configuration(lores={"size": (model_w, model_h), "format": "RGB888"}))'); helpers.push('LABELS = open("/usr/share/hailo-models/coco.txt").read().split("\\n")  # adjust to your model', 'def detect():', '    frame = cam.capture_array("lores")', '    found = []', '    for cls, boxes in enumerate(hailo.run(frame)):', '        for box in boxes:', '            if box[4] > 0.5:', '                found.append(LABELS[cls])', '    return found', ''); }
    decl.push('cam.start()');
    state.push('labels = []');
  }
  if (R.coolers.length) { use('gpiozero', 'CPUTemperature'); use('glob'); decl.push('cpu = CPUTemperature()'); helpers.push('def fan_rpm():', '    for f in glob.glob("/sys/devices/platform/cooling_fan/hwmon/*/fan1_input"):', '        return int(open(f).read())', '    return 0', ''); }

  // ---- the loop body
  const reads = R.readings;
  if (reads.length) state.push(...[...new Set(reads.map((r) => `${r.key}_${v(r.p)}`))].map((n) => `${n} = 0`));
  for (const r of reads) {
    const n = `${r.key}_${v(r.p)}`, p = v(r.p);
    const line = {
      distance: `${n} = ${p}.distance * 100`,
      temp: r.p.type === 'dht22' ? `${n} = ${p}.temperature or ${n}` : `${n} = bme280.sample(bus, BME_ADDR, bme_cal).temperature`,
      hum: r.p.type === 'dht22' ? `${n} = ${p}.humidity or ${n}` : `${n} = bme280.sample(bus, BME_ADDR, bme_cal).humidity`,
      pressure: `${n} = bme280.sample(bus, BME_ADDR, bme_cal).pressure`,
      value: `${n} = ${p}.value * 100`, light: `${n} = ${p}.value * 100`,
      moisture: `${n} = (1 - ${p}.value) * 100  # capacitive probe: wetter = lower voltage`, gas: `${n} = ${p}.value * 100`,
    }[r.key];
    (r.p.type === 'dht22' || r.p.type === 'bme280' ? slow : fast).push(line);
  }
  if (R.coolers.length) slow.push(`print(f"CPU {cpu.temperature:.1f} °C  fan {fan_rpm()} rpm")`);
  const first = (key) => reads.find((r) => r.key === key);
  const rv = (key) => { const r = first(key); return r ? `${r.key}_${v(r.p)}` : null; };
  // trigger
  let trig = null;
  if (R.hasTrigger) {
    const parts = [...R.buttons.map((b) => `${v(b)}.is_pressed`), ...R.pirs.map((p) => `${v(p)}.motion_detected`)];
    fast.push(`trigger = ${parts.join(' or ')}`); trig = 'trigger'; state.push('was_triggered = False');
    fast.push('if trigger and not was_triggered:', `    print("${R.pirs.length ? 'Motion detected!' : 'Button pressed'}")`, 'was_triggered = trigger');
  }
  if (R.ais.length) slow.push('labels = detect()', 'if labels:', '    print("Detected:", ", ".join(sorted(set(labels))))');
  else if (R.cams.length) out.push(`if tick % 50 == 0:`, `    cam.capture_file(f"capture-{tick // 50}.jpg")`, `    print(f"Saved capture-{tick // 50}.jpg")`);
  if (R.keypad) {
    fast.push('key = read_key()', 'if key == "*":', '    entered = ""', '    print("Cleared")', 'elif key:', '    entered += key', '    print("Key", key, "→", "*" * len(entered))',
      `if len(entered) == ${T.code.length}:`, `    if entered == "${T.code}":`, `        print("Unlocked!")`, `        unlock_left = ${T.unlockTicks}`, '    else:', '        print("Wrong code")', '        wrong_left = 12', '    entered = ""');
  }
  // conditions
  const cond = {
    trigger: trig, dark: rv('light') && `${rv('light')} < ${T.dark}`, dry: rv('moisture') && `${rv('moisture')} < ${T.dry}`,
    gas: rv('gas') && `${rv('gas')} > ${T.gas}`, near: rv('distance') && `${rv('distance')} < ${T.near}`, detect: '"person" in labels',
    motion: R.pirs.map((p) => `${v(p)}.motion_detected`).join(' or ') || null,
  };
  // traffic light
  if (R.lights.length) {
    const L = v(R.lights[0]), tr = T.traffic, cyc = tr.red + tr.green + tr.amber;
    state.push('walk_request = False', 'phase = ""');
    out.push(`step = tick % ${cyc}`, `now = "red" if step < ${tr.red} else "green" if step < ${tr.red + tr.green} else "amber"`,
      'if now != phase:', '    phase = now', '    print(phase.upper())', `${L}.red.value = phase == "red"`, `${L}.amber.value = phase == "amber"`, `${L}.green.value = phase == "green"`);
    if (R.trafficButton) out.push('if trigger and phase != "red" and not walk_request:', '    walk_request = True', '    print("Walk requested")');
  }
  // leds
  const ledExpr = { trigger: trig, dark: cond.dark, dry: cond.dry, gas: cond.gas, near: cond.near, detect: cond.detect }[R.ledRule];
  if (R.ledRule === 'lock') {
    if (R.okLed) out.push(`${v(R.okLed)}.value = unlock_left > 0`);
    if (R.badLed) out.push(`${v(R.badLed)}.value = wrong_left > 0 and (wrong_left // 2) % 2 == 0`);
    for (const l of R.leds.filter((x) => x !== R.okLed && x !== R.badLed)) out.push(`${v(l)}.value = unlock_left > 0`);
  } else for (const l of R.leds) out.push(R.ledRule === 'blink' ? `if tick % ${T.blinkEvery} == 0:\n    ${v(l)}.toggle()` : `${v(l)}.value = ${ledExpr}`);
  // buzzers
  for (const b of R.buzzers) {
    const e = { lock: `(0 < unlock_left and unlock_left > ${T.unlockTicks - 2}) or wrong_left > 2`, walk: `phase == "red" and walk_request and tick % 5 == 0`, motion: cond.motion, trigger: trig, gas: cond.gas, near: cond.near, chirp: `tick % ${T.chirpEvery} == 0` }[R.buzzRule];
    out.push(`${v(b)}.value = ${e}`);
  }
  if (R.trafficButton) out.push(`if phase == "red" and step == ${T.traffic.red - 1}:`, '    walk_request = False');
  // rgb
  for (const p of R.rgbs) { state.push('COLORS = [(1, 0, 0), (0, 1, 0), (0, 0, 1), (1, 1, 0), (0, 1, 1), (1, 0, 1)]'); out.push(`${v(p)}.color = COLORS[(tick // 10) % len(COLORS)]`); }
  // servos
  for (const s of R.servos) {
    if (R.servoRule === 'lock') out.push(`${v(s)}.angle = 90 if unlock_left > 0 else 0  # 90° = bolt open`);
    else if (R.servoRule === 'pot') out.push(`${v(s)}.angle = ${rv('value')} / 100 * 180`);
    else out.push(`${v(s)}.angle = ((tick // 10) % 7) * 30`);
  }
  // motors
  if (R.motors.length) {
    const ms = R.motors.map((m) => v(m.motor));
    if (rv('distance')) {
      state.push('backing = 0');
      out.push(`if backing == 0 and ${rv('distance')} < ${T.robotNear}:`, '    print("Obstacle! Backing up")', '    backing = 15',
        'if backing > 5:', ...ms.map((m) => `    ${m}.backward(0.6)`), 'elif backing > 0:', `    ${ms[0]}.forward(0.6)`, ...ms.slice(1).map((m) => `    ${m}.backward(0.6)  # spin to turn`),
        'else:', ...ms.map((m) => `    ${m}.forward(0.6)`), 'backing = max(0, backing - 1)');
    } else out.push('if tick % 40 < 30:', ...ms.map((m) => `    ${m}.forward(0.6)`), 'else:', ...ms.map((m) => `    ${m}.stop()`));
  }
  for (const p of R.steppers) { state.push(`${v(p)}_pos = 0`); out.push(`for _ in range(${T.stepsPerTick}):`, `    ${v(p)}_pos += 1`, `    ${v(p)}_step(${v(p)}_pos)`, '    sleep(0.002)'); }
  if (R.relay) {
    const e = { trigger: trig, dark: cond.dark, toggle: `(tick // 20) % 2 == 1` }[R.relayRule];
    out.push(`${v(R.relay)}.value = ${e}${R.lampOnRelay ? '  # switches the lamp' : ''}`);
  }
  // ring
  for (const p of R.rings) {
    use('colorsys');
    state.push('ring_mode = 0');
    if (R.ringButton) { state.push('was_pressed = False'); out.push(`if ${v(R.buttons[0])}.is_pressed and not was_pressed:`, '    ring_mode = (ring_mode + 1) % 3', '    print("Mode", ["rainbow", "chase", "warm"][ring_mode])', `was_pressed = ${v(R.buttons[0])}.is_pressed`); }
    out.push('for i in range(12):', '    if ring_mode == 0:', '        r, g, b = colorsys.hsv_to_rgb(((i + tick) % 12) / 12, 1, 1)', '        rgb = (int(r * 255), int(g * 255), int(b * 255))',
      '    elif ring_mode == 1:', '        rgb = (0, 120, 255) if i == tick % 12 else (0, 0, 0)', '    else:', '        rgb = (255, 140, 40)', `    ${v(p)}[i] = rgb`, `${v(p)}.show()`);
  }
  // matrix
  for (const p of R.matrices) {
    state.push('HEART = [0x00, 0x66, 0xFF, 0xFF, 0x7E, 0x3C, 0x18, 0x00]', 'SMILE = [0x3C, 0x42, 0xA5, 0x81, 0xA5, 0x99, 0x42, 0x3C]');
    const e = trig || cond.near || '(tick // 10) % 2 == 1';
    out.push(`face = HEART if ${e} else SMILE`, `with canvas(${v(p)}) as draw:`, '    for y, row in enumerate(face):', '        for x in range(8):', '            if row >> (7 - x) & 1:', '                draw.point((x, y), fill="white")');
  }
  // displays + console line
  const textLines = reads.length ? reads.slice(0, 3).map((r) => `f"${r.label} {${r.key}_${v(r.p)}:.1f}${r.unit === '°C' ? 'C' : r.unit === '%' ? '%' : ' ' + r.unit}"`) : ['"CircuitDeck"', 'f"up {tick // 10} s"'];
  for (const p of R.oleds) slow.push(`with canvas(${v(p)}) as draw:`, ...textLines.map((t, i) => `    draw.text((0, ${i * 20}), ${t}, fill="white")`));
  for (const p of R.lcds) slow.push(`${v(p)}.cursor_pos = (0, 0)`, `${v(p)}.write_string(${textLines[0]}.ljust(16)[:16])`, `${v(p)}.cursor_pos = (1, 0)`, `${v(p)}.write_string(${textLines[1] || '""'}.ljust(16)[:16])`);
  for (const p of R.epapers) slow.push('if tick % 600 == 0:  # e-paper: refresh once a minute', `    img = Image.new("1", (${v(p)}.height, ${v(p)}.width), 255)`, '    d = ImageDraw.Draw(img)', ...textLines.map((t, i) => `    d.text((8, ${8 + i * 30}), ${t}, fill=0)`), `    ${v(p)}.display(${v(p)}.getbuffer(img))`);
  if (reads.length) prints.push(`print(${reads.map((r) => `f"${r.label} {${r.key}_${v(r.p)}:.1f} ${r.unit}"`).join(' + "  |  " + ')})`);
  if (R.keypad) out.push('unlock_left = max(0, unlock_left - 1)', 'wrong_left = max(0, wrong_left - 1)');

  const L = [];
  L.push('#!/usr/bin/env python3', `# ${c.name || 'My circuit'} — generated by CircuitDeck for Raspberry Pi 5`, '# gpiozero uses BCM GPIO numbers. Run with: python3 main.py');
  for (const [mod, names] of imp) L.push(names.size ? `from ${mod} import ${[...names].join(', ')}` : `import ${mod}`);
  L.push('');
  if (decl.length) L.push(...decl, '');
  if (helpers.length) L.push(...helpers);
  L.push(...state, 'tick = 0', '', 'while True:');
  const ind = (arr) => arr.flatMap((l) => l.split('\n')).map((l) => `    ${l}`);
  L.push(...ind(fast));
  if (slow.length || prints.length) L.push(`    if tick % ${T.printEvery} == 0:`, ...ind(ind([...slow, ...prints])));
  L.push(...ind(out));
  if (!fast.length && !slow.length && !out.length) L.push('    pass  # add parts in Components and wire them up');
  L.push('    tick += 1', '    sleep(0.1)', '');
  return { lang: 'py', file: 'main.py', code: L.join('\n') };
}

// ---------------------------------------------------------------- Arduino C++ (ESP32)
function arduino(c, R) {
  const T = RULES, v = (p) => R.name(p, 'c');
  const inc = new Set(), decl = [], setup = [], helpers = [], fast = [], slow = [], out = [], prints = [];
  const P = (p, n) => `${v(p).toUpperCase()}_${n.replace(/[^A-Za-z0-9]/g, '')}`;
  const pinConst = (p, n, num) => { decl.push(`const int ${P(p, n)} = ${C_PIN(num)};`); return P(p, n); };
  for (const p of R.leds) { const k = pinConst(p, 'PIN', R.g(p, 'A')); setup.push(`pinMode(${k}, OUTPUT);`); }
  for (const p of R.buttons) { const k = pinConst(p, 'PIN', R.direct(p, '1') ?? R.direct(p, '2')); setup.push(`pinMode(${k}, INPUT_PULLUP);  // other leg to GND`); }
  for (const p of R.buzzers) { const k = pinConst(p, 'PIN', R.g(p, '+')); setup.push(`pinMode(${k}, OUTPUT);`); }
  for (const p of R.rgbs) for (const n of ['R', 'G', 'B']) pinConst(p, n, R.g(p, n));
  for (const p of R.pirs) { const k = pinConst(p, 'PIN', R.g(p, 'OUT')); setup.push(`pinMode(${k}, INPUT);`); }
  for (const p of R.sonars) { pinConst(p, 'TRIG', R.g(p, 'TRIG')); pinConst(p, 'ECHO', R.g(p, 'ECHO')); setup.push(`pinMode(${P(p, 'TRIG')}, OUTPUT);`, `pinMode(${P(p, 'ECHO')}, INPUT);`);
    helpers.push(`float ${v(p)}Distance() {`, `  digitalWrite(${P(p, 'TRIG')}, HIGH); delayMicroseconds(10); digitalWrite(${P(p, 'TRIG')}, LOW);`, `  long us = pulseIn(${P(p, 'ECHO')}, HIGH, 30000);`, '  return us / 58.0;  // cm', '}', ''); }
  for (const p of R.dhts) { inc.add('DHT.h'); decl.push(`DHT ${v(p)}(${C_PIN(R.g(p, 'DATA'))}, DHT22);`); setup.push(`${v(p)}.begin();`); }
  for (const p of R.bmes) { inc.add('Wire.h'); inc.add('Adafruit_BME280.h'); decl.push(`Adafruit_BME280 ${v(p)};`); setup.push(`${v(p)}.begin(0x76);`); }
  for (const p of [...R.pots, ...R.ldrs, ...R.soils, ...R.mq2s]) { const a = R.analog(p); pinConst(p, 'PIN', a.pin ?? null); }
  for (const p of R.oleds) { inc.add('Wire.h'); inc.add('Adafruit_SSD1306.h'); decl.push(`Adafruit_SSD1306 ${v(p)}(128, 64, &Wire, -1);`); setup.push(`${v(p)}.begin(SSD1306_SWITCHCAPVCC, 0x3C);`, `${v(p)}.setTextColor(SSD1306_WHITE);`); }
  for (const p of R.lcds) { inc.add('LiquidCrystal_I2C.h'); decl.push(`LiquidCrystal_I2C ${v(p)}(0x27, 16, 2);`); setup.push(`${v(p)}.init();`, `${v(p)}.backlight();`); }
  for (const p of R.epapers) { inc.add('GxEPD2_BW.h'); decl.push(`GxEPD2_BW<GxEPD2_213_B74, GxEPD2_213_B74::HEIGHT> ${v(p)}(GxEPD2_213_B74(${R.g(p, 'CS') ?? 5}, ${R.g(p, 'DC') ?? 17}, ${R.g(p, 'RST') ?? 16}, ${R.g(p, 'BUSY') ?? 4}));`); setup.push(`${v(p)}.init(115200);`); }
  for (const p of R.matrices) { inc.add('LedControl.h'); decl.push(`LedControl ${v(p)}(${C_PIN(R.g(p, 'DIN'))}, ${C_PIN(R.g(p, 'CLK'))}, ${C_PIN(R.g(p, 'CS'))}, 1);`); setup.push(`${v(p)}.shutdown(0, false);`, `${v(p)}.setIntensity(0, 4);`); }
  for (const p of R.rings) { inc.add('Adafruit_NeoPixel.h'); decl.push(`Adafruit_NeoPixel ${v(p)}(12, ${C_PIN(R.g(p, 'DIN'))}, NEO_GRB + NEO_KHZ800);`); setup.push(`${v(p)}.begin();`, `${v(p)}.setBrightness(77);  // ~30 %`); }
  for (const p of R.servos) { inc.add('ESP32Servo.h'); decl.push(`Servo ${v(p)};`); setup.push(`${v(p)}.attach(${C_PIN(R.g(p, 'SIG'))}, 500, 2500);`); }
  for (const m of R.motors) { pinConst(m.motor, 'FWD', m.fwd); pinConst(m.motor, 'BACK', m.back); setup.push(`pinMode(${P(m.motor, 'FWD')}, OUTPUT);`, `pinMode(${P(m.motor, 'BACK')}, OUTPUT);`); }
  if (R.motors.length) helpers.push('// DRV8833: PWM one input, hold the other LOW. speed -255..255', 'void drive(int fwd, int back, int speed) {', '  analogWrite(fwd, speed > 0 ? speed : 0);', '  analogWrite(back, speed < 0 ? -speed : 0);', '}', '');
  for (const p of R.steppers) { inc.add('Stepper.h'); decl.push(`Stepper ${v(p)}(2048, ${['IN1', 'IN3', 'IN2', 'IN4'].map((n) => C_PIN(R.g(p, n))).join(', ')});  // 28BYJ-48: IN1-IN3-IN2-IN4 order`); setup.push(`${v(p)}.setSpeed(10);`); }
  if (R.relay) { const k = pinConst(R.relay, 'PIN', R.g(R.relay, 'IN')); setup.push(`pinMode(${k}, OUTPUT);`); }
  for (const p of R.lights) for (const n of ['R', 'Y', 'G']) { pinConst(p, n, R.g(p, n)); setup.push(`pinMode(${P(p, n)}, OUTPUT);`); }
  if (R.keypad) {
    inc.add('Keypad.h');
    const k = R.keypad;
    decl.push(`byte rowPins[4] = {${['R1', 'R2', 'R3', 'R4'].map((n) => R.g(k, n) ?? 0).join(', ')}};`, `byte colPins[3] = {${['C1', 'C2', 'C3'].map((n) => R.g(k, n) ?? 0).join(', ')}};`,
      "char keymap[4][3] = {{'1','2','3'},{'4','5','6'},{'7','8','9'},{'*','0','#'}};", 'Keypad keys = Keypad(makeKeymap(keymap), rowPins, colPins, 4, 3);', 'String entered = "";', 'int unlockLeft = 0, wrongLeft = 0;');
  }
  const reads = R.readings;
  const rn = (r) => `${r.key}_${v(r.p)}`;
  if (reads.length) decl.push(...[...new Set(reads.map(rn))].map((n) => `float ${n} = 0;`));
  for (const r of reads) {
    const p = v(r.p);
    const line = {
      distance: `${rn(r)} = ${p}Distance();`,
      temp: r.p.type === 'dht22' ? `${rn(r)} = ${p}.readTemperature();` : `${rn(r)} = ${p}.readTemperature();`,
      hum: `${rn(r)} = ${p}.readHumidity();`, pressure: `${rn(r)} = ${p}.readPressure() / 100.0;`,
      value: `${rn(r)} = analogRead(${P(r.p, 'PIN')}) / 40.95;`, light: `${rn(r)} = analogRead(${P(r.p, 'PIN')}) / 40.95;`,
      moisture: `${rn(r)} = 100 - analogRead(${P(r.p, 'PIN')}) / 40.95;  // wetter = lower voltage`, gas: `${rn(r)} = analogRead(${P(r.p, 'PIN')}) / 40.95;`,
    }[r.key];
    (r.p.type === 'dht22' || r.p.type === 'bme280' ? slow : fast).push(line);
  }
  const rv = (key) => { const r = reads.find((x) => x.key === key); return r ? rn(r) : null; };
  let trig = null;
  if (R.hasTrigger) {
    const parts = [...R.buttons.map((b) => `digitalRead(${P(b, 'PIN')}) == LOW`), ...R.pirs.map((p) => `digitalRead(${P(p, 'PIN')}) == HIGH`)];
    decl.push('bool wasTriggered = false;');
    fast.push(`bool trigger = ${parts.join(' || ')};`, `if (trigger && !wasTriggered) Serial.println("${R.pirs.length ? 'Motion detected!' : 'Button pressed'}");`, 'wasTriggered = trigger;');
    trig = 'trigger';
  }
  if (R.keypad) fast.push('char key = keys.getKey();', "if (key == '*') { entered = \"\"; Serial.println(\"Cleared\"); }", 'else if (key) { entered += key; Serial.printf("Key %c\\n", key); }',
    `if (entered.length() == ${T.code.length}) {`, `  if (entered == "${T.code}") { Serial.println("Unlocked!"); unlockLeft = ${T.unlockTicks}; }`, '  else { Serial.println("Wrong code"); wrongLeft = 12; }', '  entered = "";', '}');
  const cond = { trigger: trig, dark: rv('light') && `${rv('light')} < ${T.dark}`, dry: rv('moisture') && `${rv('moisture')} < ${T.dry}`, gas: rv('gas') && `${rv('gas')} > ${T.gas}`, near: rv('distance') && `${rv('distance')} < ${T.near}`, motion: R.pirs.map((p) => `digitalRead(${P(p, 'PIN')}) == HIGH`).join(' || ') || null };
  if (R.lights.length) {
    const Lp = R.lights[0], tr = T.traffic, cyc = tr.red + tr.green + tr.amber;
    decl.push('String phase = "";', 'bool walkRequest = false;');
    out.push(`int step = tick % ${cyc};`, `String now = step < ${tr.red} ? "red" : step < ${tr.red + tr.green} ? "green" : "amber";`, 'if (now != phase) { phase = now; Serial.println(phase); }',
      `digitalWrite(${P(Lp, 'R')}, phase == "red");`, `digitalWrite(${P(Lp, 'Y')}, phase == "amber");`, `digitalWrite(${P(Lp, 'G')}, phase == "green");`);
    if (R.trafficButton) out.push('if (trigger && phase != "red" && !walkRequest) { walkRequest = true; Serial.println("Walk requested"); }');
  }
  const ledExpr = { trigger: trig, dark: cond.dark, dry: cond.dry, gas: cond.gas, near: cond.near }[R.ledRule];
  if (R.ledRule === 'lock') {
    if (R.okLed) out.push(`digitalWrite(${P(R.okLed, 'PIN')}, unlockLeft > 0);`);
    if (R.badLed) out.push(`digitalWrite(${P(R.badLed, 'PIN')}, wrongLeft > 0 && (wrongLeft / 2) % 2 == 0);`);
  } else for (const l of R.leds) out.push(R.ledRule === 'blink' ? `if (tick % ${T.blinkEvery} == 0) digitalWrite(${P(l, 'PIN')}, !digitalRead(${P(l, 'PIN')}));` : `digitalWrite(${P(l, 'PIN')}, ${ledExpr});`);
  for (const b of R.buzzers) {
    const e = { lock: `(unlockLeft > ${T.unlockTicks - 2}) || wrongLeft > 2`, walk: 'phase == "red" && walkRequest && tick % 5 == 0', motion: cond.motion, trigger: trig, gas: cond.gas, near: cond.near, chirp: `tick % ${T.chirpEvery} == 0` }[R.buzzRule];
    out.push(`digitalWrite(${P(b, 'PIN')}, ${e});`);
  }
  if (R.trafficButton) out.push(`if (phase == "red" && step == ${T.traffic.red - 1}) walkRequest = false;`);
  for (const p of R.rgbs) { decl.push('const int COLORS[6][3] = {{255,0,0},{0,255,0},{0,0,255},{255,255,0},{0,255,255},{255,0,255}};'); out.push(`{ const int *k = COLORS[(tick / 10) % 6]; analogWrite(${P(p, 'R')}, k[0]); analogWrite(${P(p, 'G')}, k[1]); analogWrite(${P(p, 'B')}, k[2]); }`); }
  for (const s of R.servos) out.push(R.servoRule === 'lock' ? `${v(s)}.write(unlockLeft > 0 ? 90 : 0);  // 90° = bolt open` : R.servoRule === 'pot' ? `${v(s)}.write(${rv('value')} / 100 * 180);` : `${v(s)}.write(((tick / 10) % 7) * 30);`);
  if (R.motors.length) {
    const ms = R.motors.map((m) => [P(m.motor, 'FWD'), P(m.motor, 'BACK')]);
    if (rv('distance')) {
      decl.push('int backing = 0;');
      out.push(`if (backing == 0 && ${rv('distance')} < ${T.robotNear}) { Serial.println("Obstacle! Backing up"); backing = 15; }`,
        'if (backing > 5) {', ...ms.map(([f, b]) => `  drive(${f}, ${b}, -150);`), '} else if (backing > 0) {', ...ms.map(([f, b], i) => `  drive(${f}, ${b}, ${i === 0 ? 150 : -150});`), '} else {', ...ms.map(([f, b]) => `  drive(${f}, ${b}, 150);`), '}', 'if (backing > 0) backing--;');
    } else out.push(...ms.map(([f, b]) => `drive(${f}, ${b}, tick % 40 < 30 ? 150 : 0);`));
  }
  for (const p of R.steppers) out.push(`${v(p)}.step(${T.stepsPerTick / 2});  // full steps`);
  if (R.relay) out.push(`digitalWrite(${P(R.relay, 'PIN')}, ${{ trigger: trig, dark: cond.dark, toggle: '(tick / 20) % 2 == 1' }[R.relayRule]});`);
  for (const p of R.rings) {
    decl.push('int ringMode = 0;');
    if (R.ringButton) { decl.push('bool wasPressed = false;'); out.push(`bool pressed = digitalRead(${P(R.buttons[0], 'PIN')}) == LOW;`, 'if (pressed && !wasPressed) { ringMode = (ringMode + 1) % 3; Serial.printf("Mode %d\\n", ringMode); }', 'wasPressed = pressed;'); }
    out.push('for (int i = 0; i < 12; i++) {', `  uint32_t k = ringMode == 0 ? ${v(p)}.ColorHSV(((i + tick) % 12) * 65536L / 12) : ringMode == 1 ? (i == tick % 12 ? ${v(p)}.Color(0, 120, 255) : 0) : ${v(p)}.Color(255, 140, 40);`, `  ${v(p)}.setPixelColor(i, k);`, '}', `${v(p)}.show();`);
  }
  for (const p of R.matrices) {
    decl.push('const byte HEART[8] = {0x00,0x66,0xFF,0xFF,0x7E,0x3C,0x18,0x00};', 'const byte SMILE[8] = {0x3C,0x42,0xA5,0x81,0xA5,0x99,0x42,0x3C};');
    out.push(`{ const byte *face = (${trig || cond.near || '(tick / 10) % 2 == 1'}) ? HEART : SMILE; for (int r = 0; r < 8; r++) ${v(p)}.setRow(0, r, face[r]); }`);
  }
  const fmt = (r) => [`String("${r.label} ")`, `String(${rn(r)}, 1)`, `"${r.unit === '°C' ? 'C' : r.unit === '%' ? '%' : ' ' + r.unit}"`].join(' + ');
  const textLines = reads.length ? reads.slice(0, 3).map((r) => fmt(r)) : ['String("CircuitDeck")', 'String("up ") + String(tick / 10) + " s"'];
  for (const p of R.oleds) slow.push(`${v(p)}.clearDisplay();`, `${v(p)}.setTextSize(1);`, ...textLines.map((t, i) => `${v(p)}.setCursor(0, ${i * 20}); ${v(p)}.print(${t});`), `${v(p)}.display();`);
  for (const p of R.lcds) slow.push(`${v(p)}.setCursor(0, 0); ${v(p)}.print(${textLines[0]});`, `${v(p)}.setCursor(0, 1); ${v(p)}.print(${textLines[1] || '""'});`);
  for (const p of R.epapers) slow.push('if (tick % 600 == 0) {  // e-paper: refresh once a minute', `  ${v(p)}.setFullWindow(); ${v(p)}.firstPage();`, `  do { ${v(p)}.fillScreen(GxEPD_WHITE); ${textLines.map((t, i) => `${v(p)}.setCursor(8, ${20 + i * 30}); ${v(p)}.print(${t});`).join(' ')} } while (${v(p)}.nextPage());`, '}');
  if (reads.length) prints.push(`Serial.println(${reads.map((r) => fmt(r)).join(' + "  |  " + ')});`);
  if (R.keypad) out.push('if (unlockLeft > 0) unlockLeft--;', 'if (wrongLeft > 0) wrongLeft--;');

  const L = [`// ${c.name || 'My circuit'} — generated by CircuitDeck for ESP32 (Arduino core 3.x)`];
  for (const h of inc) L.push(`#include <${h}>`);
  if (inc.size) L.push('');
  L.push(...decl, 'unsigned long tick = 0;', '', ...helpers, 'void setup() {', '  Serial.begin(115200);', ...setup.map((l) => `  ${l}`), '}', '', 'void loop() {');
  const ind = (arr, n = 1) => arr.map((l) => `${'  '.repeat(n)}${l}`);
  L.push(...ind(fast));
  if (slow.length || prints.length) L.push(`  if (tick % ${T.printEvery} == 0) {`, ...ind([...slow, ...prints], 2), '  }');
  L.push(...ind(out), '  tick++;', '  delay(100);', '}', '');
  return { lang: 'cpp', file: 'sketch.ino', code: L.join('\n') };
}
export { BUS };
