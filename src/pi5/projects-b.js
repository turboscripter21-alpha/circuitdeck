// Raspberry Pi 5 projects, part 2: displays, motion, power, camera and AI.
const fmt = (n, d = 1) => Number(n).toFixed(d);
const SPI_WIRES = (id, { miso = null } = {}) => [['GPIO10', `${id}.DIN`], ['GPIO11', `${id}.CLK`], ['GPIO8', `${id}.CS`], ...(miso ? [['GPIO9', `${id}.${miso}`]] : [])];
const CAMERA_PARTS = [{ id: 'cam', type: 'cam3', at: [-6.0, 6.2], table: true, label: 'Camera Module 3', why: 'Picamera2 would report “no cameras available”' }];
const AI_PARTS = [
  { id: 'cooler', type: 'cooler', mount: 'pi', at: [-0.6, -0.15], label: 'Active Cooler', required: false },
  { id: 'ai', type: 'aikit', at: [-16.2, 0.6], table: true, label: 'AI Kit (Hailo-8L)', why: 'there would be no Hailo device for the model to run on' },
];

// --- tiny drawing helpers for the simulated camera feed ---------------------
function room(c, w, h, dark = false) {
  const g = c.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, dark ? '#2a2e35' : '#d9d3c7'); g.addColorStop(0.62, dark ? '#353a42' : '#c9c1b2'); g.addColorStop(0.63, dark ? '#24272c' : '#8f8576'); g.addColorStop(1, dark ? '#1b1d21' : '#6f6658');
  c.fillStyle = g; c.fillRect(0, 0, w, h);
  c.fillStyle = dark ? '#3f4651' : '#b9b1a2'; c.fillRect(w * 0.07, h * 0.12, w * 0.22, h * 0.3); // window/picture
  c.fillStyle = dark ? '#2b3038' : '#a69d8c'; c.fillRect(w * 0.72, h * 0.25, w * 0.18, h * 0.38); // door
}
function person(c, x, y, s, col = '#3c4a5e') {
  c.fillStyle = col;
  c.beginPath(); c.arc(x, y - s * 0.78, s * 0.12, 0, 7); c.fill();
  c.beginPath(); c.roundRect(x - s * 0.17, y - s * 0.64, s * 0.34, s * 0.42, s * 0.08); c.fill();
  c.fillRect(x - s * 0.15, y - s * 0.26, s * 0.12, s * 0.26); c.fillRect(x + s * 0.03, y - s * 0.26, s * 0.12, s * 0.26);
}
function hud(c, w, h, text) {
  c.fillStyle = 'rgba(0,0,0,0.45)'; c.fillRect(0, h - 22, w, 22);
  c.fillStyle = '#fff'; c.font = '600 12px "Barlow Semi Condensed", system-ui, sans-serif'; c.textBaseline = 'middle'; c.fillText(text, 8, h - 11);
}
function qrPattern(c, x, y, s, seed) {
  const n = 25, u = s / n;
  c.fillStyle = '#fff'; c.fillRect(x - u * 2, y - u * 2, s + u * 4, s + u * 4);
  c.fillStyle = '#111';
  let r = seed;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { r = (r * 1103515245 + 12345) & 0x7fffffff; if (r % 100 < 47) c.fillRect(x + i * u, y + j * u, u, u); }
  for (const [fx, fy] of [[0, 0], [n - 7, 0], [0, n - 7]]) {
    c.fillStyle = '#fff'; c.fillRect(x + (fx - 1) * u, y + (fy - 1) * u, 9 * u, 9 * u);
    c.fillStyle = '#111'; c.fillRect(x + fx * u, y + fy * u, 7 * u, 7 * u);
    c.fillStyle = '#fff'; c.fillRect(x + (fx + 1) * u, y + (fy + 1) * u, 5 * u, 5 * u);
    c.fillStyle = '#111'; c.fillRect(x + (fx + 2) * u, y + (fy + 2) * u, 3 * u, 3 * u);
  }
}
const lcdText = (c, w, h, rows) => {
  c.fillStyle = '#7fb33f'; c.fillRect(0, 0, w, h);
  const cw = w / 16, ch = h / 2;
  for (let r = 0; r < 2; r++) for (let i = 0; i < 16; i++) {
    c.fillStyle = 'rgba(40,70,20,0.18)'; c.fillRect(i * cw + 2, r * ch + 4, cw - 4, ch - 8);
    const t = (rows[r] || '')[i];
    if (t && t !== ' ') { c.fillStyle = '#1d3410'; c.font = `700 ${Math.round(ch * 0.66)}px "Courier New", monospace`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(t, i * cw + cw / 2, r * ch + ch / 2 + 1); }
  }
  c.textAlign = 'left';
};

export const PROJECTS_B = [
  // ------------------------------------------------------------------------
  {
    id: 'oled', title: 'OLED status screen', short: 'SSD1306 on I2C',
    difficulty: 'Intermediate', time: '25 min', topics: ['I2C', 'Display'],
    lede: 'A 128 × 64 OLED shows the time and the CPU temperature. The luma.oled library draws with Pillow, so text, shapes and images all work.',
    features: [['chip', 'Shares the I2C bus at address 0x3C'], ['code', 'Draw with Pillow inside <code>with canvas(device)</code>'], ['eye', 'Each pixel lights itself — no backlight']],
    parts: [{ id: 'oled', type: 'oled', at: [3.0, 0.2], label: 'OLED 0.96"' }],
    wires: [['GND', 'oled.GND'], ['3V3', 'oled.VCC'], ['GPIO3', 'oled.SCL'], ['GPIO2', 'oled.SDA']],
    pinout: [['3V3', 'VCC', 'Power.'], ['GND', 'GND', 'Ground.'], ['GPIO3', 'SCL', 'I2C clock.'], ['GPIO2', 'SDA', 'I2C data.']],
    steps: ['Enable I2C and check <code>i2cdetect -y 1</code> shows <code>3c</code>.', 'Install <code>luma.oled</code> in a virtual environment.', 'Everything drawn inside the <code>with</code> block is sent to the screen when the block ends.'],
    specs: [['Display', '0.96" OLED, 128 × 64, monochrome'], ['Driver', 'SSD1306'], ['Address', '0x3C'], ['Supply', '3.3–5 V, ~20 mA']],
    code: `from luma.core.interface.serial import i2c
from luma.oled.device import ssd1306
from luma.core.render import canvas
from gpiozero import CPUTemperature
from datetime import datetime
from time import sleep

device = ssd1306(i2c(port=1, address=0x3C))
cpu = CPUTemperature()

while True:
    with canvas(device) as draw:
        draw.text((0, 0), "CircuitDeck Pi 5", fill="white")
        draw.text((0, 20), datetime.now().strftime("%H:%M:%S"), fill="white")
        draw.text((0, 40), f"CPU {cpu.temperature:.1f} C", fill="white")
    sleep(1)`,
    async run(ctx) {
      ctx.at('device = ssd1306'); ctx.print('SSD1306 found at 0x3C'); await ctx.sleep(300);
      for (;;) {
        ctx.at('with canvas(device)');
        const temp = 48 + Math.sin(Date.now() / 4000) * 2;
        ctx.screen('oled', (c, w, h) => {
          c.fillStyle = '#05070a'; c.fillRect(0, 0, w, h);
          c.fillStyle = '#bfe9ff'; c.textBaseline = 'top';
          c.font = `600 ${h * 0.14}px monospace`; c.fillText('CircuitDeck Pi 5', w * 0.03, h * 0.04);
          c.font = `700 ${h * 0.26}px monospace`; c.fillText(new Date().toTimeString().slice(0, 8), w * 0.03, h * 0.3);
          c.font = `600 ${h * 0.14}px monospace`; c.fillText(`CPU ${fmt(temp)} C`, w * 0.03, h * 0.7);
        });
        ctx.at('sleep(1)'); await ctx.sleep(1000);
      }
    },
  },
  // ------------------------------------------------------------------------
  {
    id: 'lcd1602', title: '16×2 LCD clock', short: 'I2C backpack + level shifter',
    difficulty: 'Intermediate', time: '30 min', topics: ['I2C', 'Display', 'Voltage'],
    lede: 'Character LCDs need 5 V, and their I2C backpack pulls SDA and SCL up to 5 V too. A level shifter keeps the Pi’s 3.3 V pins safe while the RPLCD library writes the date and time.',
    features: [['warn', 'Level shifting a 5 V I2C bus'], ['chip', 'PCF8574 backpack at 0x27'], ['code', 'Position text with <code>cursor_pos</code>']],
    parts: [
      { id: 'ls', type: 'levelshift', at: [1.2, 1.4], label: 'Level shifter' },
      { id: 'lcd', type: 'lcd1602', at: [5.8, -0.6], label: 'LCD 16×2' },
    ],
    wires: [['3V3', 'ls.LV'], ['5V', 'ls.HV'], ['ls.GND', 'GND'], ['GPIO2', 'ls.LV1'], ['GPIO3', 'ls.LV2'], ['ls.HV1', 'lcd.SDA'], ['ls.HV2', 'lcd.SCL'], ['5V', 'lcd.VCC'], ['lcd.GND', 'GND']],
    pinout: [['GPIO2 → LV1', 'HV1 → SDA', 'I2C data, shifted.'], ['GPIO3 → LV2', 'HV2 → SCL', 'I2C clock, shifted.'], ['3V3', 'LV', 'Low side reference.'], ['5V', 'HV and LCD VCC', 'High side and the display.'], ['GND', 'Shifter + LCD', 'Common ground.']],
    steps: ['Install <code>RPLCD</code> and <code>smbus2</code>.', '<code>CharLCD(\'PCF8574\', 0x27)</code> — some backpacks are at <code>0x3F</code>; check with <code>i2cdetect -y 1</code>.', 'Turn the blue contrast trimmer on the backpack if you see only blocks or nothing.', 'Padding the second line with spaces overwrites leftover characters.'],
    specs: [['Display', '16 × 2 characters, HD44780'], ['Backpack', 'PCF8574, address 0x27 / 0x3F'], ['Supply', '5 V, backlight ~20 mA'], ['Shifter', 'BSS138, 3.3 V ↔ 5 V']],
    code: `from RPLCD.i2c import CharLCD
from datetime import datetime
from time import sleep

lcd = CharLCD('PCF8574', 0x27, cols=16, rows=2)

while True:
    lcd.cursor_pos = (0, 0)
    lcd.write_string(datetime.now().strftime("%d %b  %H:%M:%S"))
    lcd.cursor_pos = (1, 0)
    lcd.write_string("Hello, Pi 5!    ")
    sleep(1)`,
    async run(ctx) {
      ctx.at('lcd = CharLCD'); await ctx.sleep(300);
      for (;;) {
        const d = new Date();
        const top = `${String(d.getDate()).padStart(2, '0')} ${d.toLocaleString('en', { month: 'short' })}  ${d.toTimeString().slice(0, 8)}`;
        ctx.at('lcd.write_string(datetime');
        ctx.screen('lcd', (c, w, h) => lcdText(c, w, h, [top, 'Hello, Pi 5!']));
        ctx.at('sleep(1)'); await ctx.sleep(1000);
      }
    },
  },
  // ------------------------------------------------------------------------
  {
    id: 'e-ink', title: 'E-ink name badge', short: 'Paper-like display on SPI',
    difficulty: 'Intermediate', time: '30 min', topics: ['SPI', 'Display'],
    lede: 'E-ink only uses power to change the picture, then holds it with the power off. A 2.13" Waveshare panel shows a badge drawn with Pillow; a full refresh takes a couple of seconds and flashes, which is normal.',
    features: [['eye', 'Keeps the image with no power'], ['chip', 'SPI plus DC, RST and BUSY pins'], ['clock', 'Slow full refresh — use it for things that change rarely']],
    parts: [{ id: 'epd', type: 'epaper', at: [3.6, 0.0], label: 'E-ink 2.13"' }],
    wires: [['3V3', 'epd.VCC'], ['epd.GND', 'GND'], ...SPI_WIRES('epd'), ['GPIO25', 'epd.DC'], ['GPIO17', 'epd.RST'], ['GPIO24', 'epd.BUSY']],
    pinout: [['GPIO10', 'DIN', 'SPI MOSI.'], ['GPIO11', 'CLK', 'SPI clock.'], ['GPIO8', 'CS', 'SPI CE0.'], ['GPIO25', 'DC', 'Data / command select.'], ['GPIO17', 'RST', 'Reset.'], ['GPIO24', 'BUSY', 'HIGH while the panel is refreshing.'], ['3V3 / GND', 'VCC / GND', 'Power.']],
    steps: ['Enable SPI; install Waveshare’s <code>waveshare_epd</code> Python package (its current version supports Pi 5 through gpiozero/lgpio).', 'The image is 250 × 122 in landscape: note <code>(epd.height, epd.width)</code>.', '<code>epd.sleep()</code> powers the panel down — the picture stays.', 'Check your panel’s version (V2, V3, V4) and import the matching module.'],
    specs: [['Panel', '2.13", 250 × 122, black/white'], ['Refresh', '≈ 2 s full'], ['Interface', 'SPI + DC, RST, BUSY'], ['Supply', '3.3 V']],
    code: `from waveshare_epd import epd2in13_V4
from PIL import Image, ImageDraw, ImageFont
from datetime import datetime

epd = epd2in13_V4.EPD()
epd.init()
epd.Clear(0xFF)

image = Image.new("1", (epd.height, epd.width), 255)   # 250 x 122
draw = ImageDraw.Draw(image)
font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 22)
draw.text((8, 10), "Hello, I'm Pi", font=font, fill=0)
draw.text((8, 50), datetime.now().strftime("%a %d %b %H:%M"), font=font, fill=0)
draw.rectangle((0, 100, 250, 122), fill=0)

epd.display(epd.getbuffer(image))
epd.sleep()          # the picture stays with the power off
print("Done: the display keeps the image without power.")`,
    async run(ctx) {
      const paint = (fn) => ctx.screen('epd', fn);
      ctx.at('epd.init()'); await ctx.sleep(300);
      ctx.at('epd.Clear(0xFF)');
      for (let i = 0; i < 4; i++) { paint((c, w, h) => { c.fillStyle = i % 2 ? '#f1efe8' : '#1b1b1b'; c.fillRect(0, 0, w, h); }); await ctx.sleep(260); }
      ctx.at('draw.text((8, 10)'); await ctx.sleep(300);
      ctx.at('epd.display'); ctx.print('Refreshing… (BUSY is HIGH)');
      for (let i = 0; i < 3; i++) { paint((c, w, h) => { c.fillStyle = i % 2 ? '#f1efe8' : '#1b1b1b'; c.fillRect(0, 0, w, h); }); await ctx.sleep(300); }
      const when = new Date().toLocaleString('en', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).replace(',', '');
      paint((c, w, h) => {
        c.fillStyle = '#f1efe8'; c.fillRect(0, 0, w, h);
        c.fillStyle = '#151515'; c.font = `700 ${h * 0.17}px "DejaVu Sans", Arial, sans-serif`; c.textBaseline = 'top';
        c.fillText("Hello, I'm Pi", w * 0.03, h * 0.08); c.fillText(when, w * 0.03, h * 0.41);
        c.fillRect(0, h * 0.82, w, h * 0.18);
      });
      ctx.at('epd.sleep()'); await ctx.sleep(400);
      ctx.at('print("Done'); ctx.print('Done: the display keeps the image without power.', 'cd-ok');
    },
  },
  // ------------------------------------------------------------------------
  {
    id: 'matrix', title: 'Beating heart matrix', short: '8×8 LEDs with MAX7219',
    difficulty: 'Intermediate', time: '25 min', topics: ['SPI', 'Display'],
    lede: 'A MAX7219 drives all 64 LEDs of an 8 × 8 matrix and only needs three SPI wires. Two frames — a big and a small heart — make it beat.',
    features: [['chip', 'One chip multiplexes 64 LEDs'], ['code', 'Draw pixels from bit patterns'], ['bolt', 'Chain several modules for scrolling text']],
    parts: [{ id: 'mx', type: 'matrix', at: [3.2, 0.0], label: 'LED matrix' }],
    wires: [['5V', 'mx.VCC'], ['mx.GND', 'GND'], ['GPIO10', 'mx.DIN'], ['GPIO8', 'mx.CS'], ['GPIO11', 'mx.CLK']],
    pinout: [['5V', 'VCC', 'LEDs need 5 V (up to ~300 mA at full brightness).'], ['GND', 'GND', 'Ground.'], ['GPIO10', 'DIN', 'SPI MOSI.'], ['GPIO8', 'CS', 'SPI CE0.'], ['GPIO11', 'CLK', 'SPI clock.']],
    steps: ['Enable SPI and install <code>luma.led_matrix</code>.', 'Each row is a byte: bit 7 is the left pixel.', 'The matrix only listens, so its 5 V supply never reaches a Pi input.', '<code>cascaded=4</code> and <code>luma.core.legacy.show_message</code> scroll text across four modules.'],
    specs: [['Matrix', '8 × 8 red LEDs'], ['Driver', 'MAX7219, SPI up to 10 MHz'], ['Supply', '5 V'], ['Brightness', '16 levels']],
    code: `from luma.core.interface.serial import spi, noop
from luma.led_matrix.device import max7219
from luma.core.render import canvas
from time import sleep

device = max7219(spi(port=0, device=0, gpio=noop()), cascaded=1)

BIG   = [0x66, 0xFF, 0xFF, 0xFF, 0x7E, 0x3C, 0x18, 0x00]
SMALL = [0x00, 0x24, 0x7E, 0x7E, 0x3C, 0x18, 0x00, 0x00]

def show(rows):
    with canvas(device) as draw:
        for y, row in enumerate(rows):
            for x in range(8):
                if row >> (7 - x) & 1:
                    draw.point((x, y), fill="white")

while True:
    show(BIG)
    sleep(0.4)
    show(SMALL)
    sleep(0.6)`,
    async run(ctx) {
      for (;;) {
        ctx.at('show(BIG)'); ctx.set('mx', { rows: [0x66, 0xFF, 0xFF, 0xFF, 0x7E, 0x3C, 0x18, 0x00] }); ctx.print('♥'); await ctx.sleep(400);
        ctx.at('show(SMALL)'); ctx.set('mx', { rows: [0x00, 0x24, 0x7E, 0x7E, 0x3C, 0x18, 0x00, 0x00] }); await ctx.sleep(600);
      }
    },
  },
  // ------------------------------------------------------------------------
  {
    id: 'neopixel', title: 'NeoPixel ring', short: 'WS2812B over SPI',
    difficulty: 'Intermediate', time: '30 min', topics: ['SPI', 'Output'],
    lede: 'Twelve addressable RGB LEDs on one data wire. The old PWM/DMA NeoPixel trick doesn’t work with the Pi 5’s RP1 chip, so we use the SPI method: the MOSI pin (GPIO 10) generates the timing.',
    features: [['wave', 'Exact WS2812 timing from the SPI clock'], ['bolt', 'Each LED up to 60 mA at full white — keep brightness low'], ['code', '<code>auto_write=False</code> then <code>show()</code>']],
    parts: [{ id: 'ring', type: 'ring', at: [3.6, 0.0], label: 'NeoPixel ring' }],
    wires: [['5V', 'ring.5V'], ['ring.GND', 'GND'], ['GPIO10', 'ring.DIN']],
    pinout: [['5V', '5V', 'Twelve LEDs at 30 % brightness are fine from the Pi.'], ['GND', 'GND', 'Common ground.'], ['GPIO10', 'DIN', 'SPI MOSI; a 74AHCT125 to 5 V is the most reliable option.']],
    steps: ['Enable SPI; install <code>adafruit-circuitpython-neopixel-spi</code>.', '<code>NeoPixel_SPI(board.SPI(), 12)</code> — the data goes out on MOSI only.', 'WS2812B wants a HIGH above ~3.5 V at 5 V supply: 3.3 V usually works on short wires; a level shifter makes it certain.', 'For more than a few dozen pixels, use a separate 5 V supply with grounds joined.'],
    specs: [['LEDs', '12 × WS2812B'], ['Data', '800 kHz, one wire'], ['Supply', '5 V, up to 720 mA (all white)'], ['Library', 'neopixel_spi (SPI0)']],
    code: `import board
import neopixel_spi as neopixel
from time import sleep

pixels = neopixel.NeoPixel_SPI(board.SPI(), 12, brightness=0.3, auto_write=False)
COLORS = [(255, 40, 0), (255, 160, 0), (0, 200, 80), (0, 120, 255)]

step = 0
while True:
    for i in range(12):
        pixels[i] = COLORS[(i + step) // 3 % 4]
    pixels.show()
    step += 1
    sleep(0.08)`,
    async run(ctx) {
      const C = [[255, 40, 0], [255, 160, 0], [0, 200, 80], [0, 120, 255]];
      let step = 0;
      for (;;) {
        ctx.at('pixels[i] = COLORS');
        ctx.set('ring', { pixels: Array.from({ length: 12 }, (_, i) => C[Math.floor((i + step) / 3) % 4]) });
        ctx.at('pixels.show()');
        if (step % 12 === 0) ctx.print(`step ${step}`);
        step++;
        await ctx.sleep(80);
      }
    },
  },
  // ------------------------------------------------------------------------
  {
    id: 'servo', title: 'Servo sweep', short: 'Angles with PWM',
    difficulty: 'Beginner', time: '20 min', topics: ['PWM', 'Motion'],
    lede: 'A hobby servo turns to the angle set by a pulse 50 times a second: about 0.5 ms for one end, 2.5 ms for the other. <code>AngularServo</code> converts degrees for you.',
    features: [['wave', '50 Hz pulses, 0.5–2.5 ms wide'], ['bolt', 'Power from 5 V, signal at 3.3 V'], ['hand', 'Watch the horn follow the code']],
    parts: [{ id: 'sv', type: 'servo', at: [3.8, -0.2], label: 'SG90 servo' }],
    wires: [['5V', 'sv.V+'], ['sv.GND', 'GND'], ['GPIO18', 'sv.SIG']],
    pinout: [['5V', 'Red (V+)', 'Motor power.'], ['GND', 'Brown (GND)', 'Ground.'], ['GPIO18', 'Orange (signal)', 'PWM pulses.']],
    steps: ['gpiozero on Pi 5 uses lgpio, which makes the PWM in software — expect a little jitter. For rock-steady servos use hardware PWM on GPIO 12/13/18/19 (e.g. the rpi-hardware-pwm package) or a PCA9685 board.', 'Pulse widths vary between servos; adjust <code>min_pulse_width</code>/<code>max_pulse_width</code> so it doesn’t strain at the ends.', 'Big servos: give them their own 5–6 V supply with grounds joined.'],
    specs: [['Servo', 'SG90, 180°'], ['Signal', '50 Hz, 0.5–2.5 ms'], ['Supply', '4.8–6 V, ~200 mA moving'], ['Pin', 'GPIO 18']],
    code: `from gpiozero import AngularServo
from time import sleep

servo = AngularServo(18, min_angle=-90, max_angle=90,
                     min_pulse_width=0.0005, max_pulse_width=0.0025)

while True:
    for angle in (-90, -45, 0, 45, 90, 0):
        servo.angle = angle
        print("Angle:", angle)
        sleep(1)`,
    async run(ctx) {
      let cur = 0;
      for (;;) {
        for (const a of [-90, -45, 0, 45, 90, 0]) {
          ctx.at('servo.angle = angle'); ctx.print(`Angle: ${a}  (pulse ${fmt(1.5 + a / 90, 2)} ms)`);
          const from = cur;
          for (let k = 1; k <= 8; k++) { cur = from + (a - from) * (k / 8); ctx.set('sv', { angle: cur }); await ctx.sleep(30); }
          ctx.at('sleep(1)'); await ctx.sleep(760);
        }
      }
    },
  },
  // ------------------------------------------------------------------------
  {
    id: 'dc-motor', title: 'DC motor with an H-bridge', short: 'DRV8833 speed & direction',
    difficulty: 'Intermediate', time: '35 min', topics: ['Motion', 'Power', 'PWM'],
    lede: 'A GPIO pin can’t power a motor — it would damage the Pi. A DRV8833 H-bridge switches battery power to the motor in either direction while the Pi only sends logic signals. PWM on the inputs sets the speed.',
    features: [['bolt', 'Separate motor supply, shared ground'], ['wave', 'PWM speed control'], ['warn', 'Never drive a motor straight from a pin']],
    parts: [
      { id: 'drv', type: 'drv8833', at: [2.2, 0.6], label: 'DRV8833' },
      { id: 'm', type: 'motor', at: [12.6, -1.4], table: true, label: 'TT gear motor' },
      { id: 'bat', type: 'battery', at: [12.4, 3.6], table: true, label: '4 × AA (6 V)' },
    ],
    wires: [['GPIO17', 'drv.IN1'], ['GPIO27', 'drv.IN2'], ['drv.OUT1', 'm.M+'], ['drv.OUT2', 'm.M-'], ['bat.+', 'drv.VM', { color: 0xd83a34 }], ['bat.-', 'drv.GND', { color: 0x2f3547 }], ['drv.GND', 'GND']],
    pinout: [['GPIO17', 'IN1', 'Forward PWM.'], ['GPIO27', 'IN2', 'Backward PWM.'], ['OUT1 / OUT2', 'Motor', 'Bridge outputs.'], ['VM', 'Battery +', '2.7–10.8 V motor supply.'], ['GND', 'Battery − and Pi GND', 'Grounds must be joined.']],
    steps: ['<code>Motor(forward=17, backward=27)</code> drives IN1/IN2: one PWM-ed, the other low.', '<code>motor.stop()</code> sets both low so the motor coasts.', 'The battery feeds the motor; the Pi’s 5 V rail stays clean. Join the grounds or the signals have no reference.', 'The DRV8833 handles 1.2 A per channel (1.5 A peak) — enough for TT and N20 motors.'],
    specs: [['Driver', 'DRV8833 dual H-bridge'], ['Motor supply', '2.7–10.8 V'], ['Current', '1.2 A per channel'], ['Motor', 'TT 3–6 V gear motor'], ['Pins', 'GPIO 17, 27']],
    code: `from gpiozero import Motor
from time import sleep

motor = Motor(forward=17, backward=27)    # DRV8833 IN1, IN2

while True:
    print("Forward, half speed")
    motor.forward(0.5)
    sleep(2)
    print("Forward, full speed")
    motor.forward(1.0)
    sleep(2)
    print("Stop")
    motor.stop()
    sleep(1)
    print("Backward")
    motor.backward(0.7)
    sleep(2)
    motor.stop()
    sleep(1)`,
    async run(ctx) {
      const go = async (needle, label, speed, ms) => { if (label) ctx.print(label); ctx.at(needle); ctx.set('m', { speed }); await ctx.sleep(ms); };
      for (;;) {
        await go('motor.forward(0.5)', 'Forward, half speed', 0.5, 2000);
        await go('motor.forward(1.0)', 'Forward, full speed', 1, 2000);
        await go('motor.stop()', 'Stop', 0, 1000);
        await go('motor.backward(0.7)', 'Backward', -0.7, 2000);
        await go('motor.stop()', null, 0, 1000);
      }
    },
  },
  // ------------------------------------------------------------------------
  {
    id: 'stepper', title: 'Stepper motor', short: '28BYJ-48 + ULN2003',
    difficulty: 'Intermediate', time: '30 min', topics: ['Motion', 'GPIO'],
    lede: 'A stepper turns in exact small steps as its coils are energised in order. The ULN2003 board does the heavy switching; four GPIO pins send the half-step pattern — 4096 steps per turn through the gearbox.',
    features: [['wave', 'An 8-step half-step sequence'], ['clock', 'Speed is the delay between steps'], ['eye', 'The driver’s LEDs show the active coils']],
    parts: [{ id: 'st', type: 'stepper', at: [5.4, 0.0], label: 'Stepper + driver' }],
    wires: [['GPIO17', 'st.IN1'], ['GPIO18', 'st.IN2'], ['GPIO27', 'st.IN3'], ['GPIO22', 'st.IN4'], ['5V', 'st.5V'], ['st.GND', 'GND']],
    pinout: [['GPIO17', 'IN1', 'Coil A.'], ['GPIO18', 'IN2', 'Coil B.'], ['GPIO27', 'IN3', 'Coil C.'], ['GPIO22', 'IN4', 'Coil D.'], ['5V', '5V', '~240 mA while turning.'], ['GND', 'GND', 'Ground.']],
    steps: ['Each pattern tuple says which coils are on; stepping through them turns the rotor.', 'Reverse the list to go backwards.', 'Too short a delay and it stalls: about 1–2 ms per half-step is reliable.', 'Turn all coils off when idle to stop it getting warm.'],
    specs: [['Motor', '28BYJ-48, 5 V, 1:64 gearbox'], ['Steps', '4096 half-steps / turn'], ['Driver', 'ULN2003 Darlington array'], ['Speed', '≈ 10–15 RPM']],
    code: `from gpiozero import OutputDevice
from time import sleep

coils = [OutputDevice(p) for p in (17, 18, 27, 22)]   # IN1..IN4
SEQ = [(1, 0, 0, 0), (1, 1, 0, 0), (0, 1, 0, 0), (0, 1, 1, 0),
       (0, 0, 1, 0), (0, 0, 1, 1), (0, 0, 0, 1), (1, 0, 0, 1)]
STEPS_PER_REV = 4096

def turn(degrees, delay=0.0015):
    steps = int(STEPS_PER_REV * abs(degrees) / 360)
    order = SEQ if degrees > 0 else SEQ[::-1]
    for i in range(steps):
        for coil, state in zip(coils, order[i % 8]):
            coil.value = state
        sleep(delay)

while True:
    turn(90)
    sleep(0.5)
    turn(-90)
    sleep(0.5)`,
    async run(ctx) {
      const SEQ = [1, 3, 2, 6, 4, 12, 8, 9];
      let angle = 0;
      const turn = async (deg, needle) => {
        ctx.at(needle); ctx.print(`turn(${deg})  → ${Math.round(4096 * Math.abs(deg) / 360)} half-steps`);
        const n = 60;
        for (let i = 0; i < n; i++) {
          angle += deg / n;
          const idx = deg > 0 ? i % 8 : 7 - (i % 8);
          ctx.set('st', { angle, phase: SEQ[idx] });
          await ctx.sleep(25);
        }
        ctx.set('st', { phase: -1 });
      };
      for (;;) {
        await turn(90, 'turn(90)'); ctx.at('sleep(0.5)'); await ctx.sleep(500);
        await turn(-90, 'turn(-90)'); await ctx.sleep(500);
      }
    },
  },
  // ------------------------------------------------------------------------
  {
    id: 'relay', title: 'Relay lamp switch', short: 'Switching a 12 V load',
    difficulty: 'Intermediate', time: '30 min', topics: ['Power', 'GPIO'],
    lede: 'A relay is a switch flipped by an electromagnet, so the Pi can turn on a circuit that is completely separate from it — here a 12 V lamp with its own supply. Press the button to toggle it.',
    features: [['bolt', 'Isolated contacts: COM and NO'], ['hand', 'Press the button in Inputs or in 3D'], ['warn', 'Leave mains wiring to qualified electricians']],
    parts: [
      { id: 'rl', type: 'relay', at: [2.4, -0.2], label: 'Relay module' },
      { id: 'btn', type: 'button', at: [6.8, 1.8], label: 'Toggle button' },
      { id: 'lamp', type: 'lamp', at: [13.4, -1.6], table: true, label: '12 V lamp' },
      { id: 'psu', type: 'psu12', at: [13.2, 3.8], table: true, label: '12 V supply' },
    ],
    wires: [['5V', 'rl.VCC'], ['rl.GND', 'GND'], ['GPIO17', 'rl.IN'], ['GPIO27', 'btn.1'], ['btn.2', 'GND'], ['psu.+', 'rl.COM', { color: 0xd83a34 }], ['rl.NO', 'lamp.L1', { color: 0xd83a34 }], ['lamp.L2', 'psu.-', { color: 0x2f3547 }]],
    inputs: [{ id: 'btn', type: 'hold', label: 'Press to toggle' }],
    pinout: [['5V', 'VCC', 'Relay coil supply (~70 mA).'], ['GPIO17', 'IN', '3.3 V trigger.'], ['GND', 'GND', 'Ground.'], ['GPIO27', 'Button', 'Toggle input.'], ['COM / NO', '12 V circuit', 'Closes when the relay is on.']],
    steps: ['Many relay modules are active-low (they switch on when IN is LOW). If yours does, use <code>OutputDevice(17, active_high=False)</code>.', 'Use a module rated for a 3.3 V trigger, or one with an optocoupler and transistor.', 'The 12 V side never touches the Pi’s circuit — the relay contacts are the only link.', 'Mains voltages can kill: keep to low-voltage loads unless you are qualified.'],
    specs: [['Relay', '1 channel, 10 A contacts'], ['Coil', '5 V, ~70 mA (driven by the module)'], ['Trigger', '3.3 V logic'], ['Load', '12 V lamp, own supply']],
    code: `from gpiozero import OutputDevice, Button
from signal import pause

relay = OutputDevice(17, active_high=True, initial_value=False)
button = Button(27)

def toggle():
    relay.toggle()
    print("Lamp", "ON" if relay.value else "off")

button.when_pressed = toggle
pause()`,
    async run(ctx) {
      ctx.at('pause()'); ctx.print('Press the button to toggle the lamp.');
      let on = false, last = false;
      for (;;) {
        const p = !!ctx.input('btn');
        ctx.set('btn', { pressed: p });
        if (p && !last) {
          on = !on; ctx.at('relay.toggle()');
          ctx.set('rl', { on }); ctx.set('lamp', { on });
          ctx.print(`Lamp ${on ? 'ON' : 'off'}`);
        }
        last = p;
        await ctx.sleep(40);
      }
    },
  },
  // ------------------------------------------------------------------------
  {
    id: 'cooler', title: 'Active Cooler & temperature', short: 'Watching the fan curve',
    difficulty: 'Beginner', time: '15 min', topics: ['Board', 'Power'],
    lede: 'The Pi 5 has a 4-pin fan header, and its firmware runs the official Active Cooler on its own: off when cool, faster as the CPU warms. Python can read the temperature and the fan’s RPM from Linux.',
    features: [['bolt', 'Fan header with PWM and tachometer'], ['eye', 'Read RPM from <code>/sys</code>'], ['hand', 'Load the CPU in Inputs']],
    parts: [{ id: 'cooler', type: 'cooler', mount: 'pi', at: [-0.6, -0.15], label: 'Active Cooler', why: 'there would be no fan to read' }],
    wires: [['FAN', 'cooler.FAN', { color: 0x2f3547, radius: 0.04 }]], noBreadboard: true,
    inputs: [{ id: 'load', type: 'range', label: 'CPU load', min: 0, max: 100, step: 1, value: 15, unit: '%' }],
    pinout: [['FAN', 'Cooler cable', '5 V, GND, PWM and tachometer in a 4-pin JST connector.'], ['GPIO', 'Not used', 'The fan header is separate from the 40-pin header.']],
    steps: ['Default firmware curve: off below 50 °C, then about 30 % at 50 °C, 50 % at 60 °C, 70 % at 67.5 °C and 100 % at 75 °C.', 'The kernel exposes the fan through <code>hwmon</code>; <code>fan1_input</code> is the speed in RPM.', 'Without cooling, a Pi 5 under full load throttles at 85 °C.', 'Try <code>stress-ng --cpu 4</code> in another terminal to warm it up.'],
    specs: [['Fan', 'Blower, PWM controlled'], ['Header', '4-pin JST (5 V, GND, PWM, tach)'], ['Throttle', '85 °C'], ['Curve', '50 / 60 / 67.5 / 75 °C']],
    code: `from gpiozero import CPUTemperature
from glob import glob
from time import sleep

cpu = CPUTemperature()
fan = glob("/sys/devices/platform/cooling_fan/hwmon/*/fan1_input")[0]

while True:
    with open(fan) as f:
        rpm = int(f.read())
    print(f"CPU {cpu.temperature:5.1f} °C   fan {rpm:4d} RPM")
    sleep(1)`,
    async run(ctx) {
      let temp = 46;
      for (;;) {
        const load = ctx.input('load');
        const target = 42 + load * 0.42 - (ctx.has('cooler') ? 0 : -8);
        temp += (target - temp) * 0.25;
        const pwm = temp < 50 ? 0 : temp < 60 ? 75 : temp < 67.5 ? 125 : temp < 75 ? 175 : 250;
        const rpm = pwm ? Math.round(pwm / 255 * 7800 + Math.random() * 40) : 0;
        ctx.set('cooler', { speed: pwm / 255 * 1.2 });
        ctx.at('rpm = int(f.read())'); await ctx.sleep(120);
        ctx.at('print(f"CPU'); ctx.print(`CPU ${fmt(temp).padStart(5)} °C   fan ${String(rpm).padStart(4)} RPM`);
        ctx.readout('cooler', `${fmt(temp)} °C · ${rpm} RPM`);
        await ctx.sleep(880);
      }
    },
  },
  // ------------------------------------------------------------------------
  {
    id: 'camera', title: 'Take a photo', short: 'Camera Module 3 + Picamera2',
    difficulty: 'Beginner', time: '20 min', topics: ['Camera', 'Python'],
    lede: 'The Pi 5 has two 4-lane MIPI connectors, each able to take a camera or a display. Camera Module 3 plugs into CAM/DISP 0 with the narrower Pi 5 cable, and Picamera2 captures a 12-megapixel photo.',
    features: [['eye', 'Autofocus and HDR camera'], ['code', 'Picamera2: configure, start, capture'], ['chip', 'Two CSI/DSI ports on Pi 5']],
    parts: CAMERA_PARTS,
    wires: [['CAM0', 'cam.CSI']], noBreadboard: true, preview: true,
    pinout: [['CAM/DISP 0', 'Camera ribbon', '22-pin, 0.5 mm pitch; contacts face the connector’s contacts.'], ['CAM/DISP 1', 'Free', 'A second camera or a DSI display.']],
    steps: ['Pi 5 connectors are smaller than older Pis’: you need a 22-to-15-pin cable (sold as the Pi 5 camera cable).', 'Check it works with <code>rpicam-hello</code>.', 'Picamera2 comes with Raspberry Pi OS; <code>autofocus_cycle()</code> runs one focus sweep on Camera Module 3.', 'Use <code>Preview.QTGL</code> on the desktop, or <code>Preview.NULL</code> over SSH.'],
    specs: [['Sensor', 'Sony IMX708, 11.9 MP'], ['Still', '4608 × 2592'], ['Video', '1080p50, 720p100'], ['Focus', 'Phase-detect autofocus'], ['Cable', 'Pi 5 FPC, 22-pin ↔ 15-pin']],
    code: `from picamera2 import Picamera2, Preview
from time import sleep

picam2 = Picamera2()
config = picam2.create_still_configuration(main={"size": (4608, 2592)})
picam2.configure(config)
picam2.start_preview(Preview.QTGL)
picam2.start()

sleep(2)                    # let exposure settle
picam2.autofocus_cycle()
picam2.capture_file("photo.jpg")
print("Saved photo.jpg (4608 × 2592)")
picam2.stop()`,
    async run(ctx) {
      let flash = 0, blur = 6;
      ctx.preview((c, w, h, t) => {
        room(c, w, h); person(c, w * 0.48 + Math.sin(t * 0.7) * 6, h * 0.9, h * 0.8, '#4b5b73');
        c.fillStyle = '#c9752a'; c.beginPath(); c.arc(w * 0.82, h * 0.72, h * 0.07, 0, 7); c.fill();
        if (blur > 0) { c.fillStyle = `rgba(220,214,203,${blur / 14})`; c.fillRect(0, 0, w, h); }
        if (flash > 0) { c.fillStyle = `rgba(255,255,255,${flash})`; c.fillRect(0, 0, w, h); flash = Math.max(0, flash - 0.06); }
        hud(c, w, h, blur > 0 ? 'Preview · focusing…' : 'Preview · 4608 × 2592');
      });
      ctx.at('picam2 = Picamera2()'); ctx.print('[0:00:01] INFO Camera camera_manager.cpp:325 libcamera v0.3.2+rpt'); await ctx.sleep(400);
      ctx.print('imx708 : /base/axi/pcie@120000/rp1/i2c@88000/imx708@1a'); await ctx.sleep(300);
      ctx.at('picam2.start()'); await ctx.sleep(500);
      ctx.at('sleep(2)'); await ctx.sleep(1200);
      ctx.at('picam2.autofocus_cycle()'); while (blur > 0) { blur -= 1; await ctx.sleep(110); }
      ctx.at('picam2.capture_file'); flash = 1; ctx.click(); await ctx.sleep(500);
      ctx.at('print("Saved'); ctx.print('Saved photo.jpg (4608 × 2592)', 'cd-ok');
      ctx.at('picam2.stop()'); await ctx.sleep(300);
    },
  },
  // ------------------------------------------------------------------------
  {
    id: 'qr', title: 'QR code reader', short: 'OpenCV on the camera feed',
    difficulty: 'Intermediate', time: '30 min', topics: ['Camera', 'Vision'],
    lede: 'OpenCV’s built-in QR detector finds and decodes codes in each camera frame — no extra hardware. The same pipeline is the starting point for reading labels or number plates, which add an OCR step on top.',
    features: [['eye', 'Detect and decode in one call'], ['hand', 'Hold a code up to the camera in Inputs'], ['code', 'Frames as NumPy arrays from Picamera2']],
    parts: CAMERA_PARTS,
    wires: [['CAM0', 'cam.CSI']], noBreadboard: true, preview: true,
    inputs: [{ id: 'code', type: 'choice', label: 'Show the camera', options: ['nothing', 'https://www.raspberrypi.com', 'WIFI:S:Workshop;T:WPA;;', 'PART-4471-B'] }],
    pinout: [['CAM/DISP 0', 'Camera Module 3', 'Pi 5 camera cable.']],
    steps: ['Install OpenCV with <code>sudo apt install python3-opencv</code>.', '<code>capture_array()</code> returns a frame as a NumPy array OpenCV can use directly.', '<code>detectAndDecode</code> returns the text (empty if none), the corner points and a rectified image.', 'Licence plates or labels: crop the region and run an OCR engine such as Tesseract — and respect local privacy rules when recording vehicles or people.'],
    specs: [['Resolution', '1280 × 720 RGB'], ['Library', 'OpenCV QRCodeDetector'], ['Rate', '≈ 10–20 fps on Pi 5'], ['Camera', 'Camera Module 3']],
    code: `from picamera2 import Picamera2
import cv2

picam2 = Picamera2()
picam2.configure(picam2.create_preview_configuration(
    main={"size": (1280, 720), "format": "RGB888"}))
picam2.start()

detector = cv2.QRCodeDetector()
last = None

while True:
    frame = picam2.capture_array()
    text, points, _ = detector.detectAndDecode(frame)
    if text and text != last:
        print("QR:", text)
        last = text`,
    async run(ctx) {
      let shown = 'nothing', last = null, found = 0;
      ctx.preview((c, w, h, t) => {
        room(c, w, h);
        const code = ctx.input('code');
        if (code !== 'nothing') {
          const s = h * 0.46, x = w * 0.5 - s / 2 + Math.sin(t * 1.3) * 5, y = h * 0.2 + Math.cos(t) * 3;
          c.fillStyle = '#e8e4da'; c.fillRect(x - 16, y - 16, s + 32, s + 44);
          qrPattern(c, x, y, s, code.length * 7919);
          if (found) { c.strokeStyle = '#30d158'; c.lineWidth = 3; c.strokeRect(x - 4, y - 4, s + 8, s + 8); }
        }
        hud(c, w, h, code === 'nothing' ? 'No code in view' : found ? `Decoded: ${code}` : 'Looking…');
      });
      ctx.at('picam2.start()'); await ctx.sleep(500);
      for (;;) {
        ctx.at('frame = picam2.capture_array()'); await ctx.sleep(90);
        ctx.at('text, points, _'); await ctx.sleep(90);
        const code = ctx.input('code');
        if (code !== shown) { shown = code; found = 0; }
        if (code !== 'nothing') { found++; if (found === 3 && code !== last) { ctx.at('print("QR:"'); ctx.print(`QR: ${code}`); last = code; } }
      }
    },
  },
  // ------------------------------------------------------------------------
  {
    id: 'pose', title: 'Pose detection', short: 'AI Kit + rpicam-apps',
    difficulty: 'Advanced', time: '45 min', topics: ['AI', 'Camera', 'PCIe'],
    lede: 'With the AI Kit, a Hailo-8L accelerator on the Pi 5’s PCIe connector runs a YOLOv8 pose model on every camera frame — 17 body keypoints per person, in real time, while the CPU stays free.',
    features: [['chip', 'Hailo-8L: 13 TOPS over PCIe'], ['eye', 'Keypoints for each person'], ['code', 'One rpicam-hello command']],
    parts: [...CAMERA_PARTS, ...AI_PARTS],
    wires: [['CAM0', 'cam.CSI'], ['PCIE', 'ai.PCIe'], ['FAN', 'cooler.FAN', { color: 0x2f3547, radius: 0.04 }]], noBreadboard: true, preview: true, lang: 'sh',
    pinout: [['PCIe', 'AI Kit ribbon', 'PCIe 2.0 ×1 (enable Gen 3 in raspi-config for more speed).'], ['CAM/DISP 0', 'Camera Module 3', 'Video in.'], ['FAN', 'Active Cooler', 'Recommended for AI work.']],
    steps: ['<code>sudo apt install hailo-all</code>, reboot, and check with <code>hailortcli fw-control identify</code>.', 'The post-process JSON files in <code>/usr/share/rpi-camera-assets</code> wire the model into rpicam-apps.', 'For your own logic, Picamera2 has Hailo examples that give you the keypoints in Python.', 'The AI Kit’s M.2 HAT+ sits on top of the Pi on standoffs; it’s drawn beside the board here so you can see the ribbon.'],
    specs: [['Accelerator', 'Hailo-8L, 13 TOPS'], ['Link', 'PCIe 2.0 ×1 (Gen 3 optional)'], ['Model', 'YOLOv8s-pose, 17 keypoints'], ['Speed', '≈ 30 fps at 640 × 640']],
    code: `# Pose estimation on the Hailo-8L, straight from the camera
sudo apt install hailo-all          # once, then reboot
hailortcli fw-control identify      # check the AI Kit is found

rpicam-hello -t 0 \\
  --post-process-file /usr/share/rpi-camera-assets/hailo_yolov8_pose.json \\
  --lores-width 640 --lores-height 640`,
    async run(ctx) {
      ctx.set('ai', { busy: false });
      ctx.at('hailortcl'); ctx.print('$ hailortcli fw-control identify'); await ctx.sleep(500);
      ctx.print('Identifying board'); ctx.print('Device Architecture: HAILO8L'); ctx.print('Firmware Version: 4.18.0 (release,app,extended context switch buffer)'); await ctx.sleep(500);
      ctx.at('rpicam-hello'); ctx.print('$ rpicam-hello -t 0 --post-process-file …/hailo_yolov8_pose.json'); await ctx.sleep(500);
      ctx.print('Running HailoRT pose model: yolov8s_pose_h8l_pi.hef'); ctx.set('ai', { busy: true });
      const pose = (t, x, s, ph) => {
        const sw = Math.sin(t * 2.2 + ph), up = Math.sin(t * 1.4 + ph) * 0.5 + 0.5;
        const P = { head: [0, -0.86], neck: [0, -0.7], ls: [-0.16, -0.66], rs: [0.16, -0.66], le: [-0.26, -0.5 - up * 0.2], re: [0.27, -0.48 + sw * 0.05], lw: [-0.3 - up * 0.05, -0.36 - up * 0.42], rw: [0.32, -0.3 + sw * 0.1], lh: [-0.1, -0.3], rh: [0.1, -0.3], lk: [-0.12 + sw * 0.04, -0.14], rk: [0.12 - sw * 0.04, -0.14], la: [-0.13 + sw * 0.07, 0], ra: [0.13 - sw * 0.07, 0] };
        for (const k in P) P[k] = [x + P[k][0] * s, P[k][1] * s];
        return P;
      };
      const bones = [['neck', 'head'], ['ls', 'rs'], ['ls', 'le'], ['le', 'lw'], ['rs', 're'], ['re', 'rw'], ['ls', 'lh'], ['rs', 'rh'], ['lh', 'rh'], ['lh', 'lk'], ['lk', 'la'], ['rh', 'rk'], ['rk', 'ra']];
      ctx.preview((c, w, h, t) => {
        room(c, w, h, true);
        for (const [x, ph, col] of [[0.33, 0, '#57c2ff'], [0.68, 1.7, '#ffb347']]) {
          const P = pose(t, w * x, h * 0.86, ph);
          c.save(); c.translate(0, h * 0.94);
          c.strokeStyle = 'rgba(160,170,185,0.55)'; c.lineWidth = h * 0.07; c.lineCap = 'round';
          for (const [a, b] of bones) { c.beginPath(); c.moveTo(...P[a]); c.lineTo(...P[b]); c.stroke(); }
          c.fillStyle = 'rgba(160,170,185,0.55)'; c.beginPath(); c.arc(...P.head, h * 0.06, 0, 7); c.fill();
          c.strokeStyle = col; c.lineWidth = 2.5;
          for (const [a, b] of bones) { c.beginPath(); c.moveTo(...P[a]); c.lineTo(...P[b]); c.stroke(); }
          c.fillStyle = '#fff'; for (const k in P) { c.beginPath(); c.arc(...P[k], 3, 0, 7); c.fill(); }
          c.restore();
        }
        hud(c, w, h, 'Hailo-8L · YOLOv8 pose · 2 people · 30 fps');
      });
      for (let f = 0; ; f++) {
        await ctx.sleep(1500);
        ctx.print(`frame ${f * 45}: 2 people, 17 keypoints each, ${fmt(29 + Math.random() * 2)} fps`);
      }
    },
  },
  // ------------------------------------------------------------------------
  {
    id: 'people-counter', title: 'People counter', short: 'Object detection on the AI Kit',
    difficulty: 'Advanced', time: '60 min', topics: ['AI', 'Camera', 'Python'],
    lede: 'Run a YOLOv8 detector on the Hailo-8L from Python with Picamera2, keep only the “person” class, and count them. Useful for room occupancy — the frames never leave the Pi.',
    features: [['chip', 'Hailo inference from Python'], ['eye', 'Detections with confidence scores'], ['hand', 'Let people walk in and out in Inputs']],
    parts: [...CAMERA_PARTS, ...AI_PARTS],
    wires: [['CAM0', 'cam.CSI'], ['PCIE', 'ai.PCIe'], ['FAN', 'cooler.FAN', { color: 0x2f3547, radius: 0.04 }]], noBreadboard: true, preview: true,
    inputs: [{ id: 'people', type: 'range', label: 'People in the room', min: 0, max: 5, step: 1, value: 2 }],
    pinout: [['PCIe', 'AI Kit', 'Hailo-8L accelerator.'], ['CAM/DISP 0', 'Camera Module 3', 'Video in.'], ['FAN', 'Active Cooler', 'Keeps the CPU cool under load.']],
    steps: ['The camera gives two streams: a full-size <code>main</code> one for viewing and a small <code>lores</code> one sized for the model.', '<code>hailo.run(frame)</code> returns the detections grouped by class; class 0 in COCO is “person”.', 'Each detection is <code>[y0, x0, y1, x1, score]</code> in 0–1 units.', 'Count on several frames in a row to smooth out flicker; log counts, not images, for privacy.'],
    specs: [['Model', 'YOLOv8s (COCO, 80 classes)'], ['Input', '640 × 640'], ['Accelerator', 'Hailo-8L, 13 TOPS'], ['Threshold', '0.5 confidence']],
    code: `from picamera2 import Picamera2
from picamera2.devices import Hailo

MODEL = "/usr/share/hailo-models/yolov8s_h8l.hef"

def count_people(results, threshold=0.5):
    # results[0] holds the detections for class 0 ("person")
    return sum(1 for det in results[0] if det[4] >= threshold)

with Hailo(MODEL) as hailo:
    model_h, model_w, _ = hailo.get_input_shape()
    picam2 = Picamera2()
    picam2.configure(picam2.create_preview_configuration(
        main={"size": (1280, 720)},
        lores={"size": (model_w, model_h), "format": "RGB888"}))
    picam2.start()
    last = None
    while True:
        frame = picam2.capture_array("lores")
        people = count_people(hailo.run(frame))
        if people != last:
            print("People in view:", people)
            last = people`,
    async run(ctx) {
      ctx.at('with Hailo(MODEL)'); ctx.print('Loading yolov8s_h8l.hef on HAILO8L…'); ctx.set('ai', { busy: true }); await ctx.sleep(600);
      const walkers = Array.from({ length: 5 }, (_, i) => ({ x: 0.15 + i * 0.17, v: (i % 2 ? -1 : 1) * (0.03 + i * 0.01), s: 0.66 + (i % 3) * 0.08, score: 0.72 + ((i * 37) % 25) / 100 }));
      ctx.preview((c, w, h, t) => {
        room(c, w, h);
        const n = ctx.input('people');
        walkers.forEach((p, i) => {
          if (i >= n) return;
          p.x += p.v / 60; if (p.x < 0.1 || p.x > 0.9) p.v *= -1;
          const x = p.x * w, y = h * 0.93, s = h * p.s;
          person(c, x, y, s, ['#4b5b73', '#7a4b4b', '#4b7357', '#6a5b8a', '#8a7a4b'][i]);
          c.strokeStyle = '#30d158'; c.lineWidth = 2; c.strokeRect(x - s * 0.24, y - s * 0.94, s * 0.48, s * 0.96);
          c.fillStyle = '#30d158'; c.fillRect(x - s * 0.24, y - s * 0.94 - 15, 82, 15);
          c.fillStyle = '#0b1a10'; c.font = '600 11px system-ui, sans-serif'; c.textBaseline = 'middle'; c.fillText(`person ${p.score.toFixed(2)}`, x - s * 0.24 + 4, y - s * 0.94 - 7);
        });
        hud(c, w, h, `People in view: ${n}`);
      });
      let last = null;
      for (;;) {
        ctx.at('frame = picam2.capture_array'); await ctx.sleep(120);
        ctx.at('people = count_people'); await ctx.sleep(120);
        const n = ctx.input('people');
        if (n !== last) { ctx.at('print("People'); ctx.print(`People in view: ${n}`); last = n; }
      }
    },
  },
];
