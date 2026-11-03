#!/usr/bin/env python3
"""M10: check the Train panel's downloads. Usage: m10-verify.py OUTDIR SENSOR
- both zips are valid (CRC-checked) with the expected files
- model_data.h == model.cdm, CDM1 header/CRC good, layer list parses
- the Pi 5 numpy runtime (cdmodel.py from the zip) matches TF.js predictions
- the int8 blob, dequantised, predicts the same classes (mirrors cd_model.h)
"""
import io, json, re, struct, sys, zipfile, zlib, importlib.util, os, tempfile
import numpy as np

out, sensor = sys.argv[1], sys.argv[2]
cases = json.load(open(f"{out}/{sensor}-cases.json"))
def say(ok, msg): print(("ok   " if ok else "FAIL ") + msg)

ez = zipfile.ZipFile(f"{out}/{sensor}-esp32.zip"); pz = zipfile.ZipFile(f"{out}/{sensor}-pi.zip")
say(ez.testzip() is None and pz.testzip() is None, f"{sensor}: both zips open and every CRC matches")
en, pn = set(ez.namelist()), set(pz.namelist())
need_e = {f"circuitdeck_ml/{n}" for n in ["circuitdeck_ml.ino", "cd_model.h", "cd_features.h", "partitions.csv", "model_data.h", "model.cdm", "README.md"]}
need_p = {f"circuitdeck_ml_pi5/{n}" for n in ["cd_infer.py", "cdmodel.py", "requirements.txt", "model.json", "labels.txt", "README.md"]}
say(need_e <= en, f"ESP32 zip has the sketch, interpreter, partitions.csv, model_data.h ({len(en)} files)")
say(need_p <= pn, f"Pi 5 zip has cd_infer.py, cdmodel.py, model.json, labels.txt ({len(pn)} files)")

blob = ez.read("circuitdeck_ml/model.cdm"); hdr = ez.read("circuitdeck_ml/model_data.h").decode()
arr = bytes(int(h, 16) for h in re.findall(r"0x([0-9a-f]{2})", hdr.split("{", 1)[1].split("}", 1)[0]))
ln = int(re.search(r"cd_model_len = (\d+)", hdr).group(1))
say(arr == blob and ln == len(blob), f"model_data.h is the same {len(blob)}-byte blob as model.cdm")
magic, plen, crc = blob[:4], *struct.unpack("<II", blob[4:12])
payload = blob[12:]
say(magic == b"CDM1" and plen == len(payload) and crc == zlib.crc32(payload) & 0xFFFFFFFF, "CDM1 magic, length and CRC32 good")

# parse the blob like cd_model.h does
o = 0
def take(fmt):
    global o
    v = struct.unpack_from("<" + fmt, payload, o); o += struct.calcsize("<" + fmt); return v
ver, scode, ncls, rank = take("BBBB"); dims = take("HHH")
names = []
for _ in range(ncls):
    (n,) = take("B"); names.append(payload[o:o + n].decode()); o += n; take("B")
(nl,) = take("B")
qlayers = []
for _ in range(nl):
    t, a = take("BB"); p = take("HHHH"); (nw,) = take("I")
    if nw:
        (scale,) = take("f"); w = np.frombuffer(payload, np.int8, nw, o).astype(np.float32) * scale; o += nw
        (nb,) = take("I"); b = np.frombuffer(payload, "<f4", nb, o).copy(); o += 4 * nb
        qlayers.append((w, b))
say(o == len(payload) and names == cases["classes"] and scode == {"camera": 0, "mic": 1, "motion": 2}[sensor],
    f"blob parses exactly: {nl} layers, classes {names}, input {dims[:rank]}")

with tempfile.TemporaryDirectory() as d:
    pz.extractall(d); root = os.path.join(d, "circuitdeck_ml_pi5")
    spec = importlib.util.spec_from_file_location("cdmodel", os.path.join(root, "cdmodel.py")); cm = importlib.util.module_from_spec(spec); spec.loader.exec_module(cm)
    m = cm.Model(os.path.join(root, "model.json"))
    labels = open(os.path.join(root, "labels.txt")).read().split()
    tf = np.array(cases["probs"]); py = np.array([m.predict(x) for x in cases["inputs"]])
    err = float(np.abs(tf - py).max())
    say(err < 1e-4 and labels == cases["classes"], f"Pi 5 numpy runtime == TF.js (max |Δp| {err:.2e})")
    i = 0
    for l in m.layers:
        if "w" in l:
            w, b = qlayers[i]; l["w"] = w.reshape(l["w"].shape); l["b"] = b; i += 1
    q = np.array([m.predict(x) for x in cases["inputs"]])
    qe = float(np.abs(tf - q).max())
    say((q.argmax(1) == tf.argmax(1)).all() and qe < 0.1, f"int8 blob (dequantised) predicts the same classes (max |Δp| {qe:.3f})")

# The ESP32 C++ interpreter, compiled for the host (zig c++ if available; set CXX to override)
import shutil, subprocess
cxx = os.environ.get("CXX") or (shutil.which("c++") and "c++") or None
zig = os.environ.get("ZIG_PY")
cmd = [cxx] if cxx else ([zig, "-m", "ziglang", "c++"] if zig else None)
if not cmd:
    print("skip ESP32 C++ interpreter (no compiler; set CXX or ZIG_PY)")
else:
    here = os.path.dirname(os.path.abspath(__file__))
    with tempfile.TemporaryDirectory() as d:
        exe = os.path.join(d, "cd-host")
        repo = os.environ.get("CD_REPO") or os.path.dirname(here)
        subprocess.run(cmd + ["-O2", "-std=c++17", "-I", os.path.join(repo, "firmware/esp32/circuitdeck_ml"), "-o", exe, os.path.join(here, "cd-host.cpp")], check=True)
        xs = np.array(cases["inputs"], dtype=np.float32); xs.tofile(os.path.join(d, "in.f32"))
        open(os.path.join(d, "model.cdm"), "wb").write(blob)
        res = subprocess.run([exe, os.path.join(d, "model.cdm"), os.path.join(d, "in.f32"), str(len(xs))], capture_output=True, text=True)
        cp = np.array([[float(v) for v in ln.split()] for ln in res.stdout.split("\n") if ln and not ln.startswith("ERR")]) if res.returncode == 0 else None
        if cp is None or cp.shape != q.shape:
            say(False, f"ESP32 C++ interpreter ran ({res.stdout.strip()[:120]} {res.stderr.strip()[:120]})")
        else:
            ce = float(np.abs(cp - q).max())
            say(ce < 1e-4 and (cp.argmax(1) == tf.argmax(1)).all(), f"ESP32 C++ interpreter (compiled) == int8 numpy and same classes as TF.js (max |Δp| {ce:.2e})")
