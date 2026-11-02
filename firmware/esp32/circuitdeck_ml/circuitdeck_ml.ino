// CircuitDeck ML: the runtime firmware for models trained in the browser (Train panel).
//
// Flash this sketch ONCE with the Arduino IDE (board: ESP32 Dev Module or ESP32S3 Dev Module,
// "Partition Scheme" uses partitions.csv from this folder automatically). After that the
// browser's "Compile & flash" button only rewrites the 256 KB "cdmodel" partition with a new
// model blob. If that partition is empty, the copy in model_data.h is used.
//
// Sensors:  mic    = INMP441 I2S (SCK 14, WS 15, SD 32; S3: SCK 4, WS 5, SD 6)
//           motion = MPU-6050 on I2C (default Wire pins; ESP32: SDA 21, SCL 22)
//           camera = not on the ESP32 here: the 1.7 MB MobileNet feature extractor runs on the
//                    Pi 5 (see the Pi 5 zip). The sketch says so and stops.
// Outputs (same pins as the sandbox scene): LED GPIO 26 (via 330 Ω), relay IN GPIO 27, buzzer GPIO 25.
// Serial (115200) prints "class  confidence" for each prediction.

#include <Arduino.h>
#include <Wire.h>
#include <esp_partition.h>
#include <driver/i2s.h>
#include "cd_model.h"
#include "cd_features.h"
#include "model_data.h"

#if CONFIG_IDF_TARGET_ESP32S3
#define I2S_SCK 4
#define I2S_WS 5
#define I2S_SD 6
#else
#define I2S_SCK 14
#define I2S_WS 15
#define I2S_SD 32
#endif
#define PIN_LED 26
#define PIN_RELAY 27
#define PIN_BUZZER 25
#define MIC_RATE 16000
#define THRESHOLD 0.6f

static cd::Model model;
static float input[CD_MIC_FRAMES * CD_MIC_BANDS];
static float probs[cd::MAX_CLASSES];
static uint8_t *partBlob = nullptr;

static const char *loadModel() {
  const esp_partition_t *part = esp_partition_find_first(ESP_PARTITION_TYPE_DATA, (esp_partition_subtype_t)0x40, "cdmodel");
  if (part) {
    uint8_t head[12];
    if (esp_partition_read(part, 0, head, 12) == ESP_OK && memcmp(head, "CDM1", 4) == 0) {
      uint32_t plen; memcpy(&plen, head + 4, 4);
      if (plen + 12 <= part->size && (partBlob = (uint8_t *)malloc(plen + 12)) && esp_partition_read(part, 0, partBlob, plen + 12) == ESP_OK) {
        const char *err = cd::load(model, partBlob, plen + 12);
        Serial.printf("cdmodel partition: %s\n", err ? err : "loaded");
        if (!err) return nullptr;
      }
    } else Serial.println("cdmodel partition is empty, so using model_data.h");
  } else Serial.println("No cdmodel partition (is partitions.csv in the sketch folder?), so using model_data.h");
  if (!cd_model_len) return "no model: train one in the browser and flash it, or replace model_data.h";
  return cd::load(model, cd_model, cd_model_len);
}

static void micBegin() {
  i2s_config_t cfg = {};
  cfg.mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_RX); cfg.sample_rate = MIC_RATE;
  cfg.bits_per_sample = I2S_BITS_PER_SAMPLE_32BIT; cfg.channel_format = I2S_CHANNEL_FMT_ONLY_LEFT;
  cfg.communication_format = I2S_COMM_FORMAT_STAND_I2S; cfg.dma_buf_count = 8; cfg.dma_buf_len = 256;
  i2s_pin_config_t pins = {};
  pins.bck_io_num = I2S_SCK; pins.ws_io_num = I2S_WS; pins.data_out_num = I2S_PIN_NO_CHANGE; pins.data_in_num = I2S_SD;
  i2s_driver_install(I2S_NUM_0, &cfg, 0, nullptr); i2s_set_pin(I2S_NUM_0, &pins);
}
// 40 frames: each frame = the newest 512 samples, hop 400 (25 ms)
static void micWindow() {
  static float ring[512]; static int32_t raw[400];
  for (int f = 0; f < CD_MIC_FRAMES; f++) {
    size_t got = 0; i2s_read(I2S_NUM_0, raw, sizeof(raw), &got, portMAX_DELAY);
    memmove(ring, ring + 400, (512 - 400) * sizeof(float));
    for (int i = 0; i < 400; i++) ring[112 + i] = (raw[i] >> 8) / 8388608.0f;
    cdf::micRow(ring, MIC_RATE, input + f * CD_MIC_BANDS);
  }
}

static void mpuBegin() { Wire.begin(); Wire.beginTransmission(0x68); Wire.write(0x6B); Wire.write(0); Wire.endTransmission(); }
static void motionWindow() {
  for (int s = 0; s < CD_MOTION_STEPS; s++) {
    Wire.beginTransmission(0x68); Wire.write(0x3B); Wire.endTransmission(false);
    Wire.requestFrom(0x68, 14);
    int16_t v[7]; for (int i = 0; i < 7; i++) v[i] = (Wire.read() << 8) | Wire.read();
    float *o = input + s * CD_MOTION_CH;
    o[0] = v[0] / 16384.0f; o[1] = v[1] / 16384.0f; o[2] = v[2] / 16384.0f;          // ±2 g → g
    o[3] = v[4] / 131.0f / 250; o[4] = v[5] / 131.0f / 250; o[5] = v[6] / 131.0f / 250;  // ±250 °/s
    delay(50);
  }
}

static void act(int cls) {
  uint8_t a = model.actions[cls];
  digitalWrite(PIN_LED, a == cd::ACT_LED); digitalWrite(PIN_RELAY, a == cd::ACT_RELAY);
  if (a == cd::ACT_BUZZER) tone(PIN_BUZZER, 2300); else noTone(PIN_BUZZER);
}

void setup() {
  Serial.begin(115200); delay(300);
  pinMode(PIN_LED, OUTPUT); pinMode(PIN_RELAY, OUTPUT); pinMode(PIN_BUZZER, OUTPUT);
  const char *err = loadModel();
  if (err) { Serial.printf("CircuitDeck ML: %s\n", err); while (true) delay(1000); }
  Serial.printf("CircuitDeck ML: %d classes, sensor %d\n", model.nClasses, model.sensor);
  for (int i = 0; i < model.nClasses; i++) Serial.printf("  %d %s (action %d)\n", i, model.names[i], model.actions[i]);
  if (model.sensor == 0) { Serial.println("Camera models need the MobileNet feature extractor, so run them on the Pi 5 (see the Pi 5 zip)."); while (true) delay(1000); }
  if (model.sensor == 1) micBegin(); else mpuBegin();
}

void loop() {
  if (model.sensor == 1) micWindow(); else motionWindow();
  int best = cd::run(model, input, probs);
  Serial.printf("%s  %.2f\n", model.names[best], probs[best]);
  if (probs[best] >= THRESHOLD) act(best);
}
