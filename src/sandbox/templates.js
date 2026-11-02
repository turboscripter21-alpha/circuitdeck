// Starter templates. Each one is a complete circuit that passes every check with zero errors.
// Parts have no positions here: the sandbox packs them onto the breadboard/table when loaded.
const P = (id, type, opts) => (opts ? { id, type, opts } : { id, type });

export const TEMPLATES = [
  {
    id: 'traffic-light', difficulty: 'Beginner', board: 'esp32', title: 'Traffic light', tags: ['beginner', 'output'],
    blurb: 'A three-lamp module cycles red → green → amber; a crossing button and buzzer for pedestrians.',
    parts: [P('lights', 'trafficlight'), P('cross', 'button'), P('beeper', 'buzzer')],
    wires: [['GPIO25', 'lights.R'], ['GPIO26', 'lights.Y'], ['GPIO27', 'lights.G'], ['lights.GND', 'GND@14'],
      ['GPIO14', 'cross.1'], ['cross.2', 'GND@14'], ['GPIO13', 'beeper.+'], ['beeper.-', 'GND@29']],
  },
  {
    id: 'weather-station', difficulty: 'Intermediate', board: 'pi5', title: 'Weather station', tags: ['sensor', 'display', 'i2c'],
    blurb: 'BME280 temperature, humidity and pressure on I2C, shown live on a 0.96" OLED sharing the same bus.',
    parts: [P('bme', 'bme280'), P('oled', 'oled')],
    wires: [['3V3@1', 'bme.VIN'], ['bme.GND', 'GND@6'], ['GPIO2', 'bme.SDA'], ['GPIO3', 'bme.SCL'],
      ['3V3@17', 'oled.VCC'], ['oled.GND', 'GND@9'], ['GPIO2', 'oled.SDA'], ['GPIO3', 'oled.SCL']],
  },
  {
    id: 'robot-car', difficulty: 'Advanced', board: 'esp32', title: 'Robot car', tags: ['motors', 'sensor', 'advanced'],
    blurb: 'Two DC motors through a DRV8833 on a 6 V battery pack; an HC-SR04 (with a 1k/2k divider on ECHO) makes it back away from walls.',
    parts: [P('drv', 'drv8833'), P('left', 'motor'), P('right', 'motor'), P('pack', 'battery'), P('sonar', 'hcsr04'),
      P('r1', 'resistor', { ohms: '1k' }), P('r2', 'resistor', { ohms: '2k' })],
    wires: [['GPIO26', 'drv.IN1'], ['GPIO27', 'drv.IN2'], ['GPIO32', 'drv.IN3'], ['GPIO33', 'drv.IN4'],
      ['drv.OUT1', 'left.M+'], ['drv.OUT2', 'left.M-'], ['drv.OUT3', 'right.M+'], ['drv.OUT4', 'right.M-'],
      ['pack.+', 'drv.VM'], ['pack.-', 'drv.GND'], ['drv.GND', 'GND@14'],
      ['VIN', 'sonar.VCC'], ['sonar.GND', 'GND@29'], ['GPIO17', 'sonar.TRIG'],
      ['sonar.ECHO', 'r1.1'], ['r1.2', 'GPIO16'], ['r1.2', 'r2.1'], ['r2.2', 'GND@29']],
  },
  {
    id: 'door-lock', difficulty: 'Advanced', board: 'esp32', title: 'Keypad door lock', tags: ['input', 'servo', 'advanced'],
    blurb: 'Type 1234 on the keypad: the servo bolt opens, the green LED lights and the buzzer chirps. A wrong code flashes red.',
    parts: [P('keys', 'keypad'), P('bolt', 'servo'), P('ok', 'led', { color: 'green' }), P('rok', 'resistor', { ohms: '330' }),
      P('bad', 'led', { color: 'red' }), P('rbad', 'resistor', { ohms: '330' }), P('beeper', 'buzzer')],
    wires: [['GPIO13', 'keys.R1'], ['GPIO14', 'keys.R2'], ['GPIO27', 'keys.R3'], ['GPIO26', 'keys.R4'],
      ['GPIO25', 'keys.C1'], ['GPIO33', 'keys.C2'], ['GPIO32', 'keys.C3'],
      ['VIN', 'bolt.V+'], ['bolt.GND', 'GND@14'], ['GPIO18', 'bolt.SIG'],
      ['GPIO4', 'rok.1'], ['rok.2', 'ok.A'], ['ok.K', 'GND@29'],
      ['GPIO16', 'rbad.1'], ['rbad.2', 'bad.A'], ['bad.K', 'GND@29'],
      ['GPIO17', 'beeper.+'], ['beeper.-', 'GND@29']],
  },
  {
    id: 'ai-camera', difficulty: 'Advanced', board: 'pi5', title: 'AI camera', tags: ['camera', 'ai', 'advanced'],
    blurb: 'Camera Module 3 on CAM0 and the 13 TOPS AI Kit on PCIe run YOLO object detection; the Active Cooler keeps the SoC from throttling.',
    parts: [P('cam', 'cam3'), P('hailo', 'aikit'), P('fan', 'cooler'), P('alert', 'led', { color: 'blue' }), P('ra', 'resistor', { ohms: '330' })],
    wires: [['CAM0', 'cam.CSI'], ['PCIE', 'hailo.PCIe'], ['FAN', 'fan.FAN'], ['GPIO17', 'ra.1'], ['ra.2', 'alert.A'], ['alert.K', 'GND@9']],
  },
  {
    id: 'blink-esp32', difficulty: 'Beginner', board: 'esp32', title: 'Blink (ESP32)', tags: ['beginner', 'output'],
    blurb: 'The hello-world of hardware: one LED and a 330 Ω resistor on GPIO2.',
    parts: [P('led', 'led', { color: 'red' }), P('r', 'resistor', { ohms: '330' })],
    wires: [['GPIO2', 'r.1'], ['r.2', 'led.A'], ['led.K', 'GND@14']],
  },
  {
    id: 'blink-pi', difficulty: 'Beginner', board: 'pi5', title: 'Blink (Pi 5)', tags: ['beginner', 'output'],
    blurb: 'gpiozero LED on GPIO17 (physical pin 11) through a 330 Ω resistor.',
    parts: [P('led', 'led', { color: 'red' }), P('r', 'resistor', { ohms: '330' })],
    wires: [['GPIO17', 'r.1'], ['r.2', 'led.A'], ['led.K', 'GND@9']],
  },
  {
    id: 'motion-alarm', difficulty: 'Beginner', board: 'pi5', title: 'Motion alarm', tags: ['sensor', 'beginner'],
    blurb: 'A PIR sensor wakes a buzzer and LED when someone walks past.',
    parts: [P('pir', 'pir'), P('beeper', 'buzzer'), P('led', 'led', { color: 'yellow' }), P('r', 'resistor', { ohms: '330' })],
    wires: [['5V@2', 'pir.VCC'], ['pir.GND', 'GND@6'], ['GPIO4', 'pir.OUT'],
      ['GPIO27', 'beeper.+'], ['beeper.-', 'GND@14'], ['GPIO17', 'r.1'], ['r.2', 'led.A'], ['led.K', 'GND@9']],
  },
  {
    id: 'plant-monitor', difficulty: 'Intermediate', board: 'esp32', title: 'Plant monitor', tags: ['sensor', 'display', 'i2c'],
    blurb: 'A capacitive soil probe on ADC1 (GPIO34) with the reading on an OLED; a red LED asks for water.',
    parts: [P('soil', 'soil'), P('oled', 'oled'), P('led', 'led', { color: 'red' }), P('r', 'resistor', { ohms: '330' })],
    wires: [['3V3@30', 'soil.VCC'], ['soil.GND', 'GND@14'], ['soil.AOUT', 'GPIO34'],
      ['3V3@30', 'oled.VCC'], ['oled.GND', 'GND@29'], ['GPIO21', 'oled.SDA'], ['GPIO22', 'oled.SCL'],
      ['GPIO4', 'r.1'], ['r.2', 'led.A'], ['led.K', 'GND@29']],
  },
  {
    id: 'night-light', difficulty: 'Intermediate', board: 'pi5', title: 'Night light', tags: ['sensor', 'spi', 'analog'],
    blurb: 'The Pi 5 has no ADC, so an MCP3008 reads a light-dependent resistor divider over SPI and turns an LED on in the dark.',
    parts: [P('adc', 'mcp3008'), P('ldr', 'ldr'), P('rd', 'resistor', { ohms: '10k' }), P('led', 'led', { color: 'white' }), P('r', 'resistor', { ohms: '330' })],
    wires: [['3V3@1', 'adc.VDD'], ['3V3@1', 'adc.VREF'], ['adc.AGND', 'GND@6'], ['adc.DGND', 'GND@6'],
      ['GPIO11', 'adc.CLK'], ['GPIO9', 'adc.DOUT'], ['GPIO10', 'adc.DIN'], ['GPIO8', 'adc.CS'],
      ['3V3@17', 'ldr.1'], ['ldr.2', 'adc.CH0'], ['ldr.2', 'rd.1'], ['rd.2', 'GND@20'],
      ['GPIO17', 'r.1'], ['r.2', 'led.A'], ['led.K', 'GND@9']],
  },
  {
    id: 'servo-dial', difficulty: 'Beginner', board: 'esp32', title: 'Servo dial', tags: ['servo', 'analog', 'beginner'],
    blurb: 'Turn the potentiometer and the servo follows — analogRead on ADC1 mapped to 0–180°.',
    parts: [P('knob', 'pot'), P('arm', 'servo')],
    wires: [['3V3@30', 'knob.3'], ['knob.1', 'GND@14'], ['knob.W', 'GPIO34'], ['VIN', 'arm.V+'], ['arm.GND', 'GND@29'], ['GPIO18', 'arm.SIG']],
  },
  {
    id: 'mood-ring', difficulty: 'Intermediate', board: 'pi5', title: 'NeoPixel mood ring', tags: ['output', 'spi'],
    blurb: 'Twelve WS2812B pixels driven from SPI MOSI (GPIO10) — the reliable way on Pi 5 — with a button to change the effect.',
    parts: [P('ring', 'ring'), P('mode', 'button')],
    wires: [['5V@2', 'ring.5V'], ['ring.GND', 'GND@6'], ['GPIO10', 'ring.DIN'], ['GPIO27', 'mode.1'], ['mode.2', 'GND@14']],
  },
];

export function templateCircuit(t) {
  return { v: 1, board: t.board, name: t.title, parts: t.parts.map((p) => ({ ...p, opts: { ...(p.opts || {}) } })), wires: t.wires.map((w) => [...w]) };
}
