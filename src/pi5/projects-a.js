// Raspberry Pi 5 projects, part 1: GPIO basics, sensors and analog input.
// Each project: facts for the four tabs, the parts and wires for the 3D scene,
// the Python program, optional inputs, and a scripted simulation of the run.
//
// Layout (cm): the Pi sits around x = -6.5, the breadboard around x = 4.5.
// Wires: [from, to, opts?]. A plain name (GPIO17, GND, 5V, 3V3, CAM0, PCIE,
// FAN) is a Pi connector; "id.pin" is a part's pin.

export const BB = { x: 4.5, z: 0.6, w: 11, d: 6.6 };

const fmt = (n, d = 1) => Number(n).toFixed(d);

export const PROJECTS_A = [
  // ------------------------------------------------------------------------
  {
    id: 'meet-pi5', title: 'Meet the Raspberry Pi 5', short: 'A tour of the board',
    difficulty: 'Beginner', time: '10 min', topics: ['Board', 'Python'],
    lede: 'The Raspberry Pi 5 is a full Linux computer the size of a credit card. Its BCM2712 runs four Cortex-A76 cores at 2.4 GHz, and a new chip designed by Raspberry Pi, RP1, looks after the GPIO header, USB, Ethernet and the camera ports. Click any part to learn what it does.',
    features: [['chip', 'Click a part of the board to inspect it'], ['code', 'Read the board’s model and temperature from Python'], ['bolt', 'Power it from a 5 V / 5 A USB-C supply']],
    parts: [], wires: [], noBreadboard: true,
    pinout: [['3V3', 'Pins 1 and 17', '3.3 V out for sensors — about 500 mA shared between both.'], ['5V', 'Pins 2 and 4', 'Straight from the USB-C supply. Never connect it to a GPIO pin.'], ['GND', 'Pins 6, 9, 14, 20, 25, 30, 34, 39', 'The common ground for every circuit.'], ['GPIO 2–27', 'Every other pin', '3.3 V logic in or out, driven by RP1. Not 5 V tolerant.']],
    steps: ['<code>CPUTemperature</code> from gpiozero reads the SoC temperature the kernel reports.', 'The model string comes from the device tree, the file the firmware hands to Linux.', 'On Pi 5 the GPIO header belongs to RP1, so classic libraries like <code>RPi.GPIO</code> and <code>pigpio</code> don’t work; gpiozero (on lgpio) is the standard choice.'],
    specs: [['SoC', 'Broadcom BCM2712, 4 × Cortex-A76 @ 2.4 GHz'], ['GPU', 'VideoCore VII, 800 MHz'], ['RAM', '1 / 2 / 4 / 8 / 16 GB LPDDR4X-4267'], ['I/O controller', 'RP1 (PCIe 2.0 ×4 link)'], ['Power', '5 V / 5 A USB-C (USB PD)'], ['Video', '2 × micro HDMI, 4Kp60'], ['Camera/display', '2 × 4-lane MIPI CSI/DSI'], ['Expansion', 'PCIe 2.0 ×1 (FPC), 40-pin GPIO'], ['Networking', 'Gigabit Ethernet, Wi-Fi 5, Bluetooth 5.0'], ['Extras', 'RTC, power button, fan header, UART connector']],
    code: `from gpiozero import CPUTemperature
import platform
import os

cpu = CPUTemperature()

with open("/proc/device-tree/model") as f:
    print("Model:", f.read().strip("\\x00"))
print("Kernel:", platform.release())
print("CPU temperature:", round(cpu.temperature, 1), "°C")
print("Load average:", os.getloadavg())`,
    async run(ctx) {
      ctx.at('cpu = CPUTemperature()'); await ctx.sleep(500);
      ctx.at('print("Model:"'); ctx.print('Model: Raspberry Pi 5 Model B Rev 1.0'); await ctx.sleep(500);
      ctx.at('print("Kernel:"'); ctx.print('Kernel: 6.6.51+rpt-rpi-2712'); await ctx.sleep(500);
      ctx.at('print("CPU temperature:"'); ctx.print(`CPU temperature: ${fmt(47 + Math.random() * 3)} °C`); await ctx.sleep(500);
      ctx.at('print("Load average:"'); ctx.print('Load average: (0.08, 0.12, 0.09)'); await ctx.sleep(400);
      ctx.print('Process finished with exit code 0', 'cd-ok');
    },
  },
  // ------------------------------------------------------------------------
  {
    id: 'blink', title: 'Blink an LED', short: 'Your first output',
    difficulty: 'Beginner', time: '15 min', topics: ['GPIO', 'Output'],
    lede: 'The “hello world” of electronics: an LED on GPIO 17 switches on and off every half second. The 330 Ω resistor keeps the current to a safe 4 mA or so.',
    features: [['bolt', 'Digital output with gpiozero’s <code>LED</code>'], ['hand', 'Remove the LED in Components, then run it again'], ['eye', 'Watch the running line move in the code']],
    parts: [
      { id: 'r1', type: 'resistor', at: [2.0, 0.4], opts: { ohms: '330' }, label: '330 Ω resistor' },
      { id: 'led', type: 'led', at: [4.4, 0.4], opts: { color: 'red' }, label: 'Red LED', why: 'nothing would light up' },
    ],
    wires: [['GPIO17', 'r1.1'], ['r1.2', 'led.A'], ['led.K', 'GND']],
    pinout: [['GPIO17', 'Resistor → LED anode (long leg)', 'Switches to 3.3 V to light the LED.'], ['GND', 'LED cathode (short leg)', 'Completes the circuit.']],
    steps: ['<code>LED(17)</code> claims GPIO 17 as an output (gpiozero uses BCM numbers, not physical pin numbers — GPIO 17 is physical pin 11).', 'The loop turns it on, waits half a second, turns it off and waits again.', 'Current: (3.3 V − 2.0 V) ÷ 330 Ω ≈ 4 mA, well inside what a pin should supply.', 'Shortcut: <code>led.blink()</code> does the same in the background.'],
    specs: [['LED', '5 mm red, ~2.0 V forward'], ['Resistor', '330 Ω (orange-orange-brown)'], ['Current', '≈ 4 mA'], ['Pin', 'GPIO 17 (physical 11)'], ['Logic', '3.3 V']],
    code: `from gpiozero import LED
from time import sleep

led = LED(17)

while True:
    led.on()
    sleep(0.5)
    led.off()
    sleep(0.5)`,
    async run(ctx) {
      ctx.at('led = LED(17)'); await ctx.sleep(300);
      for (;;) {
        ctx.at('led.on()'); ctx.set('led', { on: true }); ctx.print('GPIO17 → HIGH (LED on)'); await ctx.sleep(500);
        ctx.at('led.off()'); ctx.set('led', { on: false }); ctx.print('GPIO17 → LOW (LED off)'); await ctx.sleep(500);
      }
    },
  },
  // ------------------------------------------------------------------------
  {
    id: 'button', title: 'Push-button light', short: 'Reading an input',
    difficulty: 'Beginner', time: '15 min', topics: ['GPIO', 'Input'],
    lede: 'A button on GPIO 27 lights the LED on GPIO 17 while it is held. No pull-up resistor needed: gpiozero turns on the pin’s internal pull-up, so the button only has to connect the pin to ground.',
    features: [['hand', 'Press the button in the 3D view or in Inputs'], ['bolt', 'Events: <code>when_pressed</code> and <code>when_released</code>'], ['code', 'No polling loop — <code>pause()</code> just waits']],
    parts: [
      { id: 'btn', type: 'button', at: [0.8, 1.6], label: 'Push button' },
      { id: 'r1', type: 'resistor', at: [4.0, -0.6], opts: { ohms: '330' }, label: '330 Ω resistor' },
      { id: 'led', type: 'led', at: [6.4, -0.6], opts: { color: 'green' }, label: 'Green LED' },
    ],
    wires: [['GPIO27', 'btn.1'], ['btn.2', 'GND'], ['GPIO17', 'r1.1'], ['r1.2', 'led.A'], ['led.K', 'GND']],
    inputs: [{ id: 'btn', type: 'hold', label: 'Hold the button' }],
    pinout: [['GPIO27', 'Button, one side', 'Pulled up to 3.3 V inside; reads LOW when pressed.'], ['GND', 'Button, other side', 'Pressing connects GPIO 27 to ground.'], ['GPIO17', 'Resistor → LED', 'The output.'], ['GND', 'LED cathode', 'Return path.']],
    steps: ['<code>Button(27)</code> sets GPIO 27 as an input with the internal pull-up on, so it reads HIGH until pressed.', 'gpiozero calls the functions you attach when the state changes — there is debouncing built in through <code>bounce_time</code> if you need it.', '<code>pause()</code> keeps the program alive so the events can fire.'],
    specs: [['Button', '6 × 6 mm tactile, momentary'], ['Pull-up', 'Internal, ~50 kΩ'], ['Input', 'GPIO 27 (physical 13)'], ['Output', 'GPIO 17 (physical 11)']],
    code: `from gpiozero import LED, Button
from signal import pause

led = LED(17)
button = Button(27)     # internal pull-up: wire the button to GND

def pressed():
    led.on()
    print("Pressed")

def released():
    led.off()
    print("Released")

button.when_pressed = pressed
button.when_released = released

pause()`,
    async run(ctx) {
      ctx.at('button.when_pressed'); await ctx.sleep(200);
      ctx.at('pause()'); ctx.print('Waiting for the button… (hold it in Inputs or click it in 3D)');
      let last = false;
      for (;;) {
        const p = !!ctx.input('btn');
        if (p !== last) {
          last = p;
          ctx.set('btn', { pressed: p });
          if (p) { ctx.at('led.on()'); ctx.set('led', { on: true }); ctx.print('Pressed'); }
          else { ctx.at('led.off()'); ctx.set('led', { on: false }); ctx.print('Released'); }
        }
        await ctx.sleep(40);
      }
    },
  },
  // ------------------------------------------------------------------------
  {
    id: 'traffic', title: 'Traffic lights', short: 'Sequencing outputs',
    difficulty: 'Beginner', time: '20 min', topics: ['GPIO', 'Output'],
    lede: 'A UK-style sequence on a traffic-light module: green, amber, red, then red and amber together before green again. gpiozero’s <code>TrafficLights</code> groups the three LEDs into one object.',
    features: [['bolt', 'Three outputs as one device'], ['clock', 'Timing with <code>sleep()</code>'], ['chip', 'The module has its resistors on board']],
    parts: [{ id: 'tl', type: 'trafficlight', at: [3.0, -0.2], label: 'Traffic-light module' }],
    wires: [['GPIO22', 'tl.R'], ['GPIO27', 'tl.Y'], ['GPIO17', 'tl.G'], ['tl.GND', 'GND']],
    pinout: [['GPIO22', 'R', 'Red lamp.'], ['GPIO27', 'Y', 'Amber lamp.'], ['GPIO17', 'G', 'Green lamp.'], ['GND', 'GND', 'Shared cathode.']],
    steps: ['<code>TrafficLights(red=22, amber=27, green=17)</code> makes three LEDs you reach as <code>lights.red</code>, <code>lights.amber</code> and <code>lights.green</code>.', 'Each phase switches lamps and waits; red + amber means “get ready” in the UK.', 'Swap the waits for a button to make a pedestrian crossing.'],
    specs: [['Module', 'R/Y/G LEDs with resistors, common GND'], ['Pins', 'GPIO 22, 27, 17'], ['Cycle', '≈ 11 s']],
    code: `from gpiozero import TrafficLights
from time import sleep

lights = TrafficLights(red=22, amber=27, green=17)

while True:
    lights.green.on()
    sleep(4)
    lights.green.off()
    lights.amber.on()
    sleep(1.5)
    lights.amber.off()
    lights.red.on()
    sleep(4)
    lights.amber.on()        # red + amber: get ready
    sleep(1.5)
    lights.red.off()
    lights.amber.off()`,
    async run(ctx) {
      const s = (p) => ctx.set('tl', p);
      for (;;) {
        ctx.at('lights.green.on()'); s({ g: 1, y: 0, r: 0 }); ctx.print('GREEN'); await ctx.sleep(2500);
        ctx.at('lights.amber.on()'); s({ g: 0, y: 1, r: 0 }); ctx.print('AMBER'); await ctx.sleep(1200);
        ctx.at('lights.red.on()'); s({ g: 0, y: 0, r: 1 }); ctx.print('RED'); await ctx.sleep(2500);
        ctx.at('# red + amber'); s({ g: 0, y: 1, r: 1 }); ctx.print('RED + AMBER'); await ctx.sleep(1200);
        ctx.at('lights.red.off()'); s({ r: 0, y: 0 });
      }
    },
  },
  // ------------------------------------------------------------------------
  {
    id: 'pwm-fade', title: 'Fade an LED', short: 'PWM brightness',
    difficulty: 'Beginner', time: '15 min', topics: ['PWM', 'Output'],
    lede: 'A pin is only ever on or off, but switched on and off hundreds of times a second it looks dimmer or brighter. That is pulse-width modulation; <code>PWMLED</code> takes a brightness from 0 to 1.',
    features: [['wave', 'PWM: the duty cycle sets the brightness'], ['bolt', 'GPIO 18 also has a hardware PWM channel'], ['code', 'Or simply <code>led.pulse()</code>']],
    parts: [
      { id: 'r1', type: 'resistor', at: [2.0, 0.4], opts: { ohms: '330' }, label: '330 Ω resistor' },
      { id: 'led', type: 'led', at: [4.4, 0.4], opts: { color: 'blue' }, label: 'Blue LED' },
    ],
    wires: [['GPIO18', 'r1.1'], ['r1.2', 'led.A'], ['led.K', 'GND']],
    pinout: [['GPIO18', 'Resistor → LED', 'PWM output (also hardware PWM0 channel 2).'], ['GND', 'LED cathode', 'Return path.']],
    steps: ['<code>PWMLED(18)</code> drives the pin with PWM at 100 Hz by default.', 'Setting <code>led.value</code> from 0 to 1 changes how long each pulse stays high.', 'Our eyes average the flicker into a steady glow. Pi 5 hardware PWM lives on GPIO 12, 13, 18 and 19.'],
    specs: [['Frequency', '100 Hz (gpiozero default)'], ['Resolution', 'value 0.0 – 1.0'], ['Hardware PWM pins', 'GPIO 12, 13, 18, 19']],
    code: `from gpiozero import PWMLED
from time import sleep

led = PWMLED(18)

while True:
    for step in range(101):
        led.value = step / 100      # fade in
        sleep(0.01)
    for step in range(100, -1, -1):
        led.value = step / 100      # fade out
        sleep(0.01)`,
    async run(ctx) {
      for (;;) {
        ctx.at('# fade in');
        for (let s = 0; s <= 100; s += 4) { ctx.set('led', { on: s / 100 }); await ctx.sleep(40); }
        ctx.print('value = 1.00');
        ctx.at('# fade out');
        for (let s = 100; s >= 0; s -= 4) { ctx.set('led', { on: s / 100 }); await ctx.sleep(40); }
        ctx.print('value = 0.00');
      }
    },
  },
  // ------------------------------------------------------------------------
  {
    id: 'rgb', title: 'Rainbow RGB LED', short: 'Mixing colour',
    difficulty: 'Beginner', time: '20 min', topics: ['PWM', 'Output'],
    lede: 'Red, green and blue LEDs in one bulb, each on its own PWM pin. Sweep the hue and the bulb walks round the colour wheel.',
    features: [['wave', 'Three PWM channels at once'], ['code', 'Colour maths with <code>colorsys</code>'], ['chip', 'Common cathode: the long leg goes to GND']],
    parts: [
      { id: 'rr', type: 'resistor', at: [1.6, -1.2], opts: { ohms: '330' }, label: 'Red 330 Ω' },
      { id: 'rg', type: 'resistor', at: [1.6, 0.2], opts: { ohms: '330' }, label: 'Green 330 Ω' },
      { id: 'rb', type: 'resistor', at: [1.6, 1.6], opts: { ohms: '330' }, label: 'Blue 330 Ω' },
      { id: 'rgb', type: 'rgbled', at: [5.0, 0.2], label: 'RGB LED' },
    ],
    wires: [['GPIO17', 'rr.1'], ['GPIO27', 'rg.1'], ['GPIO22', 'rb.1'], ['rr.2', 'rgb.R'], ['rg.2', 'rgb.G'], ['rb.2', 'rgb.B'], ['rgb.GND', 'GND']],
    pinout: [['GPIO17', 'Resistor → R', 'Red channel.'], ['GPIO27', 'Resistor → G', 'Green channel.'], ['GPIO22', 'Resistor → B', 'Blue channel.'], ['GND', 'Common cathode', 'Shared return.']],
    steps: ['<code>RGBLED(red=17, green=27, blue=22)</code> makes three PWM outputs.', '<code>hsv_to_rgb(hue, 1, 1)</code> turns a hue into an (r, g, b) tuple between 0 and 1 — exactly what <code>led.color</code> wants.', 'For a common-anode LED, pass <code>active_high=False</code>.'],
    specs: [['LED', 'Common cathode, diffused'], ['Resistors', '3 × 330 Ω'], ['Colours', 'Any mix of R, G, B']],
    code: `from gpiozero import RGBLED
from colorsys import hsv_to_rgb
from time import sleep

led = RGBLED(red=17, green=27, blue=22)

hue = 0.0
while True:
    led.color = hsv_to_rgb(hue, 1, 1)
    hue = (hue + 0.01) % 1
    sleep(0.03)`,
    async run(ctx) {
      let hue = 0, n = 0;
      for (;;) {
        ctx.at('led.color');
        const [r, g, b] = hsv(hue);
        ctx.set('rgb', { r, g, b });
        if (n++ % 20 === 0) ctx.print(`hue ${fmt(hue, 2)} → (${fmt(r, 2)}, ${fmt(g, 2)}, ${fmt(b, 2)})`);
        hue = (hue + 0.01) % 1;
        await ctx.sleep(40);
      }
    },
  },
  // ------------------------------------------------------------------------
  {
    id: 'buzzer', title: 'SOS buzzer', short: 'Morse code beeps',
    difficulty: 'Beginner', time: '15 min', topics: ['GPIO', 'Sound'],
    lede: 'An active buzzer beeps on its own when powered, so switching it is as easy as an LED. Here it taps out SOS in Morse code: three short, three long, three short.',
    features: [['wave', 'Timing a pattern from a string'], ['bolt', 'Low-current buzzer straight on a pin'], ['code', 'Dots, dashes and gaps in units']],
    parts: [{ id: 'bz', type: 'buzzer', at: [3.0, 0.3], label: 'Active buzzer' }],
    wires: [['GPIO17', 'bz.+'], ['bz.-', 'GND']],
    pinout: [['GPIO17', 'Buzzer +', 'HIGH = beep.'], ['GND', 'Buzzer −', 'Return path.']],
    steps: ['A dot lasts one unit, a dash three; gaps inside a letter are one unit, between letters three.', 'The loop reads the pattern string and turns the buzzer on for each symbol.', 'Draws ~25 mA at 3.3 V: for louder buzzers, switch them with a transistor.'],
    specs: [['Buzzer', 'Active, 3.3–5 V'], ['Unit', '120 ms'], ['Pin', 'GPIO 17']],
    code: `from gpiozero import Buzzer
from time import sleep

buzzer = Buzzer(17)
SOS = "... --- ..."
UNIT = 0.12

while True:
    for symbol in SOS:
        if symbol == " ":
            sleep(UNIT * 3)
            continue
        buzzer.on()
        sleep(UNIT if symbol == "." else UNIT * 3)
        buzzer.off()
        sleep(UNIT)
    print("SOS sent")
    sleep(1.5)`,
    async run(ctx) {
      const U = 120;
      for (;;) {
        for (const s of '... --- ...') {
          if (s === ' ') { ctx.at('sleep(UNIT * 3)'); await ctx.sleep(U * 3); continue; }
          ctx.at('buzzer.on()'); ctx.set('bz', { on: true }); ctx.beep(true);
          await ctx.sleep(s === '.' ? U : U * 3);
          ctx.at('buzzer.off()'); ctx.set('bz', { on: false }); ctx.beep(false);
          await ctx.sleep(U);
        }
        ctx.at('print("SOS sent")'); ctx.print('SOS sent');
        await ctx.sleep(1500);
      }
    },
  },
  // ------------------------------------------------------------------------
  {
    id: 'pir', title: 'Motion alarm', short: 'PIR sensor',
    difficulty: 'Beginner', time: '20 min', topics: ['Sensor', 'Input'],
    lede: 'A PIR sensor sees the infrared of a moving warm body. The HC-SR501 runs on 5 V but its output is 3.3 V, so it connects straight to GPIO 4. When it trips, the LED lights and the time is logged.',
    features: [['eye', 'Passive infrared motion sensing'], ['hand', 'Press “Walk past” in Inputs to trigger it'], ['clock', 'Timestamps with <code>datetime</code>']],
    parts: [
      { id: 'pir', type: 'pir', at: [1.6, 0.2], label: 'PIR sensor' },
      { id: 'r1', type: 'resistor', at: [5.6, -0.8], opts: { ohms: '330' }, label: '330 Ω resistor' },
      { id: 'led', type: 'led', at: [7.8, -0.8], opts: { color: 'red' }, label: 'Alarm LED' },
    ],
    wires: [['5V', 'pir.VCC'], ['GPIO4', 'pir.OUT'], ['pir.GND', 'GND'], ['GPIO17', 'r1.1'], ['r1.2', 'led.A'], ['led.K', 'GND']],
    inputs: [{ id: 'motion', type: 'pulse', label: 'Walk past', ms: 2500 }],
    pinout: [['5V', 'PIR VCC', 'The sensor needs 4.5–20 V.'], ['GPIO4', 'PIR OUT', '3.3 V HIGH while it sees motion.'], ['GND', 'PIR GND', 'Common ground.'], ['GPIO17', 'Resistor → LED', 'Alarm light.']],
    steps: ['<code>MotionSensor(4)</code> reads the PIR output, smoothing it with a short queue.', '<code>wait_for_motion()</code> blocks until it trips, <code>wait_for_no_motion()</code> until it clears.', 'Turn the two potentiometers on the module to set sensitivity and how long OUT stays high; the jumper picks single or repeat trigger.', 'Give it up to a minute after power-up to settle.'],
    specs: [['Sensor', 'HC-SR501 PIR'], ['Supply', '5 V (4.5–20 V)'], ['Output', '3.3 V, HIGH on motion'], ['Range', 'up to ~7 m, 110° cone'], ['Hold time', '≈ 3 s – 5 min (adjustable)']],
    code: `from gpiozero import MotionSensor, LED
from datetime import datetime

pir = MotionSensor(4)
led = LED(17)

print("Waiting for the sensor to settle…")
pir.wait_for_no_motion()

while True:
    pir.wait_for_motion()
    led.on()
    print(datetime.now().strftime("%H:%M:%S"), "Motion!")
    pir.wait_for_no_motion()
    led.off()`,
    async run(ctx) {
      ctx.at('print("Waiting'); ctx.print('Waiting for the sensor to settle…'); await ctx.sleep(800);
      for (;;) {
        ctx.at('pir.wait_for_motion()');
        await ctx.until(() => ctx.input('motion'));
        ctx.set('pir', { motion: true });
        ctx.at('led.on()'); ctx.set('led', { on: true });
        ctx.at('"Motion!"'); ctx.print(`${new Date().toTimeString().slice(0, 8)} Motion!`);
        ctx.at('pir.wait_for_no_motion()');
        await ctx.until(() => !ctx.input('motion'));
        ctx.set('pir', { motion: false });
        ctx.at('led.off()'); ctx.set('led', { on: false });
      }
    },
  },
  // ------------------------------------------------------------------------
  {
    id: 'ultrasonic', title: 'Distance sensor', short: 'HC-SR04 with a divider',
    difficulty: 'Intermediate', time: '25 min', topics: ['Sensor', 'Voltage'],
    lede: 'The HC-SR04 times an ultrasonic echo to measure distance. It needs 5 V and its ECHO pin answers at 5 V — too much for a Pi pin — so a 1 kΩ / 2 kΩ divider brings it down to about 3.3 V.',
    features: [['warn', 'Protect 3.3 V GPIO with a voltage divider'], ['wave', 'Distance from the echo’s time of flight'], ['hand', 'Move the distance slider in Inputs']],
    parts: [
      { id: 'us', type: 'hcsr04', at: [3.2, -1.6], label: 'HC-SR04' },
      { id: 'r1', type: 'resistor', at: [2.4, 1.6], opts: { ohms: '1k' }, label: '1 kΩ (top)' },
      { id: 'r2', type: 'resistor', at: [5.6, 1.6], opts: { ohms: '2k' }, label: '2 kΩ (bottom)' },
    ],
    wires: [['5V', 'us.VCC'], ['GPIO23', 'us.TRIG'], ['us.ECHO', 'r1.1'], ['r1.2', 'GPIO24'], ['r1.2', 'r2.1'], ['r2.2', 'GND'], ['us.GND', 'GND']],
    inputs: [{ id: 'dist', type: 'range', label: 'Distance', min: 3, max: 300, step: 1, value: 42, unit: 'cm' }],
    pinout: [['5V', 'VCC', 'The module needs 5 V.'], ['GPIO23', 'TRIG', 'A 10 µs pulse starts a measurement (3.3 V is enough).'], ['GPIO24', 'ECHO via divider', '5 V × 2k ÷ (1k + 2k) ≈ 3.3 V.'], ['GND', 'GND and the 2 kΩ', 'Common ground.']],
    steps: ['<code>DistanceSensor(echo=24, trigger=23)</code> fires the trigger and times the echo pulse.', 'Sound travels ~343 m/s; the distance is half the round trip.', 'The divider: never connect a 5 V output straight to a Pi GPIO — it can damage RP1. (The HC-SR04P / “3.3 V” versions avoid this.)', '<code>sensor.distance</code> is in metres, capped at <code>max_distance</code>.'],
    specs: [['Range', '2 cm – 4 m'], ['Supply', '5 V, 15 mA'], ['Divider', '1 kΩ + 2 kΩ → ≈ 3.33 V'], ['Beam', '≈ 15°'], ['Pins', 'TRIG GPIO 23, ECHO GPIO 24']],
    code: `from gpiozero import DistanceSensor
from time import sleep

# ECHO goes through a 1 kΩ / 2 kΩ divider: 5 V -> 3.3 V
sensor = DistanceSensor(echo=24, trigger=23, max_distance=4)

while True:
    print(f"Distance: {sensor.distance * 100:.1f} cm")
    sleep(0.5)`,
    async run(ctx) {
      for (;;) {
        ctx.at('print(f"Distance'); ctx.set('us', { ping: true }); ctx.set('us', { ping: false });
        const d = Math.min(400, ctx.input('dist') + (Math.random() - 0.5) * 0.6);
        ctx.print(`Distance: ${fmt(d)} cm`);
        ctx.readout('us', `${fmt(d)} cm`);
        ctx.at('sleep(0.5)'); await ctx.sleep(500);
      }
    },
  },
  // ------------------------------------------------------------------------
  {
    id: 'dht22', title: 'Temperature & humidity', short: 'DHT22 sensor',
    difficulty: 'Beginner', time: '20 min', topics: ['Sensor', 'Library'],
    lede: 'The DHT22 measures temperature and humidity and sends both down a single data wire. Adafruit’s CircuitPython library (through Blinka) reads it on the Pi 5.',
    features: [['eye', 'One-wire style timing protocol'], ['code', 'Handle the occasional bad read with try/except'], ['hand', 'Change the room in Inputs']],
    parts: [{ id: 'dht', type: 'dht22', at: [3.0, 0.2], label: 'DHT22' }],
    wires: [['3V3', 'dht.VCC'], ['GPIO4', 'dht.DATA'], ['dht.GND', 'GND']],
    inputs: [{ id: 'temp', type: 'range', label: 'Room', min: -5, max: 45, step: 0.5, value: 22.5, unit: '°C' }, { id: 'hum', type: 'range', label: 'Humidity', min: 10, max: 95, step: 1, value: 48, unit: '%' }],
    pinout: [['3V3', 'VCC', 'Runs from 3.3 V (3.3–6 V).'], ['GPIO4', 'DATA', 'Bidirectional; the module has the 10 kΩ pull-up.'], ['GND', 'GND', 'Ground.']],
    steps: ['Install: <code>pip install adafruit-circuitpython-dht</code> (in a virtual environment) — Blinka provides <code>board</code>.', '<code>board.D4</code> is GPIO 4.', 'Reads can fail with a checksum error; just try again on the next loop.', 'Don’t read faster than every 2 seconds.'],
    specs: [['Temperature', '−40 … 80 °C, ±0.5 °C'], ['Humidity', '0 … 100 % RH, ±2 %'], ['Rate', '0.5 Hz'], ['Supply', '3.3–6 V']],
    code: `import board
import adafruit_dht
from time import sleep

dht = adafruit_dht.DHT22(board.D4)

while True:
    try:
        t = dht.temperature
        h = dht.humidity
        print(f"{t:.1f} °C   {h:.1f} % RH")
    except RuntimeError as err:     # checksum errors happen; try again
        print("Retrying:", err.args[0])
    sleep(2.0)`,
    async run(ctx) {
      let n = 0;
      for (;;) {
        ctx.at('t = dht.temperature'); await ctx.sleep(200);
        if (++n % 5 === 3) { ctx.at('print("Retrying:"'); ctx.print('Retrying: Checksum did not validate. Try again.'); }
        else { ctx.at('print(f"{t'); const t = ctx.input('temp') + (Math.random() - 0.5) * 0.2, h = ctx.input('hum') + (Math.random() - 0.5); ctx.print(`${fmt(t)} °C   ${fmt(h)} % RH`); ctx.readout('dht', `${fmt(t)} °C · ${fmt(h, 0)} %`); }
        ctx.at('sleep(2.0)'); await ctx.sleep(2000);
      }
    },
  },
  // ------------------------------------------------------------------------
  {
    id: 'bme280', title: 'Weather station', short: 'BME280 on I2C',
    difficulty: 'Intermediate', time: '25 min', topics: ['I2C', 'Sensor'],
    lede: 'The BME280 measures temperature, humidity and air pressure, and talks over I2C — two wires shared by many devices, each with an address. Enable I2C in raspi-config, then find it with <code>i2cdetect -y 1</code>.',
    features: [['chip', 'I2C bus 1 on GPIO 2 (SDA) and 3 (SCL)'], ['eye', 'Three sensors in one tiny chip'], ['hand', 'Change the weather in Inputs']],
    parts: [{ id: 'bme', type: 'bme280', at: [3.0, 0.2], label: 'BME280' }],
    wires: [['3V3', 'bme.VIN'], ['bme.GND', 'GND'], ['GPIO3', 'bme.SCL'], ['GPIO2', 'bme.SDA']],
    inputs: [{ id: 'temp', type: 'range', label: 'Temperature', min: -10, max: 40, step: 0.5, value: 19.5, unit: '°C' }, { id: 'press', type: 'range', label: 'Pressure', min: 960, max: 1050, step: 1, value: 1012, unit: 'hPa' }],
    pinout: [['3V3', 'VIN', 'Power.'], ['GND', 'GND', 'Ground.'], ['GPIO3', 'SCL', 'I2C clock (pin 5); Pi has 1.8 kΩ pull-ups.'], ['GPIO2', 'SDA', 'I2C data (pin 3).']],
    steps: ['Enable I2C: <code>sudo raspi-config</code> → Interface Options → I2C.', '<code>i2cdetect -y 1</code> should show <code>76</code> (or <code>77</code>).', 'Install <code>adafruit-circuitpython-bme280</code>; <code>board.I2C()</code> opens bus 1.', 'Set <code>sea_level_pressure</code> to your local value to get a sensible altitude.'],
    specs: [['Temperature', '−40 … 85 °C, ±1 °C'], ['Humidity', '±3 % RH'], ['Pressure', '300 – 1100 hPa, ±1 hPa'], ['Address', '0x76 or 0x77'], ['Bus', 'I2C, up to 3.4 MHz']],
    code: `import board
from adafruit_bme280 import basic as adafruit_bme280
from time import sleep

i2c = board.I2C()          # GPIO2 = SDA, GPIO3 = SCL
bme = adafruit_bme280.Adafruit_BME280_I2C(i2c, address=0x76)
bme.sea_level_pressure = 1013.25

while True:
    print(f"{bme.temperature:.1f} °C  "
          f"{bme.relative_humidity:.0f} %  "
          f"{bme.pressure:.1f} hPa  "
          f"{bme.altitude:.0f} m")
    sleep(2)`,
    async run(ctx) {
      ctx.at('bme = '); ctx.print('I2C: found device at 0x76'); await ctx.sleep(400);
      for (;;) {
        ctx.at('print(f"{bme.temperature');
        const t = ctx.input('temp') + (Math.random() - 0.5) * 0.1, p = ctx.input('press') + (Math.random() - 0.5) * 0.2;
        const alt = 44330 * (1 - Math.pow(p / 1013.25, 0.1903));
        ctx.print(`${fmt(t)} °C  ${fmt(52 + Math.sin(Date.now() / 9000) * 3, 0)} %  ${fmt(p)} hPa  ${fmt(alt, 0)} m`);
        ctx.readout('bme', `${fmt(t)} °C · ${fmt(p, 0)} hPa`);
        ctx.at('sleep(2)'); await ctx.sleep(2000);
      }
    },
  },
  // ------------------------------------------------------------------------
  {
    id: 'pot', title: 'Dimmer knob', short: 'Analog in with an MCP3008',
    difficulty: 'Intermediate', time: '30 min', topics: ['SPI', 'Analog'],
    lede: 'The Pi has no analog inputs, so an MCP3008 converts the potentiometer’s voltage into a number over SPI. Turn the knob and the LED follows.',
    features: [['chip', 'SPI: MOSI, MISO, SCLK and a chip select'], ['wave', 'A 10-bit reading, 0–1023 → 0.0–1.0'], ['hand', 'Turn the knob in Inputs']],
    parts: [
      { id: 'adc', type: 'mcp3008', at: [2.0, 0.6], label: 'MCP3008' },
      { id: 'pot', type: 'pot', at: [6.4, 1.8], label: '10 kΩ knob' },
      { id: 'r1', type: 'resistor', at: [6.0, -1.4], opts: { ohms: '330' }, label: '330 Ω' },
      { id: 'led', type: 'led', at: [8.2, -1.4], opts: { color: 'yellow' }, label: 'LED' },
    ],
    wires: [['3V3', 'adc.VDD'], ['3V3', 'adc.VREF'], ['adc.AGND', 'GND'], ['adc.DGND', 'GND'], ['GPIO11', 'adc.CLK'], ['GPIO9', 'adc.DOUT'], ['GPIO10', 'adc.DIN'], ['GPIO8', 'adc.CS'],
      ['pot.3', '3V3'], ['pot.1', 'GND'], ['pot.W', 'adc.CH0'], ['GPIO18', 'r1.1'], ['r1.2', 'led.A'], ['led.K', 'GND']],
    inputs: [{ id: 'knob', type: 'range', label: 'Knob', min: 0, max: 1, step: 0.01, value: 0.35 }],
    pinout: [['GPIO11', 'CLK', 'SPI0 SCLK (pin 23).'], ['GPIO9', 'DOUT', 'SPI0 MISO (pin 21).'], ['GPIO10', 'DIN', 'SPI0 MOSI (pin 19).'], ['GPIO8', 'CS', 'SPI0 CE0 (pin 24).'], ['3V3', 'VDD, VREF, knob end', 'Readings are relative to 3.3 V.'], ['GPIO18', 'Resistor → LED', 'PWM output.']],
    steps: ['Enable SPI in raspi-config.', '<code>MCP3008(channel=0)</code> reads CH0 over SPI0 / CE0; <code>.value</code> is 0–1, <code>.voltage</code> in volts.', 'Assigning the reading to the LED makes a dimmer in one line. gpiozero can even do it as <code>led.source = pot</code>.'],
    specs: [['ADC', 'MCP3008, 8 channels, 10-bit'], ['Sample rate', 'up to 200 ksps at 5 V'], ['Reference', '3.3 V'], ['Knob', '10 kΩ linear']],
    code: `from gpiozero import MCP3008, PWMLED
from time import sleep

pot = MCP3008(channel=0)    # SPI0: MOSI 10, MISO 9, SCLK 11, CE0 8
led = PWMLED(18)

while True:
    led.value = pot.value    # 0.0 … 1.0
    print(f"Knob {pot.value:.2f}  ({pot.voltage:.2f} V)")
    sleep(0.2)`,
    async run(ctx) {
      for (;;) {
        const k = ctx.input('knob');
        ctx.set('pot', { value: k });
        ctx.at('led.value = pot.value'); ctx.set('led', { on: k });
        ctx.at('print(f"Knob'); ctx.print(`Knob ${fmt(k, 2)}  (${fmt(k * 3.3, 2)} V)`);
        ctx.readout('pot', `${Math.round(k * 1023)} / 1023`);
        await ctx.sleep(200);
      }
    },
  },
  // ------------------------------------------------------------------------
  {
    id: 'ldr', title: 'Night light', short: 'Light sensor (LDR)',
    difficulty: 'Intermediate', time: '25 min', topics: ['SPI', 'Analog'],
    lede: 'A light-dependent resistor and a 10 kΩ resistor make a voltage that rises with light. The MCP3008 reads it, and when the room gets dark the lamp comes on.',
    features: [['eye', 'A voltage divider as a sensor'], ['code', 'A threshold decides on or off'], ['hand', 'Dim the room in Inputs']],
    parts: [
      { id: 'adc', type: 'mcp3008', at: [2.0, 0.6], label: 'MCP3008' },
      { id: 'ldr', type: 'ldr', at: [5.8, 2.0], label: 'LDR' },
      { id: 'r10k', type: 'resistor', at: [7.6, 2.0], opts: { ohms: '10k' }, label: '10 kΩ' },
      { id: 'r1', type: 'resistor', at: [6.0, -1.4], opts: { ohms: '330' }, label: '330 Ω' },
      { id: 'led', type: 'led', at: [8.2, -1.4], opts: { color: 'white' }, label: 'Lamp LED' },
    ],
    wires: [['3V3', 'adc.VDD'], ['3V3', 'adc.VREF'], ['adc.AGND', 'GND'], ['adc.DGND', 'GND'], ['GPIO11', 'adc.CLK'], ['GPIO9', 'adc.DOUT'], ['GPIO10', 'adc.DIN'], ['GPIO8', 'adc.CS'],
      ['3V3', 'ldr.1'], ['ldr.2', 'adc.CH1'], ['ldr.2', 'r10k.1'], ['r10k.2', 'GND'], ['GPIO17', 'r1.1'], ['r1.2', 'led.A'], ['led.K', 'GND']],
    inputs: [{ id: 'light', type: 'range', label: 'Room light', min: 0, max: 1, step: 0.01, value: 0.7 }],
    pinout: [['3V3', 'LDR, top', 'Divider supply.'], ['CH1', 'LDR / 10 kΩ junction', 'Higher voltage = brighter.'], ['GND', '10 kΩ, bottom', 'Divider ground.'], ['SPI0', 'MCP3008', 'As in the dimmer project.'], ['GPIO17', 'Resistor → LED', 'The lamp.']],
    steps: ['In light the LDR drops to a few kΩ, pulling CH1 up; in the dark it climbs past 100 kΩ and CH1 falls.', 'Pick the <code>DARK</code> threshold by printing values in your own room.', 'Add a second threshold (hysteresis) so the lamp doesn’t flicker at dusk.'],
    specs: [['LDR', 'GL5528: ~10 kΩ at 10 lux, ~1 MΩ dark'], ['Divider', 'LDR + 10 kΩ'], ['ADC', 'MCP3008 CH1']],
    code: `from gpiozero import MCP3008, LED
from time import sleep

light = MCP3008(channel=1)   # LDR + 10 kΩ divider
lamp = LED(17)
DARK = 0.3

while True:
    level = light.value
    if level < DARK:
        lamp.on()
    else:
        lamp.off()
    print(f"Light {level:.2f}  lamp {'ON' if lamp.is_lit else 'off'}")
    sleep(0.5)`,
    async run(ctx) {
      for (;;) {
        const raw = ctx.input('light');
        const lvl = 10 / (10 + 2 + (1 - raw) * 60); // divider-ish curve
        const v = Math.min(1, lvl * 1.15);
        ctx.at('level = light.value'); await ctx.sleep(100);
        const on = v < 0.3;
        ctx.at(on ? 'lamp.on()' : 'lamp.off()'); ctx.set('led', { on });
        ctx.print(`Light ${fmt(v, 2)}  lamp ${on ? 'ON' : 'off'}`);
        ctx.readout('ldr', `${fmt(v, 2)}`);
        ctx.ambient(0.35 + raw * 0.65);
        await ctx.sleep(400);
      }
    },
  },
  // ------------------------------------------------------------------------
  {
    id: 'soil', title: 'Plant watcher', short: 'Soil moisture',
    difficulty: 'Intermediate', time: '25 min', topics: ['SPI', 'Analog', 'Sensor'],
    lede: 'A capacitive probe senses the water in the soil without bare metal that corrodes. Its output voltage falls as the soil gets wetter; two calibration readings turn it into a percentage.',
    features: [['wave', 'Calibrate dry and wet, then scale'], ['eye', 'Capacitive: lasts far longer than resistive forks'], ['hand', 'Water the plant in Inputs']],
    parts: [
      { id: 'adc', type: 'mcp3008', at: [2.0, 0.6], label: 'MCP3008' },
      { id: 'soil', type: 'soil', at: [7.2, -0.6], label: 'Soil probe' },
    ],
    wires: [['3V3', 'adc.VDD'], ['3V3', 'adc.VREF'], ['adc.AGND', 'GND'], ['adc.DGND', 'GND'], ['GPIO11', 'adc.CLK'], ['GPIO9', 'adc.DOUT'], ['GPIO10', 'adc.DIN'], ['GPIO8', 'adc.CS'],
      ['3V3', 'soil.VCC'], ['soil.GND', 'GND'], ['soil.AOUT', 'adc.CH2']],
    inputs: [{ id: 'wet', type: 'range', label: 'Soil water', min: 0, max: 100, step: 1, value: 55, unit: '%' }],
    pinout: [['3V3', 'Probe VCC', 'At 3.3 V the output stays under 3.3 V.'], ['GND', 'Probe GND', 'Ground.'], ['CH2', 'Probe AOUT', 'Lower voltage = wetter.'], ['SPI0', 'MCP3008', 'As before.']],
    steps: ['Calibrate: note <code>soil.value</code> with the probe in air (<code>DRY</code>) and in a glass of water up to the line (<code>WET</code>).', 'Scale between them and clamp to 0–100 %.', 'Keep the electronics at the top dry — only the part below the line goes in the soil.'],
    specs: [['Probe', 'Capacitive v1.2, analog out'], ['Supply', '3.3–5.5 V'], ['Output', '≈ 1.2 V wet … 2.6 V dry (at 3.3 V)'], ['ADC', 'MCP3008 CH2']],
    code: `from gpiozero import MCP3008
from time import sleep

soil = MCP3008(channel=2)
DRY, WET = 0.80, 0.40     # calibrate: probe in air, then in water

while True:
    v = soil.value
    moisture = (DRY - v) / (DRY - WET) * 100
    moisture = max(0, min(100, moisture))
    status = "water me!" if moisture < 30 else "ok"
    print(f"Soil moisture {moisture:3.0f} %  {status}")
    sleep(1)`,
    async run(ctx) {
      for (;;) {
        const m = ctx.input('wet');
        const v = 0.8 - (m / 100) * 0.4 + (Math.random() - 0.5) * 0.005;
        ctx.at('v = soil.value'); await ctx.sleep(150);
        ctx.at('print(f"Soil'); ctx.print(`Soil moisture ${String(Math.round(m)).padStart(3)} %  ${m < 30 ? 'water me!' : 'ok'}`);
        ctx.readout('soil', `${Math.round(m)} %`);
        await ctx.sleep(850);
      }
    },
  },
  // ------------------------------------------------------------------------
  {
    id: 'gas', title: 'Smoke & gas alarm', short: 'MQ-2 sensor',
    difficulty: 'Intermediate', time: '30 min', topics: ['SPI', 'Analog', 'Voltage'],
    lede: 'The MQ-2’s heated element changes resistance in smoke and flammable gas. It needs 5 V and its analog output reaches 5 V, so a 10 kΩ / 20 kΩ divider scales it before the MCP3008. Above the threshold, the buzzer sounds. A learning project — not a certified alarm.',
    features: [['warn', 'Scale a 5 V signal for a 3.3 V ADC'], ['clock', 'Warm-up time before readings settle'], ['hand', 'Add smoke in Inputs']],
    parts: [
      { id: 'adc', type: 'mcp3008', at: [1.6, 0.8], label: 'MCP3008' },
      { id: 'mq', type: 'mq2', at: [6.6, -1.2], label: 'MQ-2' },
      { id: 'ra', type: 'resistor', at: [5.6, 2.2], opts: { ohms: '10k' }, label: '10 kΩ (top)' },
      { id: 'rb', type: 'resistor', at: [8.4, 2.2], opts: { ohms: '20k' }, label: '20 kΩ (bottom)' },
      { id: 'bz', type: 'buzzer', at: [9.2, -1.0], label: 'Buzzer' },
    ],
    wires: [['3V3', 'adc.VDD'], ['3V3', 'adc.VREF'], ['adc.AGND', 'GND'], ['adc.DGND', 'GND'], ['GPIO11', 'adc.CLK'], ['GPIO9', 'adc.DOUT'], ['GPIO10', 'adc.DIN'], ['GPIO8', 'adc.CS'],
      ['5V', 'mq.VCC'], ['mq.GND', 'GND'], ['mq.AO', 'ra.1'], ['ra.2', 'adc.CH3'], ['ra.2', 'rb.1'], ['rb.2', 'GND'], ['GPIO17', 'bz.+'], ['bz.-', 'GND']],
    inputs: [{ id: 'smoke', type: 'range', label: 'Smoke', min: 0, max: 1, step: 0.01, value: 0.1 }],
    pinout: [['5V', 'MQ-2 VCC', 'The heater draws ~150 mA.'], ['CH3', 'Divider middle', '0–5 V scaled to 0–3.3 V.'], ['GND', 'MQ-2 GND, 20 kΩ', 'Ground.'], ['GPIO17', 'Buzzer +', 'Alarm.'], ['DO', 'Not used', 'Its 5 V digital output would need a divider too.']],
    steps: ['The heater must warm up: minutes on first use, and a burn-in of a day or two for stable readings.', 'Readings depend on temperature and humidity — set the threshold with your own clean-air baseline.', 'Ratio of the divider: 20k ÷ (10k + 20k) = ⅔, so 5 V → 3.33 V.', 'For real safety, use a certified smoke/CO alarm.'],
    specs: [['Sensor', 'MQ-2 (SnO₂), LPG, smoke, H₂, CH₄'], ['Heater', '5 V, ≈ 800 mW'], ['Divider', '10 kΩ + 20 kΩ'], ['Warm-up', '≥ 20 s, better minutes']],
    code: `from gpiozero import MCP3008, Buzzer
from time import sleep

gas = MCP3008(channel=3)    # MQ-2 AO through a 10 kΩ / 20 kΩ divider
alarm = Buzzer(17)
THRESHOLD = 0.45

print("Heating the sensor…")
sleep(20)

while True:
    level = gas.value
    if level > THRESHOLD:
        alarm.on()
        print(f"GAS! level {level:.2f}")
    else:
        alarm.off()
        print(f"Clean air  {level:.2f}")
    sleep(0.5)`,
    async run(ctx) {
      ctx.at('print("Heating'); ctx.print('Heating the sensor… (20 s, shortened in the simulation)');
      ctx.at('sleep(20)');
      for (let i = 1; i <= 4; i++) { ctx.set('mq', { gas: 0.2 * i }); await ctx.sleep(500); }
      for (;;) {
        const s = ctx.input('smoke');
        const lvl = 0.12 + s * 0.8 + (Math.random() - 0.5) * 0.01;
        ctx.set('mq', { gas: 0.4 + s * 2 });
        ctx.at('level = gas.value'); await ctx.sleep(100);
        if (lvl > 0.45) { ctx.at('alarm.on()'); ctx.set('bz', { on: true }); ctx.beep(true); ctx.print(`GAS! level ${fmt(lvl, 2)}`); }
        else { ctx.at('alarm.off()'); ctx.set('bz', { on: false }); ctx.beep(false); ctx.print(`Clean air  ${fmt(lvl, 2)}`); }
        ctx.readout('mq', fmt(lvl, 2));
        await ctx.sleep(400);
      }
    },
  },
];

export function hsv(h) {
  const i = Math.floor(h * 6), f = h * 6 - i, q = 1 - f;
  return [[1, q, 0, 0, f, 1], [f, 1, 1, q, 0, 0], [0, 0, f, 1, 1, q]].map((c) => c[i % 6]);
}
