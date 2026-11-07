"""Simulate separation artefacts: each stem gets some of the other instruments and a little room."""
import os, sys, numpy as np, soundfile as sf
from scipy.signal import fftconvolve
rng = np.random.default_rng(0)
def room(sr, t60=0.5):
    n = int(sr * t60); env = np.exp(-6.9 * np.arange(n) / n)
    ir = rng.standard_normal(n) * env; ir[0] = 0; ir /= np.abs(ir).sum() / 3
    return ir
for d in sorted(os.listdir(sys.argv[1])):
    p = os.path.join(sys.argv[1], d)
    stems = {}
    for k in ("guitar", "bass", "piano", "vocals", "drums"):
        f = os.path.join(p, k + ".wav")
        if os.path.exists(f): stems[k], sr = sf.read(f, dtype="float32")
    ir = room(sr)
    os.makedirs(os.path.join(p, "dirty"), exist_ok=True)
    for k, a in stems.items():
        others = sum(v for j, v in stems.items() if j != k)
        leak = 0.22 if k in ("guitar", "piano") else 0.12
        wet = np.stack([fftconvolve(a[:, c], ir)[: len(a)] for c in range(2)], 1) * 0.25
        out = a + wet + leak * others + 0.002 * rng.standard_normal(a.shape).astype(np.float32)
        sf.write(os.path.join(p, "dirty", k + ".wav"), out / max(1, np.abs(out).max()), sr, subtype="PCM_16")
    nod = sum(v for j, v in stems.items() if j != "drums")
    sf.write(os.path.join(p, "nodrums.wav"), nod / max(1e-9, np.abs(nod).max()) * 0.9, sr, subtype="PCM_16")
    print(d)
