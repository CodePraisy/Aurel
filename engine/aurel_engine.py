"""Aurel AI engine.

Commands
  status                       -> JSON with python/package/GPU availability
  prepare-model --model NAME    -> download and verify the separation model
  process --input WAV --out DIR [--model htdemucs_6s] [--device auto|cuda|cpu] [--drums] [--stems-dir DIR]

`process` writes stems/*.wav and analysis.json into --out and reports progress
as JSON lines on stdout: {"type": "progress", "stage", "pct", "message"}.
The final line is {"type": "result", "analysis": "analysis.json"}.
Each stage is a separate function so models can be swapped independently.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import traceback
from importlib import metadata

SR = 44100


def emit(kind: str, **kw) -> None:
    sys.stdout.write(json.dumps({"type": kind, **kw}) + "\n")
    sys.stdout.flush()


def progress(stage: str, pct: float, message: str = "") -> None:
    emit("progress", stage=stage, pct=round(max(0.0, min(1.0, pct)), 4), message=message)


def log(*a) -> None:
    print(*a, file=sys.stderr, flush=True)


# --------------------------------------------------------------------------- status
def cmd_status() -> None:
    pk = {}
    for name in ("torch", "torchaudio", "demucs", "basic-pitch", "librosa", "numpy", "scipy"):
        try:
            pk[name] = metadata.version(name)
        except metadata.PackageNotFoundError:
            pk[name] = None
    cuda, gpu, runtime_ok = False, None, False
    if pk["torch"] and pk["torchaudio"]:
        try:
            import torch
            import torchaudio

            runtime_ok = True
            cuda = bool(torch.cuda.is_available())
            gpu = torch.cuda.get_device_name(0) if cuda else None
        except Exception as e:  # noqa: BLE001
            log("AI audio runtime failed:", e)
    ready = runtime_ok and all(pk.values())
    emit_line = {"python": ".".join(map(str, sys.version_info[:3])), "packages": pk, "cuda": cuda, "gpu": gpu, "ready": ready}
    print(json.dumps(emit_line))


# --------------------------------------------------------------------------- audio io
def read_wav(path: str):
    import numpy as np
    from scipy.io import wavfile

    sr, data = wavfile.read(path)
    if data.dtype == np.int16:
        data = data.astype(np.float32) / 32768.0
    elif data.dtype == np.int32:
        data = data.astype(np.float32) / 2147483648.0
    else:
        data = data.astype(np.float32)
    if data.ndim == 1:
        data = np.stack([data, data], axis=1)
    return sr, data.T  # (channels, samples)


def write_wav(path: str, audio, sr: int = SR) -> None:
    import numpy as np
    from scipy.io import wavfile

    os.makedirs(os.path.dirname(path), exist_ok=True)
    a = np.clip(audio, -1.0, 1.0)
    wavfile.write(path, sr, (a.T * 32767.0).astype(np.int16))


def rms(x) -> float:
    import numpy as np

    return float(np.sqrt(np.mean(np.square(x)) + 1e-12))


# --------------------------------------------------------------------------- separation
def pick_device(pref: str) -> str:
    import torch

    if pref == "cpu":
        return "cpu"
    if torch.cuda.is_available():
        return "cuda"
    if pref == "cuda":
        log("CUDA requested but not available; falling back to CPU")
    return "cpu"


def separate(mix, model_name: str, device: str, p0: float, p1: float):
    """Demucs source separation. Returns {source_name: (2, n) array}."""
    import numpy as np
    import torch
    import demucs.apply as dapply
    from demucs.pretrained import get_model

    progress("Loading separation model", p0, f"{model_name} on {device.upper()}")
    model = get_model(model_name)
    model.eval()
    if getattr(model, "samplerate", SR) != SR:
        raise RuntimeError("Unexpected model sample rate")

    class _Bar:  # route demucs' tqdm progress into our JSON protocol
        def __init__(self, it, total=None, **_):
            self.it = list(it)
            self.total = len(self.it)

        def __iter__(self):
            for i, x in enumerate(self.it):
                progress("Separating instruments", p0 + (p1 - p0) * (i / max(1, self.total)), f"{device.upper()} · chunk {i + 1}/{self.total}")
                yield x

    class _Tqdm:
        tqdm = _Bar

    dapply.tqdm = _Tqdm  # type: ignore[attr-defined]
    wav = torch.from_numpy(mix)
    ref = wav.mean(0)
    mean, std = ref.mean(), ref.std() + 1e-8
    wav = (wav - mean) / std
    with torch.no_grad():
        out = dapply.apply_model(model, wav[None], device=device, shifts=1, split=True, overlap=0.25, progress=True, num_workers=0)[0]
    out = out * std + mean
    return {name: out[i].cpu().numpy().astype(np.float32) for i, name in enumerate(model.sources)}


def isolate_vocals(vocals, rest):
    """Keep only the singer(s) in the vocal stem.

    Separation leaves some of the band in the vocal stem (cymbals, guitar, reverb). Each
    time-frequency cell keeps the share of energy the vocals have against everything else,
    the rumble below the voice is cut, and passages where nobody sings are gated to silence.
    Input and output are (2, n) float arrays at SR.
    """
    import numpy as np
    from scipy.signal import stft, istft
    from scipy.ndimage import maximum_filter1d, median_filter, uniform_filter1d

    n = vocals.shape[1]
    nfft, hop = 4096, 1024
    _, _, V = stft(vocals, fs=SR, nperseg=nfft, noverlap=nfft - hop, boundary="zeros")
    _, _, R = stft(rest, fs=SR, nperseg=nfft, noverlap=nfft - hop, boundary="zeros")
    pv = np.abs(V) ** 2
    pr = np.abs(R) ** 2
    # soft mask from both channels, a little sharper than Wiener, smoothed so it does not "chirp"
    mask = (pv.sum(0) / (pv.sum(0) + pr.sum(0) + 1e-10)) ** 1.4
    mask = median_filter(mask, size=(1, 5))
    freqs = np.fft.rfftfreq(nfft, 1 / SR)
    mask *= np.clip((freqs[:, None] - 60) / 40, 0, 1)  # high-pass: nothing below ~80 Hz is voice
    V = V * mask[None]

    # gate: frames with no singing (quiet, or far below the band) go silent, with soft edges
    band = (freqs > 150) & (freqs < 5000)
    voice = (np.abs(V[:, band]) ** 2).sum((0, 1))
    other = pr[:, band].sum((0, 1))
    level = 10 * np.log10(voice + 1e-12)
    loud = level > (np.percentile(level, 99) - 42)
    present = 10 * np.log10((voice + 1e-12) / (other + 1e-12)) > -16
    gate = (loud & present).astype(np.float32)
    gate = maximum_filter1d(gate, size=9)  # hold ~0.2 s so word endings and breaths are kept
    gate = uniform_filter1d(gate, size=5)  # soft edges
    V = V * gate[None, None, :]
    _, out = istft(V, fs=SR, nperseg=nfft, noverlap=nfft - hop, boundary=True)
    out = out[:, :n]
    if out.shape[1] < n:
        out = np.pad(out, ((0, 0), (0, n - out.shape[1])))
    return out.astype(np.float32)


def load_stems_dir(d: str):
    stems = {}
    for f in sorted(os.listdir(d)):
        if f.lower().endswith(".wav"):
            _, a = read_wav(os.path.join(d, f))
            stems[os.path.splitext(f)[0]] = a
    return stems


# --------------------------------------------------------------------------- classification
def spectral_features(mono):
    import numpy as np
    import librosa

    y = mono[: SR * 90]  # first 90 s is plenty
    S = np.abs(librosa.stft(y, n_fft=2048, hop_length=1024)) + 1e-9
    flat = float(np.median(librosa.feature.spectral_flatness(S=S)))
    cent = float(np.median(librosa.feature.spectral_centroid(S=S, sr=SR)))
    frames = librosa.util.frame(y, frame_length=2048, hop_length=1024) if len(y) > 4096 else y[None, :]
    active = frames[:, np.sqrt(np.mean(frames**2, axis=0)) > 0.01] if frames.ndim == 2 else frames
    crest = float(np.median(np.max(np.abs(active), axis=0) / (np.sqrt(np.mean(active**2, axis=0)) + 1e-9))) if active.size else 0.0
    return {"flatness": flat, "centroid": cent, "crest": crest}


def classify(name: str, audio, mix_rms: float):
    """Heuristic classification. Returns (kind, confidence, traits). Users can correct it."""
    mono = audio.mean(0)
    level = rms(mono) / (mix_rms + 1e-9)
    traits = {"level": f"{level:.2f}"}
    if name in ("drums", "bass", "vocals"):
        return name, min(0.95, 0.6 + level), traits
    f = spectral_features(mono)
    traits.update({k: f"{v:.3f}" for k, v in f.items()})
    if name == "guitar":
        if f["crest"] < 3.2 and f["flatness"] > 0.004:
            return "distorted-guitar", 0.62, {**traits, "tone": "distorted"}
        if f["centroid"] > 2200 and f["crest"] > 5:
            return "acoustic-guitar", 0.5, {**traits, "tone": "acoustic (bright, percussive attack)"}
        return "clean-guitar", 0.5, {**traits, "tone": "clean electric"}
    if name == "piano":
        if f["crest"] < 3.0:
            return "organ", 0.4, {**traits, "note": "sustained envelope"}
        return "piano", 0.6, traits
    if name == "other":
        if f["flatness"] > 0.02 and f["centroid"] > 2500:
            return "synth", 0.35, traits
        if f["centroid"] < 1500 and f["crest"] < 3.5:
            return "strings", 0.3, traits
        return "other", 0.3, traits
    return "other", 0.3, traits


def stereo_split(audio):
    """Detect double-tracked/hard-panned parts (e.g. rhythm guitars L/R)."""
    import numpy as np

    l, r = audio[0], audio[1]
    el, er = rms(l), rms(r)
    if min(el, er) < 0.01 or max(el, er) / (min(el, er) + 1e-9) > 4:
        return None
    n = min(len(l), SR * 120)
    c = float(np.corrcoef(l[:n], r[:n])[0, 1])
    return c if c < 0.55 else None


# --------------------------------------------------------------------------- transcription
PITCH_RANGES = {
    "bass": (28, 400, 0.55, 0.3, 80),
    "vocals": (75, 1100, 0.6, 0.35, 90),
    "guitar": (75, 1400, 0.5, 0.3, 60),
    "piano": (27, 4200, 0.5, 0.3, 58),
    "other": (50, 3000, 0.55, 0.35, 70),
}


def transcribe(path: str, family: str):
    from basic_pitch import ICASSP_2022_MODEL_PATH
    from basic_pitch.inference import predict

    fmin, fmax, onset, frame, min_ms = PITCH_RANGES.get(family, PITCH_RANGES["other"])
    _, _, events = predict(
        path, ICASSP_2022_MODEL_PATH,
        onset_threshold=onset, frame_threshold=frame, minimum_note_length=min_ms,
        minimum_frequency=fmin, maximum_frequency=fmax, multiple_pitch_bends=False,
        melodia_trick=True,
    )
    return [{"s": round(float(s), 4), "e": round(float(e), 4), "p": int(p), "v": int(max(1, min(127, round(a * 127))))} for s, e, p, a, *_ in events]


def tempo_and_beats(mono):
    import numpy as np
    import librosa

    y = mono[: SR * 240]
    tempo, frames = librosa.beat.beat_track(y=y, sr=SR, hop_length=512, units="frames")
    tempo = float(np.atleast_1d(tempo)[0]) or 120.0
    while tempo < 70:
        tempo *= 2
    while tempo > 180:
        tempo /= 2
    beats = librosa.frames_to_time(frames, sr=SR, hop_length=512).tolist()
    meter, downbeat = estimate_meter(y, beats)
    if len(beats) > 8:  # refine tempo from median inter-beat interval
        ibi = float(np.median(np.diff(beats)))
        if ibi > 0:
            t2 = 60.0 / ibi
            while t2 < 70:
                t2 *= 2
            while t2 > 180:
                t2 /= 2
            tempo = t2
    return tempo, beats, meter, downbeat


def estimate_meter(y, beats):
    """Pick 3 or 4 beats per bar and the first downbeat from low-frequency accent patterns."""
    import numpy as np
    import librosa

    if len(beats) < 8:
        return 4, beats[0] if beats else 0.0
    low = librosa.onset.onset_strength(y=y, sr=SR, hop_length=512, fmax=200)
    hi = librosa.onset.onset_strength(y=y, sr=SR, hop_length=512)
    frames = librosa.time_to_frames(beats, sr=SR, hop_length=512)
    acc = np.array([float(low[min(len(low) - 1, f)]) + 0.4 * float(hi[min(len(hi) - 1, f)]) for f in frames])
    best = (4, 0, -1e9)
    for m in (4, 3):
        for p in range(m):
            on = acc[p::m].mean()
            off = np.delete(acc, np.arange(p, len(acc), m)).mean() if len(acc) > m else 0.0
            c = on - off
            if m == 3:
                c *= 0.8  # need clear evidence to prefer triple meter
            if c > best[2]:
                best = (m, p, c)
    m, p, _ = best
    return m, beats[p]


def transcribe_drums(audio, out_dir: str | None):
    """Band-based drum hit detection: kick / snare / hi-hat / crash. Approximate."""
    import numpy as np
    import librosa
    from scipy.signal import butter, sosfiltfilt

    mono = audio.mean(0)
    hop = 256
    sos = {
        "kick": butter(4, [30, 140], btype="bandpass", fs=SR, output="sos"),
        "snare": butter(4, [180, 3500], btype="bandpass", fs=SR, output="sos"),
        "hh": butter(4, 7000, btype="highpass", fs=SR, output="sos"),
    }
    filtered = {k: sosfiltfilt(v, mono).astype(np.float32) for k, v in sos.items()}
    win = int(SR * 0.03)

    def band_rms(name: str, a: int) -> float:
        return float(np.sqrt(np.mean(filtered[name][a : a + win] ** 2)) + 1e-9)

    # a hit counts for a band only if that band dominates its neighbours right at the onset
    rivals = {"kick": ("snare", 0.5), "snare": ("hh", 0.8), "hh": (None, 0.0)}
    hits = []
    for piece, y in filtered.items():
        env = librosa.onset.onset_strength(y=y, sr=SR, hop_length=hop)
        if env.max() <= 0:
            continue
        env = env / env.max()
        delta = {"kick": 0.12, "snare": 0.14, "hh": 0.08}[piece]
        on = librosa.onset.onset_detect(onset_envelope=env, sr=SR, hop_length=hop, backtrack=False, delta=delta, wait=4, units="frames")
        rival, ratio = rivals[piece]
        for f in on:
            t = float(librosa.frames_to_time(f, sr=SR, hop_length=hop))
            a = int(SR * t)
            seg = y[a : a + int(SR * 0.6)]
            if seg.size < 64:
                continue
            if rival and band_rms(piece, a) < ratio * band_rms(rival, a):
                continue
            peak = float(np.max(np.abs(seg[: int(SR * 0.05)])) + 1e-9)
            tail = float(np.sqrt(np.mean(seg[int(SR * 0.3) :] ** 2))) if seg.size > SR * 0.35 else 0.0
            name = piece
            if piece == "hh" and tail / peak > 0.18:
                name = "crash" if peak > 0.15 else "hhOpen"
            hits.append({"t": round(t, 4), "piece": name, "v": int(min(127, 50 + 77 * float(env[f])))})
    if out_dir:
        for piece, y in filtered.items():
            write_wav(os.path.join(out_dir, f"drums_{piece}.wav"), np.stack([y, y]))
    hits.sort(key=lambda h: h["t"])
    return hits


# --------------------------------------------------------------------------- pipeline
def cmd_process(a) -> None:
    import numpy as np

    t0 = time.time()
    progress("Reading audio", 0.01)
    sr, mix = read_wav(a.input)
    if sr != SR:
        raise RuntimeError(f"Expected {SR} Hz input, got {sr}")
    mix_rms = rms(mix)
    device = "cpu"
    if a.stems_dir:
        stems = load_stems_dir(a.stems_dir)
    else:
        device = pick_device(a.device)
        stems = separate(mix, a.model, device, 0.03, 0.6)

    stem_dir = os.path.join(a.out, "stems")
    os.makedirs(stem_dir, exist_ok=True)
    progress("Analysing tempo", 0.61)
    beat_src = stems.get("drums") if "drums" in stems and rms(stems["drums"]) > 0.01 else mix
    tempo, beats, meter, downbeat = tempo_and_beats(beat_src.mean(0))
    analysis = {"tempo": round(tempo), "beatOffset": beats[0] if beats else 0.0, "downbeat": round(downbeat, 4), "timeSig": {"num": meter, "den": 4}, "beats": [round(b, 4) for b in beats], "device": device, "stems": [], "notes": {}}

    names = [n for n in stems if rms(stems[n]) / (mix_rms + 1e-9) > 0.04]
    skipped = [n for n in stems if n not in names]
    if skipped:
        log("Skipping near-silent stems:", ", ".join(skipped))
    if a.sources:
        names = [name for name in names if name in a.sources]
        if not names:
            raise RuntimeError("The selected instrument groups did not produce audible stems.")
    jobs = []  # (stem name, file, family, audio)
    for name in names:
        audio = stems[name]
        if name == "vocals" and len(stems) > 1:
            progress("Isolating vocals", 0.615, "removing the band from the voice")
            try:
                rest = sum(stems[k] for k in stems if k != "vocals")
                audio = isolate_vocals(audio, rest)
            except Exception as e:  # keep the plain separated stem rather than fail the job
                log("Vocal clean-up skipped:", e)
        if name == "guitar":
            c = stereo_split(audio)
            if c is not None:
                for side, ch in (("L", 0), ("R", 1)):
                    mono = np.stack([audio[ch], audio[ch]])
                    f = f"stems/guitar_{side}.wav"
                    write_wav(os.path.join(a.out, f), mono)
                    jobs.append((f"guitar_{side}", f, "guitar", mono, {"panning": f"hard {side}", "L/R correlation": f"{c:.2f}"}))
                continue
        f = f"stems/{name}.wav"
        write_wav(os.path.join(a.out, f), audio)
        jobs.append((name, f, name, audio, {}))

    n = max(1, len(jobs))
    for i, (name, f, family, audio, extra) in enumerate(jobs):
        base = 0.62 + 0.35 * (i / n)
        kind, conf, traits = classify(family, audio, mix_rms)
        traits.update(extra)
        analysis["stems"].append({"name": name, "file": f, "kind": kind, "confidence": round(conf, 2), "traits": traits})
        if family == "drums":
            progress("Transcribing drums", base, "kick · snare · hi-hat · cymbals")
            analysis["drums"] = transcribe_drums(audio, stem_dir if a.drums else None)
        else:
            progress("Transcribing " + name.replace("_", " "), base, "audio → MIDI")
            analysis["notes"][name] = transcribe(os.path.join(a.out, f), family)

    progress("Writing results", 0.99)
    with open(os.path.join(a.out, "analysis.json"), "w", encoding="utf-8") as fh:
        json.dump(analysis, fh)
    log(f"Finished in {time.time() - t0:.1f}s on {device}")
    emit("result", analysis="analysis.json")


def main() -> None:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("status")
    prepare = sub.add_parser("prepare-model")
    prepare.add_argument("--model", default="htdemucs_6s")
    p = sub.add_parser("process")
    p.add_argument("--input", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--model", default="htdemucs_6s")
    p.add_argument("--device", default="auto")
    p.add_argument("--drums", action="store_true")
    p.add_argument("--sources", nargs="+", choices=["vocals", "drums", "bass", "guitar", "piano", "other"])
    p.add_argument("--stems-dir", default=None, help="use pre-separated stems instead of running Demucs")
    a = ap.parse_args()
    try:
        if a.cmd == "status":
            cmd_status()
        elif a.cmd == "prepare-model":
            from demucs.pretrained import get_model

            get_model(a.model)
        else:
            cmd_process(a)
    except Exception as e:  # noqa: BLE001
        log(traceback.format_exc())
        emit("error", message=str(e))
        sys.exit(1)


if __name__ == "__main__":
    main()
