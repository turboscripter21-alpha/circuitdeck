# CircuitDeck ML on the Raspberry Pi 5

1. Copy this folder to the Pi. The zip from the Train panel includes your `model.json` and `labels.txt`.
2. Set up and run:

```
python3 -m venv --system-site-packages ~/cdml && source ~/cdml/bin/activate
pip install -r requirements.txt          # camera models: also pip install tensorflow opencv-python
python3 cd_infer.py                      # add --dry-run to skip the GPIO
```

Wiring (same as the sandbox's Pi 5 board): LED on GPIO17 through 330 Ω, relay IN on GPIO27, buzzer on GPIO22.
The mic is a USB mic. Motion uses an MPU-6050 on I2C-1, which you enable with `sudo raspi-config` → Interface → I2C.

`cdmodel.py` is a numpy implementation of the exported layers, so the Pi runs exactly the weights the browser trained. Camera models get their MobileNetV2 (alpha 0.35, ImageNet) features from Keras, with the same weights the browser used.
