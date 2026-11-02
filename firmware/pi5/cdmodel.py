"""CircuitDeck model runtime for Python/numpy.

Loads the model.json exported by the Train panel (format "circuitdeck-model", float32
weights in base64) and runs the same layers as TensorFlow.js: Dense, Conv1D, Conv2D
(valid padding), MaxPooling1D/2D and Flatten, with linear, relu or softmax activations.
"""
import base64
import json

import numpy as np


def _f32(s, shape=None):
    a = np.frombuffer(base64.b64decode(s), dtype="<f4")
    return a.reshape(shape) if shape else a


class Model:
    def __init__(self, path):
        with open(path) as f:
            m = json.load(f)
        if m.get("format") != "circuitdeck-model":
            raise ValueError("not a CircuitDeck model.json")
        self.sensor = m["sensor"]
        self.classes = m["classes"]
        self.actions = m.get("actions") or ["none"] * len(self.classes)
        self.input_shape = tuple(m["input"])
        self.layers = []
        for l in m["layers"]:
            l = dict(l)
            if "w" in l:
                l["w"] = _f32(l["w"], l["wShape"])
                l["b"] = _f32(l["b"])
            self.layers.append(l)

    @staticmethod
    def _act(x, a):
        if a == "relu":
            return np.maximum(x, 0)
        if a == "softmax":
            e = np.exp(x - x.max())
            return e / e.sum()
        return x

    def predict(self, x):
        x = np.asarray(x, dtype=np.float32).reshape(self.input_shape)
        for l in self.layers:
            t = l["type"]
            if t == "Dense":
                x = x.reshape(-1) @ l["w"] + l["b"]
            elif t == "Conv1D":  # x [T, C], w [k, C, F]
                k, s = l["kernel"], l["stride"]
                n = (x.shape[0] - k) // s + 1
                win = np.stack([x[i * s:i * s + k] for i in range(n)])        # [n, k, C]
                x = np.tensordot(win, l["w"], axes=([1, 2], [0, 1])) + l["b"]
            elif t == "Conv2D":  # x [H, W, C], w [kh, kw, C, F]
                kh, kw = l["kernel"]
                s = l["stride"][0]
                oh, ow = (x.shape[0] - kh) // s + 1, (x.shape[1] - kw) // s + 1
                out = np.empty((oh, ow, l["w"].shape[3]), np.float32)
                for i in range(oh):
                    row = np.stack([x[i * s:i * s + kh, j * s:j * s + kw] for j in range(ow)])  # [ow, kh, kw, C]
                    out[i] = np.tensordot(row, l["w"], axes=([1, 2, 3], [0, 1, 2]))
                x = out + l["b"]
            elif t == "MaxPooling1D":
                p, s = l["pool"], l["stride"]
                n = (x.shape[0] - p) // s + 1
                x = np.stack([x[i * s:i * s + p].max(0) for i in range(n)])
            elif t == "MaxPooling2D":
                (ph, pw), (sh, sw) = l["pool"], l["stride"]
                oh, ow = (x.shape[0] - ph) // sh + 1, (x.shape[1] - pw) // sw + 1
                x = np.stack([np.stack([x[i * sh:i * sh + ph, j * sw:j * sw + pw].max((0, 1)) for j in range(ow)]) for i in range(oh)])
            elif t == "Flatten":
                x = x.reshape(-1)
            x = self._act(x, l.get("act", "linear"))
        return x.reshape(-1)
