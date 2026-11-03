// Host build of the ESP32 interpreter (firmware/esp32/circuitdeck_ml/cd_model.h) for tests.
// Usage: cd-host model.cdm inputs.f32 N  → prints N lines of class probabilities.
#include <cstdio>
#include <vector>
#include "cd_model.h"  // -I firmware/esp32/circuitdeck_ml
int main(int argc, char **argv) {
  if (argc < 4) return 2;
  auto slurp = [](const char *f) { std::vector<uint8_t> v; FILE *fp = fopen(f, "rb"); if (!fp) return v; int c; while ((c = fgetc(fp)) != EOF) v.push_back((uint8_t)c); fclose(fp); return v; };
  std::vector<uint8_t> blob = slurp(argv[1]), in = slurp(argv[2]);
  static cd::Model m;
  if (const char *err = cd::load(m, blob.data(), blob.size())) { printf("ERR %s\n", err); return 1; }
  int n = atoi(argv[3]), sz = m.in.size();
  if ((int)in.size() != n * sz * 4) { printf("ERR input size %zu != %d\n", in.size(), n * sz * 4); return 1; }
  std::vector<float> probs(m.nClasses);
  for (int i = 0; i < n; i++) {
    cd::run(m, (const float *)in.data() + i * sz, probs.data());
    for (int k = 0; k < m.nClasses; k++) printf("%s%.6f", k ? " " : "", probs[k]);
    printf("\n");
  }
  return 0;
}
