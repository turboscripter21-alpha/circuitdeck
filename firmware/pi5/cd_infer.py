#!/usr/bin/env python3
"""CircuitDeck ML on the Raspberry Pi 5: live inference for a model trained in the browser.

    python3 cd_infer.py                # uses model.json next to this file
    python3 cd_infer.py --dry-run      # no GPIO (prints only)

camera: Pi camera (picamera2) or a USB webcam (OpenCV) -> MobileNetV2 0.35 (Keras, ImageNet
        weights, global-average-pooled) -> your dense head. Needs TensorFlow (pip install tensorflow).
mic:    USB mic via sounddevice at 16 kHz -> the same 40x32 log-band spectrogram as the browser.
motion: MPU-6050 on I2C bus 1 (SDA GPIO2, SCL GPIO3) at 20 Hz -> 40x6 window.
Outputs (gpiozero): LED GPIO17, relay GPIO27, buzzer GPIO22, as in the sandbox's Pi 5 wiring.
"""
import argparse
import os
import time

import numpy as np

from cdmodel import Model

FRAMES, BANDS, HOP = 40, 32, 0.025
STEPS, HZ = 40, 20
EDGES = [80 * (100 ** (i / BANDS)) for i in range(BANDS + 1)]


def spectrogram_row(samples, rate):
    w = np.hanning(len(samples))
    mag = np.abs(np.fft.rfft(samples * w)) / len(samples)
    db = 20 * np.log10(mag + 1e-9)
    bin_hz = rate / len(samples)
    row = np.empty(BANDS, np.float32)
    for b in range(BANDS):
        lo = max(1, int(np.floor(EDGES[b] / bin_hz)))
        hi = max(lo + 1, int(np.ceil(EDGES[b + 1] / bin_hz)))
        row[b] = db[lo:hi].mean()
    return np.clip((row + 100) / 70, 0, 1)


def mic_windows():
    import sounddevice as sd
    rate, hop = 16000, int(16000 * HOP)
    buf = np.zeros(512, np.float32)
    rows = []
    with sd.InputStream(samplerate=rate, channels=1, blocksize=hop, dtype="float32") as st:
        while True:
            data, _ = st.read(hop)
            buf = np.concatenate([buf[hop:], data[:, 0]])
            rows.append(spectrogram_row(buf, rate))
            if len(rows) >= FRAMES:
                yield np.stack(rows[-FRAMES:])[..., None]
                rows = rows[-FRAMES:][FRAMES // 2:]


def motion_windows():
    from smbus2 import SMBus
    bus = SMBus(1)
    bus.write_byte_data(0x68, 0x6B, 0)
    win = []
    while True:
        d = bus.read_i2c_block_data(0x68, 0x3B, 14)
        v = [int.from_bytes(bytes(d[i:i + 2]), "big", signed=True) for i in range(0, 14, 2)]
        win.append([v[0] / 16384, v[1] / 16384, v[2] / 16384, v[4] / 131 / 250, v[5] / 131 / 250, v[6] / 131 / 250])
        if len(win) >= STEPS:
            yield np.array(win[-STEPS:], np.float32)
            win = win[-STEPS // 2:]
        time.sleep(1 / HZ)


def camera_windows():
    import tensorflow as tf
    base = tf.keras.applications.MobileNetV2(input_shape=(224, 224, 3), alpha=0.35, include_top=False, weights="imagenet", pooling="avg")
    try:
        from picamera2 import Picamera2
        cam = Picamera2()
        cam.configure(cam.create_preview_configuration(main={"format": "RGB888", "size": (640, 480)}))
        cam.start()
        grab = lambda: cam.capture_array()[..., ::-1]  # BGR -> RGB
    except Exception:
        import cv2
        cap = cv2.VideoCapture(0)
        grab = lambda: cv2.cvtColor(cap.read()[1], cv2.COLOR_BGR2RGB)
    import cv2
    while True:
        img = grab()
        h, w = img.shape[:2]
        s = min(h, w)
        img = img[(h - s) // 2:(h + s) // 2, (w - s) // 2:(w + s) // 2]
        x = cv2.resize(img, (224, 224)).astype(np.float32) / 127.5 - 1
        yield base(x[None], training=False).numpy()[0]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "model.json"))
    ap.add_argument("--threshold", type=float, default=0.6)
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    m = Model(a.model)
    print(f"CircuitDeck ML: {m.sensor} model, classes {m.classes}, actions {m.actions}")
    outs = {}
    if not a.dry_run:
        from gpiozero import LED, Buzzer, OutputDevice
        outs = {"led": LED(17), "relay": OutputDevice(27), "buzzer": Buzzer(22)}
    src = {"camera": camera_windows, "mic": mic_windows, "motion": motion_windows}[m.sensor]()
    for x in src:
        p = m.predict(x)
        best = int(p.argmax())
        print(f"{m.classes[best]:<16} {p[best]:.2f}   " + "  ".join(f"{c}:{v:.2f}" for c, v in zip(m.classes, p)))
        if p[best] >= a.threshold:
            want = m.actions[best]
            for k, dev in outs.items():
                dev.on() if k == want else dev.off()


if __name__ == "__main__":
    main()
