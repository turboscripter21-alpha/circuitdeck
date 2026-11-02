# CircuitDeck ML firmware (ESP32 / ESP32-S3)

This is the runtime for models you train in the CircuitDeck sandbox's **Train** panel.

* `circuitdeck_ml.ino` reads a sensor window, runs the model and drives LED 26 / relay 27 / buzzer 25.
* `cd_model.h` is a small interpreter for the CDM1 model format (int8 weights, float maths): Dense, Conv1D, Conv2D, MaxPool and Flatten layers.
* `cd_features.h` computes the mic spectrogram (I2S INMP441) and motion window (MPU-6050), matching the browser's features.
* `partitions.csv` is a 4 MB layout with a 256 KB `cdmodel` data partition at **0x3C0000**.
* `model_data.h` holds the compiled-in model, used when the partition is empty. The zip you download from the Train panel contains your trained model here.

## What's real and what isn't
* **Real:** the browser trains the model and exports it as int8 weights. Over Web Serial (Chrome or Edge on desktop), "Compile & flash" uses esptool-js to write the blob to `0x3C0000` on a real board.
* **Not done in the browser:** compiling this C++ code. Flash this sketch once with the Arduino IDE (esp32 core 2.x or 3.x). After that, new models can be flashed from the browser in seconds. If you exported a merged `.bin` (Sketch → Export Compiled Binary), the Train panel can flash that too.
* **Not TFLite Micro:** an int8 `.tflite` flatbuffer can't be produced in the browser, so this sketch uses its own interpreter for the same layers. It needs no extra libraries.
* **Camera models** need the MobileNet feature extractor, so they run on the Pi 5.
