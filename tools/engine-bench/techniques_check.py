"""Sanity check for technique detection: synthetic guitar-like tones with a plain note, a full
bend, vibrato and a slide. Run with the engine's Python: python tools/engine-bench/techniques_check.py"""
import os
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "engine"))
import aurel_engine as ae  # noqa: E402

SR = ae.SR


def tone(f_curve):
    ph = 2 * np.pi * np.cumsum(f_curve) / SR
    x = sum(np.sin(k * ph) / k for k in range(1, 8))
    env = np.minimum(1, np.arange(len(x)) / 200) * np.exp(-np.arange(len(x)) / SR * 1.2)
    return (x * env * 0.3).astype(np.float32)


segs, notes, t = [], [], 0.0


def add(curve, p, v=90):
    global t
    segs.append(tone(curve))
    notes.append({"s": t + 0.005, "e": t + len(curve) / SR - 0.01, "p": p, "v": v})
    t += len(curve) / SR


n = int(0.6 * SR)
tt = np.arange(n) / SR
add(np.full(n, 440.0), 69)
add(440 * 2 ** (np.clip((tt - 0.12) / 0.15, 0, 1) * 2 / 12), 69)
add(440 * 2 ** (0.4 * np.sin(2 * np.pi * 6 * tt) / 12), 69)
add(np.full(n, 392.0), 67)
k = int(0.45 * SR)
add(np.concatenate([np.full(int(0.3 * SR), 392.0), 392 * 2 ** (np.linspace(0, 4, k - int(0.3 * SR)) / 12)]), 67)
add(np.full(n, 493.9), 71)
ae.detect_techniques(notes, np.concatenate(segs), "cpu")
got = [n.get("tech") for n in notes]
want = [None, ["bend"], ["vibrato"], None, ["slide"], None]
print(got)
assert got == want, f"expected {want}"
print("ok")
