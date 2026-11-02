// CircuitDeck · TinyML track (M8). Six projects that run small neural networks
// on an ESP32-S3 CAM board. Same project shape as the Pi 5 track (see
// src/pi5/projects-a.js) — src/pi5/main.js renders both, switching on the URL.
//
// Layout (cm): the board sits around x = -7.2, the breadboard around x = 4.5.
// Wires: [from, to, opts?]. A plain name (GPIO21, GND, 3V3, 5V, CAM) is a board
// connector; "id.pin" is a part's pin.
import { PARTS } from '../core/parts.js';
import { room, person, hud } from '../pi5/projects-b.js';

export const BB = { x: 4.5, z: 0.6, w: 11, d: 6.6 };
const fmt = (n, d = 2) => Number(n).toFixed(d);
const LED_PARTS = (color = 'green', at = [5.2, 0.4]) => [
  { id: 'r1', type: 'resistor', at: [at[0] - 2.4, at[1]], opts: { ohms: '330' }, label: '330 Ω resistor' },
  { id: 'led', type: 'led', at, opts: { color }, label: `${color[0].toUpperCase()}${color.slice(1)} LED`, why: 'you would not see the result' },
];
const LED_WIRES = [['GPIO21', 'r1.1'], ['r1.2', 'led.A'], ['led.K', 'GND']];
const IMU = { id: 'imu', type: 'mpu6050', at: [1.2, -1.2], label: 'MPU-6050', why: 'there would be no motion data for the model' };
const IMU_WIRES = [['3V3', 'imu.VCC'], ['GND', 'imu.GND'], ['GPIO9', 'imu.SCL'], ['GPIO8', 'imu.SDA']];

// a scrolling plot of a few signals (accelerometer, vibration)
function plot(c, w, h, series, { title, colors = ['#ff6b5a', '#30d158', '#57c2ff'], scale = 1 } = {}) {
  c.fillStyle = '#10161e'; c.fillRect(0, 0, w, h);
  c.strokeStyle = 'rgba(255,255,255,0.08)'; c.lineWidth = 1;
  for (let y = 1; y < 4; y++) { c.beginPath(); c.moveTo(0, (y * h) / 4); c.lineTo(w, (y * h) / 4); c.stroke(); }
  series.forEach((s, k) => {
    c.strokeStyle = colors[k % colors.length]; c.lineWidth = 1.8; c.beginPath();
    s.forEach((v, i) => { const x = (i / (s.length - 1)) * w, y = h * 0.45 - v * scale * h * 0.32; i ? c.lineTo(x, y) : c.moveTo(x, y); });
    c.stroke();
  });
  if (title) hud(c, w, h, title);
}
const ring = (n) => { const a = new Array(n).fill(0); return { a, push(v) { a.push(v); a.shift(); } }; };

export const PROJECTS_RAW = [
  // ------------------------------------------------------------------------
  {
    id: 'hello-tinyml', title: 'Hello TinyML: a sine-wave LED', short: 'Your first model on a microcontroller',
    difficulty: 'Beginner', time: '20 min', topics: ['TinyML', 'TFLite Micro', 'PWM'],
    lede: 'The “hello world” of TinyML: a tiny neural network (two hidden layers of 16 neurons, about 3 KB) learned to predict <code>sin(x)</code>. The ESP32-S3 runs it hundreds of times a second and uses each prediction to set the brightness of an LED — so the LED breathes in a smooth wave that a model, not a formula, produces.',
    features: [['chip', 'TensorFlow Lite for Microcontrollers on the S3'], ['wave', 'Model output → PWM brightness'], ['code', 'The whole model is a C array in flash']],
    parts: LED_PARTS('green'),
    wires: LED_WIRES,
    pinout: [['GPIO21', 'Resistor → LED anode (long leg)', 'PWM output; the duty cycle follows the model’s prediction.'], ['GND', 'LED cathode (short leg)', 'Completes the circuit.']],
    steps: ['The model is trained on a laptop (Python, Keras) with 1 000 noisy samples of <code>y = sin(x)</code>, then converted to an int8 <code>.tflite</code> file and turned into a C array with <code>xxd -i</code>.', '<code>MicroInterpreter</code> needs a scratch buffer, the <em>tensor arena</em>; 2 KB is plenty for this model.', 'Each loop quantizes <code>x</code> to int8 with the input’s scale and zero point, calls <code>Invoke()</code> and de-quantizes the output.', '<code>analogWrite</code> (LEDC PWM on the ESP32) turns −1…1 into a 0…255 duty cycle.'],
    specs: [['Model', '1 → 16 → 16 → 1, ReLU, int8'], ['Size', '≈ 3 KB flash'], ['Arena', '2 KB RAM'], ['Inference', '≈ 60 µs on the S3'], ['Library', 'TensorFlow Lite Micro (Chirale_TensorFlowLite or ESP-TFLite-Micro)']],
    code: `#include <Chirale_TensorFlowLite.h>
#include "tensorflow/lite/micro/micro_interpreter.h"
#include "tensorflow/lite/micro/micro_mutable_op_resolver.h"
#include "sine_model.h"          // the trained model as a C array

constexpr int LED_PIN = 21;
constexpr int kArenaSize = 2 * 1024;
alignas(16) uint8_t arena[kArenaSize];
tflite::MicroInterpreter* interpreter;

void setup() {
  Serial.begin(115200);
  static tflite::MicroMutableOpResolver<1> ops;
  ops.AddFullyConnected();
  static tflite::MicroInterpreter interp(
      tflite::GetModel(g_sine_model), ops, arena, kArenaSize);
  interpreter = &interp;
  interpreter->AllocateTensors();
}

float x = 0;

void loop() {
  TfLiteTensor* in = interpreter->input(0);
  TfLiteTensor* out = interpreter->output(0);
  in->data.int8[0] = x / in->params.scale + in->params.zero_point;
  interpreter->Invoke();
  float y = (out->data.int8[0] - out->params.zero_point) * out->params.scale;
  analogWrite(LED_PIN, (y + 1) * 127.5);
  Serial.printf("x=%.2f  sin=%.3f  model=%.3f\\n", x, sin(x), y);
  x += 0.1;
  if (x > 2 * PI) x = 0;
  delay(40);
}`,
    lang: 'cpp',
    async run(ctx) {
      ctx.at('interpreter->AllocateTensors()'); ctx.print('Arena used: 1 412 of 2 048 bytes'); await ctx.sleep(400);
      for (let x = 0, i = 0; ; x += 0.1, i++) {
        if (x > 2 * Math.PI) x = 0;
        const y = Math.sin(x) + Math.sin(x * 7.3) * 0.02 - 0.01;
        ctx.at('interpreter->Invoke()');
        ctx.set('led', { on: Math.max(0, (y + 1) / 2) });
        ctx.readout('led', `${Math.round(((y + 1) / 2) * 100)} %`);
        if (i % 3 === 0) { ctx.at('Serial.printf'); ctx.print(`x=${fmt(x)}  sin=${fmt(Math.sin(x), 3)}  model=${fmt(y, 3)}`); }
        await ctx.sleep(80);
      }
    },
  },
  // ------------------------------------------------------------------------
  {
    id: 'gesture-wand', title: 'Magic wand gestures', short: 'Accelerometer gestures with a CNN',
    difficulty: 'Intermediate', time: '45 min', topics: ['TinyML', 'IMU', 'I2C'],
    lede: 'Strap an MPU-6050 to a stick and draw a shape in the air. A small 1-D convolutional network looks at the last second of accelerometer data (100 samples × 3 axes) and says which gesture it was: a <b>circle</b>, a <b>W</b> (“wing”) or a <b>slope</b>. Pick a gesture in Inputs and watch the plot and the prediction.',
    features: [['wave', 'Live 3-axis accelerometer plot'], ['chip', 'A 1-D CNN, int8, about 20 KB'], ['hand', 'Choose a gesture in Inputs']],
    parts: [IMU],
    wires: IMU_WIRES, preview: true, previewTitle: 'Sensor &amp; inputs', previewLabel: 'Accelerometer plot',
    inputs: [{ id: 'gesture', type: 'choice', label: 'Wave the wand', options: ['still', 'circle', 'wing (W)', 'slope'] }],
    pinout: [['3V3', 'MPU-6050 VCC', 'Power for the sensor.'], ['GND', 'MPU-6050 GND', 'Common ground.'], ['GPIO8', 'MPU-6050 SDA', 'I2C data (the S3’s default Wire pins).'], ['GPIO9', 'MPU-6050 SCL', 'I2C clock.']],
    steps: ['Record about 50 examples of each gesture (and of “nothing”) with a data-logging sketch, then train in Python or Edge Impulse.', 'The board samples the accelerometer at 100 Hz into a ring buffer, so a window of the last second is always ready.', 'Each window is normalised (divided by 4 g), quantized and fed to the CNN; the output is one probability per gesture.', 'Only predictions above 0.8 count, and the same gesture twice in a row is ignored — this removes most false triggers.'],
    specs: [['Sensor', 'MPU-6050, ±4 g, 100 Hz'], ['Window', '1 s = 100 × 3 values'], ['Model', 'Conv1D ×2 + Dense, int8'], ['Size', '≈ 20 KB flash, 12 KB arena'], ['Classes', 'circle, wing, slope, none']],
    code: `#include <Wire.h>
#include <Adafruit_MPU6050.h>
#include "gesture_model.h"      // trained 1-D CNN (int8)
#include "tinyml_runner.h"      // thin wrapper round TFLite Micro

Adafruit_MPU6050 mpu;
TinyRunner model(g_gesture_model, 12 * 1024);
const char* LABELS[] = {"circle", "wing", "slope", "none"};
float window[100][3];
int n = 0;

void setup() {
  Serial.begin(115200);
  Wire.begin(8, 9);                       // SDA, SCL
  mpu.begin();
  mpu.setAccelerometerRange(MPU6050_RANGE_4_G);
}

void loop() {
  sensors_event_t a, g, t;
  mpu.getEvent(&a, &g, &t);
  window[n][0] = a.acceleration.x / 39.2; // ±4 g → ±1
  window[n][1] = a.acceleration.y / 39.2;
  window[n][2] = a.acceleration.z / 39.2;
  if (++n == 100) {
    n = 0;
    float* p = model.predict(&window[0][0], 300);
    int best = argmax(p, 4);
    if (p[best] > 0.8 && best != 3)
      Serial.printf("Gesture: %s (%.2f)\\n", LABELS[best], p[best]);
  }
  delay(10);                              // 100 Hz
}`,
    lang: 'cpp',
    async run(ctx) {
      const ax = ring(120), ay = ring(120), az = ring(120);
      let t = 0;
      const sample = (g) => {
        t += 0.06; const n = () => (Math.random() - 0.5) * 0.06;
        if (g === 'circle') return [Math.sin(t * 3) * 0.7 + n(), Math.cos(t * 3) * 0.7 + n(), 0.25 + n()];
        if (g === 'wing (W)') return [Math.sign(Math.sin(t * 5)) * 0.55 + n(), Math.abs(Math.sin(t * 2.5)) * 0.6 - 0.3 + n(), 0.25 + n()];
        if (g === 'slope') return [((t * 1.5) % 2) * 0.7 - 0.7 + n(), ((t * 1.5) % 2) * -0.5 + 0.5 + n(), 0.25 + n()];
        return [n(), n(), 0.25 + n()];
      };
      ctx.preview((c, w, h) => plot(c, w, h, [ax.a, ay.a, az.a], { title: `Accelerometer x / y / z · ${ctx.input('gesture')}` }));
      ctx.at('mpu.begin()'); ctx.print('MPU-6050 found at 0x68'); await ctx.sleep(300);
      let last = null;
      for (let i = 1; ; i++) {
        const g = ctx.input('gesture');
        const [x, y, z] = sample(g); ax.push(x); ay.push(y); az.push(z);
        ctx.at('mpu.getEvent'); await ctx.sleep(30);
        if (i % 33 === 0) {
          ctx.at('model.predict'); await ctx.sleep(60);
          const label = { circle: 'circle', 'wing (W)': 'wing', slope: 'slope' }[g];
          if (label && label !== last) { ctx.at('Serial.printf'); ctx.print(`Gesture: ${label} (${fmt(0.86 + Math.random() * 0.12)})`); }
          last = label || null;
        }
      }
    },
  },
  // ------------------------------------------------------------------------
  {
    id: 'keyword-spotting', title: 'Wake word: “yes” / “no”', short: 'Keyword spotting with an I2S mic',
    difficulty: 'Intermediate', time: '60 min', topics: ['TinyML', 'Audio', 'I2S'],
    lede: 'The INMP441 microphone streams 16 kHz audio over I2S. Every 250 ms the board turns the last second into a <b>spectrogram</b> — 49 slices × 40 frequency bands — and a small CNN (the TensorFlow “micro speech” model) decides whether it heard <b>yes</b>, <b>no</b>, an unknown word or silence. “Yes” lights the LED.',
    features: [['wave', 'Audio → spectrogram on the board'], ['chip', 'micro_speech model, ≈ 18 KB'], ['hand', 'Say a word in Inputs']],
    parts: [{ id: 'mic', type: 'inmp441', at: [1.0, -1.4], label: 'INMP441 mic', why: 'the board would hear nothing' }, ...LED_PARTS('green', [6.4, 1.6])],
    wires: [['3V3', 'mic.VDD'], ['GND', 'mic.GND'], ['GPIO41', 'mic.SCK'], ['GPIO42', 'mic.WS'], ['GPIO2', 'mic.SD'], ['mic.L/R', 'GND'], ...LED_WIRES],
    preview: true, previewTitle: 'Microphone &amp; inputs', previewLabel: 'Spectrogram',
    inputs: [{ id: 'word', type: 'choice', label: 'Say', options: ['(silence)', 'yes', 'no', 'hello'] }],
    pinout: [['GPIO41', 'Mic SCK', 'I2S bit clock.'], ['GPIO42', 'Mic WS', 'I2S word select (left/right clock).'], ['GPIO2', 'Mic SD', 'I2S data in.'], ['3V3 / GND', 'Mic VDD / GND, L/R to GND', 'L/R low = left channel.'], ['GPIO21', 'Resistor → LED', 'Lights on “yes”.']],
    steps: ['The ESP32’s I2S driver fills a DMA buffer with 16-bit samples at 16 kHz; the CPU only wakes when a block is ready.', 'A 30 ms window every 20 ms becomes 40 frequency bands (an FFT plus a mel-like filter bank) — one column of the spectrogram.', 'The model sees the newest 49 columns (about one second) and outputs four scores.', 'Scores are averaged over the last few runs; a word only counts above 0.8, so a cough does not trigger it.'],
    specs: [['Mic', 'INMP441, I2S, 24-bit, 16 kHz used'], ['Features', '49 × 40 spectrogram'], ['Model', 'micro_speech CNN, int8, ≈ 18 KB'], ['Rate', 'every 250 ms'], ['Classes', 'silence, unknown, yes, no']],
    code: `#include <driver/i2s.h>
#include "micro_speech_model.h"
#include "tinyml_runner.h"
#include "feature_provider.h"    // FFT + filter bank → 49 × 40 int8

constexpr int LED_PIN = 21;
TinyRunner model(g_micro_speech_model, 30 * 1024);
FeatureProvider features(49, 40);
const char* LABELS[] = {"silence", "unknown", "yes", "no"};

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  i2s_config_t cfg = { .mode = i2s_mode_t(I2S_MODE_MASTER | I2S_MODE_RX),
    .sample_rate = 16000, .bits_per_sample = I2S_BITS_PER_SAMPLE_32BIT,
    .channel_format = I2S_CHANNEL_FMT_ONLY_LEFT, .dma_buf_count = 4, .dma_buf_len = 512 };
  i2s_pin_config_t pins = { .bck_io_num = 41, .ws_io_num = 42,
    .data_out_num = I2S_PIN_NO_CHANGE, .data_in_num = 2 };
  i2s_driver_install(I2S_NUM_0, &cfg, 0, NULL);
  i2s_set_pin(I2S_NUM_0, &pins);
}

void loop() {
  features.update(I2S_NUM_0);            // add the newest 250 ms of audio
  float* p = model.predict(features.data(), 49 * 40);
  int best = argmax(p, 4);
  if (best >= 2 && p[best] > 0.8)
    Serial.printf("Heard: %s (%.2f)\\n", LABELS[best], p[best]);
  digitalWrite(LED_PIN, best == 2 && p[best] > 0.8);
  delay(250);
}`,
    lang: 'cpp',
    async run(ctx) {
      const cols = Array.from({ length: 60 }, () => new Array(40).fill(0));
      let word = '(silence)', left = 0;
      const column = () => {
        const w = left > 0 ? word : '(silence)';
        const col = new Array(40).fill(0).map(() => Math.random() * 0.12);
        if (w !== '(silence)') {
          const ph = 1 - left / 18;
          const f = { yes: [6, 22, 31], no: [4, 9, 14], hello: [8, 16, 27] }[w];
          f.forEach((b, k) => { const c0 = Math.round(b + (w === 'yes' && k ? ph * 6 : 0)); for (let j = -2; j <= 2; j++) if (col[c0 + j] != null) col[c0 + j] = Math.min(1, 0.9 - Math.abs(j) * 0.22 - k * 0.1 + Math.random() * 0.1); });
        }
        if (left > 0) left--;
        return col;
      };
      ctx.preview((c, w, h) => {
        c.fillStyle = '#0c1118'; c.fillRect(0, 0, w, h);
        const cw = w / cols.length, ch = (h - 22) / 40;
        cols.forEach((col, i) => col.forEach((v, j) => { c.fillStyle = `hsl(${250 - v * 210}, 90%, ${12 + v * 50}%)`; c.fillRect(i * cw, h - 22 - (j + 1) * ch, cw + 0.5, ch + 0.5); }));
        hud(c, w, h, `Spectrogram · 40 bands · ${left > 0 ? `“${word}”` : 'listening…'}`);
      });
      ctx.at('i2s_driver_install'); ctx.print('I2S0 RX @ 16000 Hz, left channel'); await ctx.sleep(300);
      let said = ctx.input('word'), tick = 0, prev = null;
      for (;;) {
        const now = ctx.input('word');
        if (now !== said) { said = now; if (now !== '(silence)') { word = now; left = 18; } }
        cols.push(column()); cols.shift();
        ctx.at('features.update'); await ctx.sleep(55);
        if (++tick % 5 === 0) {
          ctx.at('model.predict');
          const heard = left > 0 && left < 12 ? word : null;
          const label = heard === 'yes' || heard === 'no' ? heard : null;
          ctx.set('led', { on: label === 'yes' });
          if (label && !prev) { ctx.at('Serial.printf'); ctx.print(`Heard: ${label} (${fmt(0.84 + Math.random() * 0.13)})`); }
          else if (heard === 'hello' && !prev) ctx.print('(unknown word — ignored)', 'cd-dim');
          prev = heard;
        }
      }
    },
  },
  // ------------------------------------------------------------------------
  {
    id: 'person-detection', title: 'Person detector camera', short: 'Visual wake words on the OV2640',
    difficulty: 'Advanced', time: '60 min', topics: ['TinyML', 'Camera', 'Vision'],
    lede: 'The classic “visual wake words” model — a MobileNet squeezed to about 300 KB — looks at a 96 × 96 greyscale frame from the OV2640 and answers one question: <b>is there a person?</b> The LED lights when there is. Turn on your webcam in Inputs and a MediaPipe detector in your browser plays the camera’s part.',
    features: [['eye', 'MobileNet person detector, int8'], ['chip', 'Frames in PSRAM, ~5 inferences a second'], ['hand', 'Use your webcam, or simulate a visitor']],
    parts: [{ id: 'cam', type: 'ov2640', at: [-6.6, -4.4], table: true, label: 'OV2640 camera', why: 'there would be no frames to look at' }, ...LED_PARTS('green')],
    wires: [['CAM', 'cam.CAM'], ...LED_WIRES], preview: true, ml: 'objects',
    inputs: [{ id: 'who', type: 'choice', scene: true, label: 'In front of the camera', options: ['nobody', 'a person'] }],
    pinout: [['CAM', 'OV2640 ribbon', '24-pin DVP camera connector on the board (pins fixed by the board design).'], ['GPIO21', 'Resistor → LED', 'On while a person is seen.']],
    steps: ['<code>esp_camera_init</code> sets the OV2640 to 96 × 96 greyscale and puts frame buffers in PSRAM.', 'The model is the TensorFlow Lite Micro <em>person_detection</em> example: MobileNet v1 (0.25 width), trained on the Visual Wake Words dataset.', 'The S3’s vector instructions (ESP-NN) make the convolutions several times faster than on the plain ESP32.', 'A person score above 0.6 lights the LED. Frames never leave the board — good for privacy.'],
    specs: [['Camera', 'OV2640, 96 × 96 greyscale'], ['Model', 'MobileNet v1 0.25, int8, ≈ 300 KB'], ['Arena', '≈ 136 KB (PSRAM)'], ['Speed', '≈ 5 fps on ESP32-S3 with ESP-NN'], ['Output', 'person / no person score']],
    code: `#include "esp_camera.h"
#include "person_detect_model.h"
#include "tinyml_runner.h"
#include "camera_pins.h"         // the board's DVP pin map

constexpr int LED_PIN = 21;
TinyRunner model(g_person_detect_model, 136 * 1024, /*psram=*/true);

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  camera_config_t cfg = CAMERA_PINS;
  cfg.pixel_format = PIXFORMAT_GRAYSCALE;
  cfg.frame_size = FRAMESIZE_96X96;
  cfg.fb_location = CAMERA_FB_IN_PSRAM;
  esp_camera_init(&cfg);
}

void loop() {
  camera_fb_t* fb = esp_camera_fb_get();
  int8_t* in = model.input();
  for (int i = 0; i < 96 * 96; i++) in[i] = fb->buf[i] - 128;
  esp_camera_fb_return(fb);
  model.invoke();
  float person = model.score(1);
  digitalWrite(LED_PIN, person > 0.6);
  Serial.printf("person score: %.2f%s\\n", person,
                person > 0.6 ? "  → PERSON" : "");
}`,
    lang: 'cpp',
    async run(ctx) {
      let score = 0.05;
      ctx.preview((c, w, h, t) => {
        room(c, w, h);
        if (ctx.input('who') === 'a person') person(c, w * 0.5 + Math.sin(t * 0.8) * 10, h * 0.92, h * 0.8, '#4b5b73');
        // the board sees 96 × 96 greyscale: show that crop
        const s = h * 0.86, x0 = (w - s) / 2, y0 = (h - 22 - s) / 2 + 2;
        c.strokeStyle = score > 0.6 ? '#30d158' : 'rgba(255,255,255,0.7)'; c.lineWidth = 2; c.setLineDash([5, 4]); c.strokeRect(x0, y0, s, s); c.setLineDash([]);
        hud(c, w, h, `96 × 96 crop · person score ${fmt(score)}`);
      });
      ctx.at('esp_camera_init'); ctx.print('Camera OV2640 ready, 96x96 GRAYSCALE, fb in PSRAM'); await ctx.sleep(400);
      let was = null;
      for (let i = 0; ; i++) {
        ctx.at('esp_camera_fb_get'); await ctx.sleep(80);
        ctx.at('model.invoke()'); await ctx.sleep(110);
        const live = ctx.live();
        const seen = live ? live.people > 0 : ctx.input('who') === 'a person';
        const target = seen ? 0.88 + Math.random() * 0.08 : 0.04 + Math.random() * 0.08;
        score += (target - score) * 0.6;
        ctx.set('led', { on: score > 0.6 });
        ctx.readout('led', score > 0.6 ? 'person' : 'off');
        const now = score > 0.6;
        if (now !== was || i % 6 === 0) { ctx.at('Serial.printf'); ctx.print(`person score: ${fmt(score)}${now ? '  → PERSON' : ''}${live ? '  (from your webcam)' : ''}`); was = now; }
      }
    },
  },
  // ------------------------------------------------------------------------
  {
    id: 'vibration-anomaly', title: 'Vibration anomaly alarm', short: 'An autoencoder that spots a failing motor',
    difficulty: 'Advanced', time: '60 min', topics: ['TinyML', 'IMU', 'Anomaly'],
    lede: 'Clip an MPU-6050 to a fan or pump. An <b>autoencoder</b> trained only on the healthy machine learns to rebuild its normal vibration spectrum. When a bearing wears, the spectrum changes, the rebuild gets worse, and the error crosses a threshold — so the board sounds the buzzer without ever having seen a fault.',
    features: [['wave', 'Vibration spectrum from the IMU'], ['chip', 'Autoencoder, trained on “normal” only'], ['hand', 'Wear the bearing out in Inputs']],
    parts: [{ ...IMU, label: 'MPU-6050 (on the motor)' }, { id: 'bz', type: 'buzzer', at: [6.6, 1.6], label: 'Buzzer', why: 'the alarm would be silent' }],
    wires: [...IMU_WIRES, ['GPIO47', 'bz.+'], ['bz.-', 'GND']],
    preview: true, previewTitle: 'Sensor &amp; inputs', previewLabel: 'Vibration and reconstruction error',
    inputs: [{ id: 'wear', type: 'range', label: 'Bearing wear', min: 0, max: 1, step: 0.05, value: 0 }],
    pinout: [['GPIO8 / GPIO9', 'MPU-6050 SDA / SCL', 'I2C at 400 kHz.'], ['3V3 / GND', 'MPU-6050 VCC / GND', 'Power.'], ['GPIO47', 'Buzzer +', 'Alarm output.']],
    steps: ['Sample the accelerometer at 1 kHz for 256 samples and take an FFT: 32 frequency bands make one input vector.', 'The autoencoder squeezes those 32 numbers through a bottleneck of 8 and rebuilds them. It is trained only on recordings of the healthy machine.', 'The mean squared error between input and rebuild is the anomaly score. Set the threshold a little above the worst score seen on healthy data.', 'Require a few high scores in a row before the alarm, and log the scores — a slow rise is an early warning.'],
    specs: [['Sampling', '1 kHz, 256-sample windows'], ['Features', '32 FFT bands'], ['Model', 'Dense 32→16→8→16→32, int8, ≈ 4 KB'], ['Threshold', 'MSE > 0.02'], ['Alarm', 'Active buzzer on GPIO47']],
    code: `#include <Wire.h>
#include <Adafruit_MPU6050.h>
#include <arduinoFFT.h>
#include "autoencoder_model.h"
#include "tinyml_runner.h"

constexpr int BUZZER = 47;
constexpr float THRESHOLD = 0.02;
Adafruit_MPU6050 mpu;
TinyRunner model(g_autoencoder_model, 8 * 1024);
float re[256], im[256], bands[32];
int strikes = 0;

void setup() {
  Serial.begin(115200);
  pinMode(BUZZER, OUTPUT);
  Wire.begin(8, 9);
  Wire.setClock(400000);
  mpu.begin();
}

void loop() {
  for (int i = 0; i < 256; i++) {          // 256 samples at 1 kHz
    sensors_event_t a, g, t;
    mpu.getEvent(&a, &g, &t);
    re[i] = a.acceleration.z; im[i] = 0;
    delayMicroseconds(1000);
  }
  ArduinoFFT<float> fft(re, im, 256, 1000);
  fft.windowing(FFTWindow::Hann, FFTDirection::Forward);
  fft.compute(FFTDirection::Forward);
  fft.complexToMagnitude();
  toBands(re, bands, 32);                  // average into 32 bands, 0–1
  float* out = model.predict(bands, 32);
  float mse = 0;
  for (int i = 0; i < 32; i++) mse += sq(out[i] - bands[i]) / 32;
  strikes = mse > THRESHOLD ? strikes + 1 : 0;
  digitalWrite(BUZZER, strikes >= 3);
  Serial.printf("anomaly score %.4f%s\\n", mse, strikes >= 3 ? "  ALARM" : "");
}`,
    lang: 'cpp',
    async run(ctx) {
      const vib = ring(140), err = ring(140);
      let t = 0, mse = 0.004, strikes = 0;
      ctx.preview((c, w, h) => {
        plot(c, w, h, [vib.a, err.a.map((e) => e * 18 - 0.9)], { colors: ['#57c2ff', '#ffb347'], title: `Vibration (blue) · error (amber) · ${mse > 0.02 ? 'ANOMALY' : 'normal'}` });
        const ty = h * 0.45 - (0.02 * 18 - 0.9) * h * 0.32;
        c.strokeStyle = 'rgba(255,90,80,0.8)'; c.setLineDash([4, 4]); c.beginPath(); c.moveTo(0, ty); c.lineTo(w, ty); c.stroke(); c.setLineDash([]);
      });
      ctx.at('mpu.begin()'); ctx.print('MPU-6050 found at 0x68 (I2C 400 kHz)'); await ctx.sleep(300);
      for (let i = 0; ; i++) {
        const wear = ctx.input('wear');
        for (let k = 0; k < 6; k++) { t += 0.35; vib.push(Math.sin(t) * 0.35 + Math.sin(t * 3.7) * 0.12 * (1 + wear * 4) + (Math.random() - 0.5) * (0.1 + wear * 0.5)); err.push(mse); }
        ctx.at('mpu.getEvent'); await ctx.sleep(120);
        ctx.at('model.predict'); await ctx.sleep(60);
        mse = 0.004 + wear * wear * 0.05 + Math.random() * 0.003;
        strikes = mse > 0.02 ? strikes + 1 : 0;
        ctx.set('bz', { on: strikes >= 3 });
        ctx.readout('bz', strikes >= 3 ? 'ALARM' : 'quiet');
        if (i % 3 === 0 || strikes === 3) { ctx.at('Serial.printf'); ctx.print(`anomaly score ${fmt(mse, 4)}${strikes >= 3 ? '  ALARM' : ''}`, strikes >= 3 ? 'cd-err' : undefined); }
      }
    },
  },
  // ------------------------------------------------------------------------
  {
    id: 'quantize-int8', title: 'Shrink a model to int8', short: 'Post-training quantization on your laptop',
    difficulty: 'Intermediate', time: '30 min', topics: ['TinyML', 'Python', 'Quantization'],
    lede: 'Every model in this track was trained in floating point and then <b>quantized</b>: each 32-bit weight became an 8-bit integer plus a shared scale. The model gets four times smaller and much faster on the S3’s integer vector unit, and usually loses less than one percent of accuracy. This script does it for the gesture model, on your laptop.',
    features: [['code', 'TensorFlow Lite converter, full-int8'], ['chip', '4× smaller, ready for TFLite Micro'], ['bolt', 'Check accuracy before you flash']],
    parts: [], wires: [], noBreadboard: true,
    pinout: [['USB-C', 'Your laptop', 'Only to flash the result — the conversion runs on the laptop.']],
    steps: ['A <em>representative dataset</em> — a few hundred real inputs — lets the converter measure each layer’s range and pick its scale and zero point.', '<code>TFLITE_BUILTINS_INT8</code> with int8 input and output makes the whole graph integer-only, which is what TFLite Micro on the ESP32-S3 expects.', 'Always re-check accuracy on test data with the quantized model; if it drops a lot, try quantization-aware training.', '<code>xxd -i</code> turns the <code>.tflite</code> file into a C array to <code>#include</code> in the sketch.'],
    specs: [['Tool', 'TensorFlow 2.x TFLiteConverter'], ['Weights', 'int8 (per-channel)'], ['Activations', 'int8 (per-tensor)'], ['Typical size', '≈ ¼ of float32'], ['Runs on', 'any laptop, no GPU needed']],
    code: `import numpy as np
import tensorflow as tf

model = tf.keras.models.load_model("gesture_cnn.keras")
x_train = np.load("gesture_x_train.npy").astype(np.float32)
x_test, y_test = np.load("gesture_x_test.npy"), np.load("gesture_y_test.npy")

def representative_data():
    for i in range(300):
        yield [x_train[i:i + 1]]

conv = tf.lite.TFLiteConverter.from_keras_model(model)
conv.optimizations = [tf.lite.Optimize.DEFAULT]
conv.representative_dataset = representative_data
conv.target_spec.supported_ops = [tf.lite.OpsSet.TFLITE_BUILTINS_INT8]
conv.inference_input_type = tf.int8
conv.inference_output_type = tf.int8
tflite_model = conv.convert()
open("gesture_int8.tflite", "wb").write(tflite_model)

# accuracy of the int8 model on the test set
interp = tf.lite.Interpreter(model_content=tflite_model)
interp.allocate_tensors()
inp, out = interp.get_input_details()[0], interp.get_output_details()[0]
s, z = inp["quantization"]
correct = 0
for x, y in zip(x_test, y_test):
    interp.set_tensor(inp["index"], (x / s + z).astype(np.int8)[None])
    interp.invoke()
    correct += int(np.argmax(interp.get_tensor(out["index"])) == y)
print(f"float32: {model.count_params() * 4 / 1024:.1f} KB")
print(f"int8:    {len(tflite_model) / 1024:.1f} KB")
print(f"int8 accuracy: {correct / len(y_test):.1%}")`,
    lang: 'py',
    async run(ctx) {
      ctx.at('model = tf.keras.models.load_model'); ctx.print('Loaded gesture_cnn.keras: 19,844 parameters'); await ctx.sleep(600);
      ctx.at('conv = tf.lite.TFLiteConverter'); await ctx.sleep(300);
      ctx.at('tflite_model = conv.convert()'); ctx.print('Calibrating with 300 representative samples…'); await ctx.sleep(1200);
      ctx.print('Converted: all ops are int8 (CONV_2D, MAX_POOL_2D, FULLY_CONNECTED, SOFTMAX)'); await ctx.sleep(400);
      ctx.at('open("gesture_int8.tflite"'); await ctx.sleep(300);
      ctx.at('for x, y in zip'); ctx.print('Evaluating 400 test windows…'); await ctx.sleep(1000);
      ctx.at('print(f"float32'); ctx.print('float32: 77.5 KB');
      ctx.at('print(f"int8:'); ctx.print('int8:    22.9 KB');
      ctx.at('print(f"int8 accuracy'); ctx.print('int8 accuracy: 95.8%  (float32 was 96.3%)', 'cd-ok'); await ctx.sleep(300);
      ctx.print('Next: xxd -i gesture_int8.tflite > gesture_model.h', 'cd-dim');
    },
  },
];

export const PROJECTS = PROJECTS_RAW.map((p, i) => ({ ...p, n: i + 1, thumb: `/tinyml/thumbs/${p.id}.png` }));
export const byId = Object.fromEntries(PROJECTS.map((p) => [p.id, p]));

const BASE = [
  [1, 'ESP32-S3 CAM board with 8 MB PSRAM (ESP32-S3-WROOM-1 N16R8), OV2640 camera usually included'],
  [1, 'USB-C data cable'],
];
const RESISTOR = { 330: '330 Ω', '1k': '1 kΩ' };

// Quantities with generic specs — no shops, no prices.
export function buyList(p) {
  const out = [...BASE];
  const counts = new Map();
  for (const part of p.parts) {
    if (part.type === 'ov2640') continue; // comes with the board
    const key = part.type === 'resistor' ? `resistor:${part.opts?.ohms}` : part.type === 'led' ? `led:${part.opts?.color}` : part.type;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  for (const [key, qty] of counts) {
    const [type, v] = key.split(':');
    if (type === 'resistor') out.push([qty, `${RESISTOR[v] || v + ' Ω'} resistor, ¼ W`]);
    else if (type === 'led') out.push([qty, `5 mm ${v} LED`]);
    else out.push([qty, PARTS[type].buy]);
  }
  if (!p.noBreadboard) out.push([1, 'Half-size breadboard (400 tie points)'], [1, 'Jumper wires, male-to-male (assorted pack)']);
  else out.push([1, 'A laptop with Python 3 and TensorFlow (pip install tensorflow)']);
  return out;
}
