// Feature extraction on the ESP32, mirroring src/train/spec.js in the browser.
//  mic:    INMP441 I2S mic at 16 kHz; 512-point FFT (Hann) every 25 ms (400 samples);
//          32 log-spaced bands 80 Hz–8 kHz, averaged in dB, mapped -100..-30 dB → 0..1; 40 frames (1 s).
//  motion: MPU-6050 accel (g) and gyro (°/s ÷ 250) at 20 Hz; 40 steps (2 s) × 6 channels.
// Honest note: the browser measures sound with Web Audio's analyser, so absolute levels differ
// from this mic. If on-device accuracy is poor, record samples on the board and retrain.
#pragma once
#include <Arduino.h>
#include <math.h>

#define CD_MIC_FRAMES 40
#define CD_MIC_BANDS 32
#define CD_MOTION_STEPS 40
#define CD_MOTION_CH 6

namespace cdf {

// ---------------- small radix-2 FFT (in place, n = 512)
static void fft(float *re, float *im, int n) {
  for (int i = 1, j = 0; i < n; i++) {
    int bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit;
    if (i < j) { float t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (int len = 2; len <= n; len <<= 1) {
    float ang = -2 * M_PI / len, wr = cosf(ang), wi = sinf(ang);
    for (int i = 0; i < n; i += len) {
      float cr = 1, ci = 0;
      for (int k = 0; k < len / 2; k++) {
        float ur = re[i + k], ui = im[i + k];
        float vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci, vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi; re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        float nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}

// one spectrogram row from 512 samples at `rate` Hz (values in -1..1)
static void micRow(const float *samples, float rate, float *row) {
  static float re[512], im[512];
  for (int i = 0; i < 512; i++) { float w = 0.5f - 0.5f * cosf(2 * M_PI * i / 511); re[i] = samples[i] * w; im[i] = 0; }
  fft(re, im, 512);
  float binHz = rate / 512;
  for (int b = 0; b < CD_MIC_BANDS; b++) {
    float lo = 80 * powf(100.f, (float)b / CD_MIC_BANDS), hi = 80 * powf(100.f, (float)(b + 1) / CD_MIC_BANDS);
    int k0 = max(1, (int)floorf(lo / binHz)), k1 = max(k0 + 1, (int)ceilf(hi / binHz));
    float s = 0; int n = 0;
    for (int k = k0; k < k1 && k < 256; k++) { float mag = sqrtf(re[k] * re[k] + im[k] * im[k]) / 512; s += 20 * log10f(mag + 1e-9f); n++; }
    float db = n ? s / n : -100;
    row[b] = fminf(1, fmaxf(0, (db + 100) / 70));
  }
}

}  // namespace cdf
