// CircuitDeck model runtime (CDM1 format), a tiny float interpreter for the layers the
// browser's Train panel produces: Dense, Conv1D, Conv2D (valid padding), MaxPool1D/2D,
// Flatten; activations linear/relu/softmax. Weights are stored as int8 with one scale
// per tensor and dequantised to float once, at load.
#pragma once
#include <stdint.h>
#include <string.h>
#include <math.h>
#include <stdlib.h>

namespace cd {

enum LayerType : uint8_t { DENSE = 1, CONV1D = 2, CONV2D = 3, MAXPOOL1D = 4, MAXPOOL2D = 5, FLATTEN = 6 };
enum Act : uint8_t { LINEAR = 0, RELU = 1, SOFTMAX = 2 };
enum Action : uint8_t { ACT_NONE = 0, ACT_LED = 1, ACT_RELAY = 2, ACT_BUZZER = 3 };
static const int MAX_CLASSES = 16, MAX_LAYERS = 16;

struct Layer { uint8_t type, act; uint16_t p[4]; float *w = nullptr, *b = nullptr; uint32_t nw = 0, nb = 0; };
struct Shape { int h, w, c; int size() const { return h * w * c; } };

struct Model {
  uint8_t sensor = 0, nClasses = 0, rank = 0, nLayers = 0;
  uint16_t dims[3] = {1, 1, 1};
  char names[MAX_CLASSES][32];
  uint8_t actions[MAX_CLASSES];
  Layer layers[MAX_LAYERS];
  float *bufA = nullptr, *bufB = nullptr; int bufLen = 0;
  Shape in;
};

static uint32_t crc32(const uint8_t *d, size_t n) {
  uint32_t c = 0xFFFFFFFF;
  for (size_t i = 0; i < n; i++) { c ^= d[i]; for (int k = 0; k < 8; k++) c = (c & 1) ? 0xEDB88320 ^ (c >> 1) : c >> 1; }
  return c ^ 0xFFFFFFFF;
}
static inline uint16_t rd16(const uint8_t *&p) { uint16_t v = p[0] | (p[1] << 8); p += 2; return v; }
static inline uint32_t rd32(const uint8_t *&p) { uint32_t v; memcpy(&v, p, 4); p += 4; return v; }
static inline float rdf(const uint8_t *&p) { float v; memcpy(&v, p, 4); p += 4; return v; }

static Shape outShape(const Layer &L, Shape s) {
  switch (L.type) {
    case DENSE: return {1, 1, L.p[0]};
    case CONV1D: return {(s.h - L.p[1]) / L.p[2] + 1, 1, L.p[0]};
    case CONV2D: return {(s.h - L.p[1]) / L.p[3] + 1, (s.w - L.p[2]) / L.p[3] + 1, L.p[0]};
    case MAXPOOL1D: return {(s.h - L.p[0]) / L.p[1] + 1, 1, s.c};
    case MAXPOOL2D: return {(s.h - L.p[0]) / L.p[2] + 1, (s.w - L.p[1]) / L.p[3] + 1, s.c};
    default: return {1, 1, s.size()};
  }
}

// Parse a blob ("CDM1" + len + crc + payload). Returns an error string, or nullptr on success.
static const char *load(Model &m, const uint8_t *blob, size_t len) {
  if (len < 12 || memcmp(blob, "CDM1", 4) != 0) return "no CDM1 magic";
  const uint8_t *p = blob + 4;
  uint32_t plen = rd32(p), crc = rd32(p);
  if (plen + 12 > len) return "truncated";
  if (crc32(blob + 12, plen) != crc) return "CRC mismatch";
  if (*p++ != 1) return "unknown version";
  m.sensor = *p++; m.nClasses = *p++; m.rank = *p++;
  for (int i = 0; i < 3; i++) m.dims[i] = rd16(p);
  if (m.nClasses > MAX_CLASSES) return "too many classes";
  for (int i = 0; i < m.nClasses; i++) { uint8_t n = *p++; memcpy(m.names[i], p, n); m.names[i][n] = 0; p += n; m.actions[i] = *p++; }
  m.nLayers = *p++;
  if (m.nLayers > MAX_LAYERS) return "too many layers";
  m.in = m.rank == 1 ? Shape{1, 1, m.dims[0]} : m.rank == 2 ? Shape{m.dims[0], 1, m.dims[1]} : Shape{m.dims[0], m.dims[1], m.dims[2]};
  Shape s = m.in; int maxLen = s.size();
  for (int i = 0; i < m.nLayers; i++) {
    Layer &L = m.layers[i];
    L.type = *p++; L.act = *p++;
    for (int k = 0; k < 4; k++) L.p[k] = rd16(p);
    L.nw = rd32(p);
    if (L.nw) {
      float scale = rdf(p);
      L.w = (float *)malloc(L.nw * sizeof(float));
      if (!L.w) return "out of memory";
      for (uint32_t k = 0; k < L.nw; k++) L.w[k] = (int8_t)p[k] * scale;
      p += L.nw;
      L.nb = rd32(p);
      L.b = (float *)malloc(L.nb * sizeof(float));
      if (!L.b) return "out of memory";
      for (uint32_t k = 0; k < L.nb; k++) L.b[k] = rdf(p);
    }
    s = outShape(L, s);
    if (s.size() > maxLen) maxLen = s.size();
  }
  if (s.size() != m.nClasses) return "output size != class count";
  m.bufLen = maxLen;
  m.bufA = (float *)malloc(maxLen * sizeof(float));
  m.bufB = (float *)malloc(maxLen * sizeof(float));
  return (m.bufA && m.bufB) ? nullptr : "out of memory";
}

static inline float act(float v, uint8_t a) { return (a == RELU && v < 0) ? 0 : v; }

// x has m.in.size() floats; probs gets nClasses floats. Returns the arg-max class.
static int run(Model &m, const float *x, float *probs) {
  float *src = m.bufA, *dst = m.bufB;
  memcpy(src, x, m.in.size() * sizeof(float));
  Shape s = m.in;
  for (int li = 0; li < m.nLayers; li++) {
    const Layer &L = m.layers[li];
    Shape o = outShape(L, s);
    switch (L.type) {
      case DENSE: {
        int in = s.size(), out = L.p[0];
        for (int j = 0; j < out; j++) { float a = L.b[j]; for (int i = 0; i < in; i++) a += src[i] * L.w[i * out + j]; dst[j] = act(a, L.act); }
      } break;
      case CONV1D: {   // kernel [k][C][F]
        int k = L.p[1], st = L.p[2], F = L.p[0], C = s.c;
        for (int t = 0; t < o.h; t++) for (int f = 0; f < F; f++) {
          float a = L.b[f];
          for (int kk = 0; kk < k; kk++) for (int c = 0; c < C; c++) a += src[(t * st + kk) * C + c] * L.w[(kk * C + c) * F + f];
          dst[t * F + f] = act(a, L.act);
        }
      } break;
      case CONV2D: {   // kernel [kh][kw][C][F], input HWC
        int kh = L.p[1], kw = L.p[2], st = L.p[3], F = L.p[0], C = s.c;
        for (int y = 0; y < o.h; y++) for (int xx = 0; xx < o.w; xx++) for (int f = 0; f < F; f++) {
          float a = L.b[f];
          for (int i = 0; i < kh; i++) for (int j = 0; j < kw; j++) for (int c = 0; c < C; c++)
            a += src[((y * st + i) * s.w + (xx * st + j)) * C + c] * L.w[((i * kw + j) * C + c) * F + f];
          dst[(y * o.w + xx) * F + f] = act(a, L.act);
        }
      } break;
      case MAXPOOL1D: {
        int ps = L.p[0], st = L.p[1];
        for (int t = 0; t < o.h; t++) for (int c = 0; c < s.c; c++) { float mx = -1e30f; for (int k = 0; k < ps; k++) mx = fmaxf(mx, src[(t * st + k) * s.c + c]); dst[t * s.c + c] = mx; }
      } break;
      case MAXPOOL2D: {
        int ph = L.p[0], pw = L.p[1], sh = L.p[2], sw = L.p[3];
        for (int y = 0; y < o.h; y++) for (int xx = 0; xx < o.w; xx++) for (int c = 0; c < s.c; c++) {
          float mx = -1e30f;
          for (int i = 0; i < ph; i++) for (int j = 0; j < pw; j++) mx = fmaxf(mx, src[((y * sh + i) * s.w + (xx * sw + j)) * s.c + c]);
          dst[(y * o.w + xx) * s.c + c] = mx;
        }
      } break;
      default: memcpy(dst, src, s.size() * sizeof(float));   // FLATTEN: HWC order is already row-major
    }
    if (L.act == SOFTMAX) {
      int n = o.size(); float mx = -1e30f, sum = 0;
      for (int i = 0; i < n; i++) mx = fmaxf(mx, dst[i]);
      for (int i = 0; i < n; i++) { dst[i] = expf(dst[i] - mx); sum += dst[i]; }
      for (int i = 0; i < n; i++) dst[i] /= sum;
    }
    float *t = src; src = dst; dst = t; s = o;
  }
  int best = 0;
  for (int i = 0; i < m.nClasses; i++) { probs[i] = src[i]; if (src[i] > src[best]) best = i; }
  return best;
}

}  // namespace cd
