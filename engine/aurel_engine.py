"""Aurel AI engine.

Commands
  status                         -> JSON with python/package/GPU availability and which models are installed
  prepare-model --model NAME      -> download and verify the separation model
  prepare-beats --dir DIR         -> download the beat and downbeat model (Beat This!)
  prepare-words --models-dir DIR  -> download the Whisper model for the singer's words
  process --input WAV --out DIR [options]

`process` writes stems/*.wav and analysis.json into --out and reports progress
as JSON lines on stdout: {"type": "progress", "stage", "pct", "message"}.
The final line is {"type": "result", "analysis": "analysis.json"}.

How a song is transcribed (each step can be swapped independently):
  1. Demucs splits the recording into instruments.
  2. Beat This! finds every beat and downbeat in the full mix. Notes are placed on that beat
     grid, so the score keeps time with a band that speeds up or slows down.
  3. Each instrument gets the model that suits it:
       piano and keys    Transkun (transformer + semi-CRF, piano-trained)
       guitar            Transkun or Basic Pitch, then strum and overtone clean-up
       bass, singing     CREPE pitch tracking, cut into notes at pitch changes and fresh attacks
       drums             ADTOF (kick, snare, toms, hi-hat, cymbals)
       anything else     Basic Pitch
     Missing optional models fall back to Basic Pitch / band filtering, so older installs keep working.
  4. Words are recognised with Whisper and moved onto the sung notes they belong to.
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
ENGINE_VERSION = 2

# Quality presets: how hard separation works, and which models are used.
QUALITY = {
    "fast": {"shifts": 0, "overlap": 0.1, "beats": "small", "poly": "basic-pitch"},
    "balanced": {"shifts": 1, "overlap": 0.25, "beats": "full", "poly": "transkun"},
    "best": {"shifts": 2, "overlap": 0.5, "beats": "full", "poly": "transkun"},
}

CORE = ("torch", "torchaudio", "demucs", "basic-pitch", "librosa", "numpy", "scipy", "openai-whisper")
OPTIONAL = ("transkun", "onnxruntime", "torchcrepe", "adtof-pytorch")


def emit(kind: str, **kw) -> None:
    sys.stdout.write(json.dumps({"type": kind, **kw}) + "\n")
    sys.stdout.flush()


def progress(stage: str, pct: float, message: str = "") -> None:
    emit("progress", stage=stage, pct=round(max(0.0, min(1.0, pct)), 4), message=message)


def log(*a) -> None:
    print(*a, file=sys.stderr, flush=True)


def have(module: str) -> bool:
    import importlib.util

    return importlib.util.find_spec(module) is not None


# --------------------------------------------------------------------------- status
def cmd_status() -> None:
    pk = {}
    for name in CORE + OPTIONAL:
        try:
            pk[name] = metadata.version(name)
        except metadata.PackageNotFoundError:
            pk[name] = None
    cuda, gpu, runtime_ok = False, None, False
    if pk["torch"] and pk["torchaudio"]:
        try:
            import torch
            import torchaudio  # noqa: F401

            runtime_ok = True
            cuda = bool(torch.cuda.is_available())
            gpu = torch.cuda.get_device_name(0) if cuda else None
        except Exception as e:  # noqa: BLE001
            log("AI audio runtime failed:", e)
    ready = runtime_ok and all(pk[name] for name in CORE)
    upgraded = all(pk[name] for name in OPTIONAL)
    print(json.dumps({
        "python": ".".join(map(str, sys.version_info[:3])), "packages": pk, "cuda": cuda, "gpu": gpu,
        "ready": ready, "engineVersion": ENGINE_VERSION, "upgraded": upgraded,
    }))


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


def separate(mix, model_name: str, device: str, p0: float, p1: float, shifts: int = 1, overlap: float = 0.25):
    """Demucs source separation. Returns {source_name: (2, n) array}.

    `shifts` averages several time-shifted passes (fewer artefacts, slower); `overlap` blends
    neighbouring chunks so there are no seams.
    """
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
                progress("Separating instruments", p0 + (p1 - p0) * (i / max(1, self.total)), f"{device.upper()} · part {i + 1} of {self.total}")
                yield x

    class _Tqdm:
        tqdm = _Bar

    dapply.tqdm = _Tqdm  # type: ignore[attr-defined]
    wav = torch.from_numpy(mix)
    ref = wav.mean(0)
    mean, std = ref.mean(), ref.std() + 1e-8
    wav = (wav - mean) / std
    with torch.no_grad():
        out = dapply.apply_model(model, wav[None], device=device, shifts=shifts, split=True, overlap=overlap, progress=True, num_workers=0)[0]
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
    mask = (pv.sum(0) / (pv.sum(0) + pr.sum(0) + 1e-10)) ** 1.4
    mask = median_filter(mask, size=(1, 5))
    freqs = np.fft.rfftfreq(nfft, 1 / SR)
    mask *= np.clip((freqs[:, None] - 60) / 40, 0, 1)
    V = V * mask[None]
    band = (freqs > 150) & (freqs < 5000)
    voice = (np.abs(V[:, band]) ** 2).sum((0, 1))
    other = pr[:, band].sum((0, 1))
    level = 10 * np.log10(voice + 1e-12)
    loud = level > (np.percentile(level, 99) - 42)
    present = 10 * np.log10((voice + 1e-12) / (other + 1e-12)) > -16
    gate = (loud & present).astype(np.float32)
    gate = maximum_filter1d(gate, size=9)
    gate = uniform_filter1d(gate, size=5)
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

    y = mono[: SR * 90]
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


# --------------------------------------------------------------------------- beats and bars
_beat_sessions: dict = {}


def beat_activations(mono, model_path: str):
    """Beat This! (ISMIR 2024) frame-wise beat and downbeat logits at 50 fps, via ONNX Runtime."""
    import numpy as np
    import librosa
    import torch
    import torchaudio
    import onnxruntime as ort

    if model_path not in _beat_sessions:
        so = ort.SessionOptions()
        so.intra_op_num_threads = max(1, (os.cpu_count() or 2))
        _beat_sessions[model_path] = ort.InferenceSession(model_path, so, providers=["CPUExecutionProvider"])
    sess = _beat_sessions[model_path]
    y = librosa.resample(mono.astype(np.float32), orig_sr=SR, target_sr=22050)
    mel = torchaudio.transforms.MelSpectrogram(sample_rate=22050, n_fft=1024, hop_length=441, f_min=30, f_max=11000, n_mels=128,
                                               mel_scale="slaney", normalized="frame_length", power=1)
    with torch.no_grad():
        spect = torch.log1p(1000 * mel(torch.from_numpy(y)).T).numpy()
    n, chunk, border = len(spect), 1500, 6
    beat = np.full(n, -1000.0, np.float32)
    down = np.full(n, -1000.0, np.float32)
    done = np.zeros(n, bool)
    starts = np.arange(-border, n - border, chunk - 2 * border)
    if n > chunk - 2 * border:
        starts[-1] = n - (chunk - border)
    for st in starts:
        a, b = max(st, 0), min(st + chunk, n)
        left = max(0, -st)
        x = np.pad(spect[a:b], ((left, max(0, min(border, st + chunk - n))), (0, 0)))
        bo, do = sess.run(None, {"spectrogram": x[None].astype(np.float32)})
        lo = a if st <= -border else a + border
        hi = b if b >= n else b - border
        for i in range(lo, hi):  # the first chunk that covers a frame wins
            if not done[i]:
                beat[i], down[i], done[i] = bo[0][i - a + left], do[0][i - a + left], True
    return beat, down


def logit_peaks(logit, fps: int = 50):
    import numpy as np
    from scipy.ndimage import maximum_filter1d

    mx = maximum_filter1d(logit, 7, mode="constant", cval=-1000)
    idx = np.nonzero((logit == mx) & (logit > 0))[0]
    out: list[float] = []
    for i in idx:
        # sub-frame position from a parabola through the peak and its neighbours (frames are 20 ms)
        x = float(i)
        if 0 < i < len(logit) - 1:
            a, b, c = float(logit[i - 1]), float(logit[i]), float(logit[i + 1])
            den = a - 2 * b + c
            if den < 0:
                x += max(-0.5, min(0.5, 0.5 * (a - c) / den))
        if out and x - out[-1] <= 1.5:
            out[-1] = (out[-1] + x) / 2
        else:
            out.append(x)
    return np.array(out) / fps


def librosa_beats(mono):
    """Fallback when the beat model is not installed: one tempo, onset-based phase."""
    import numpy as np
    import librosa

    y = mono[: SR * 600]
    tempo, frames = librosa.beat.beat_track(y=y, sr=SR, hop_length=512, units="frames")
    beats = librosa.frames_to_time(frames, sr=SR, hop_length=512)
    return np.asarray(beats), np.array([])


def regular_beats(beats):
    """Remove doubled beats and fill dropped ones, so every bar has the same number of beats."""
    import numpy as np

    beats = np.asarray(sorted(beats), dtype=float)
    if len(beats) < 3:
        return beats
    med = float(np.median(np.diff(beats)))
    out = [beats[0]]
    for b in beats[1:]:
        gap = b - out[-1]
        if gap < 0.55 * med:
            continue
        k = int(round(gap / med))
        if k >= 2 and abs(gap / k - med) < 0.3 * med:
            step = gap / k
            out.extend(out[-1] + step * j for j in range(1, k))
        out.append(b)
    return np.array(out)


def build_grid(beats, downs, down_logit, first_event: float, last_event: float):
    """Beat grid that starts on a downbeat before the first note and ends after the last.

    Returns {"times": [...beat times...], "meter": beats per bar, "bpm": median tempo}. Beat 0 is
    the downbeat that becomes the score's first bar line. Beats before the music starts are
    extrapolated, so pickup notes land in a partial first bar instead of being dropped.
    """
    import numpy as np

    beats = regular_beats(beats)
    if len(beats) < 4:
        return None
    ibi = np.diff(beats)
    med = float(np.median(ibi))
    # meter: the most common number of beats between detected downbeats
    meter = 4
    if len(downs) >= 3:
        idx = sorted({int(np.argmin(np.abs(beats - d))) for d in downs})
        counts = [b - a for a, b in zip(idx, idx[1:]) if 2 <= b - a <= 7]
        if counts:
            vals, freq = np.unique(counts, return_counts=True)
            meter = int(vals[np.argmax(freq)])
    if meter not in (2, 3, 4, 6):
        meter = 4
    # phase: the beat position that most often carries a downbeat (one consistent bar line)
    if down_logit is not None and len(down_logit):
        frames = np.clip(np.round(beats * 50).astype(int), 0, len(down_logit) - 1)
        strength = 1 / (1 + np.exp(-down_logit[frames]))
        phase = int(np.argmax([strength[p::meter].mean() for p in range(meter)]))
    elif len(downs):
        phase = int(np.argmin(np.abs(beats - downs[0]))) % meter
    else:
        phase = 0
    times = list(beats[phase:])
    # extend backwards bar by bar until the first note is inside the first bar
    head = list(beats[:phase])
    step0 = float(np.median(ibi[: min(8, len(ibi))]))
    while True:
        while len(head) % meter:
            head.insert(0, (head[0] if head else times[0]) - step0)
        if (head[0] if head else times[0]) <= first_event + 0.03:
            break
        head = [(head[0] if head else times[0]) - step0 * (j + 1) for j in range(meter)][::-1] + head
    times = head + times
    # extend forwards past the last note, to a whole bar
    step1 = float(np.median(ibi[-min(8, len(ibi)):]))
    while times[-1] < last_event + step1 or len(times) % meter != 1:
        times.append(times[-1] + step1)
    k = np.arange(len(beats))
    slope = float(np.polyfit(k, beats, 1)[0]) if len(beats) > 2 else med  # average beat length
    return {"times": [round(float(t), 5) for t in times], "meter": meter, "bpm": round(60.0 / slope, 2)}


def to_beats(t: float, times) -> float:
    """Seconds -> beats since the first bar line, along the (possibly drifting) beat grid."""
    import bisect

    if t <= times[0]:
        return (t - times[0]) / (times[1] - times[0])
    if t >= times[-1]:
        return len(times) - 1 + (t - times[-1]) / (times[-1] - times[-2])
    i = bisect.bisect_right(times, t) - 1
    return i + (t - times[i]) / (times[i + 1] - times[i])


def feel(onsets_in_beats):
    """How notes divide the beat: 'binary' (8ths/16ths), 'ternary' (triplets / compound time) and the
    swing ratio (where the off-beat 8th falls, 0.5 = straight)."""
    import numpy as np

    f = np.asarray([b % 1 for b in onsets_in_beats])
    if len(f) < 16:
        return "binary", 0.5
    near = lambda c, w=0.045: float(np.mean(np.abs(((f - c + 0.5) % 1) - 0.5) < w))  # noqa: E731
    binary = near(0.25) + near(0.5) + near(0.75)
    ternary = near(1 / 3) + near(2 / 3)
    swung = f[(f > 0.55) & (f < 0.75)]
    swing = float(np.median(swung)) if len(swung) > max(8, 0.15 * len(f)) and near(0.5) < 0.05 else 0.5
    if ternary > 1.4 * binary and ternary > 0.25:
        return "ternary", swing
    return "binary", swing


# --------------------------------------------------------------------------- notes: polyphonic
PITCH_RANGES = {
    "bass": (28, 400, 0.55, 0.3, 80),
    "vocals": (75, 1100, 0.6, 0.35, 90),
    "guitar": (75, 1400, 0.5, 0.3, 60),
    "piano": (27, 4200, 0.5, 0.3, 58),
    "other": (50, 3000, 0.55, 0.35, 70),
}
MIDI_RANGE = {"guitar": (38, 90), "bass": (26, 67), "piano": (21, 108), "other": (28, 100), "vocals": (40, 84)}


def poly_basic_pitch(path: str, family: str, sens: float):
    """Spotify Basic Pitch (any instrument). `sens` 0..1 trades missed notes for extra ones."""
    from basic_pitch import ICASSP_2022_MODEL_PATH
    from basic_pitch.inference import predict

    fmin, fmax, onset, frame, min_ms = PITCH_RANGES.get(family, PITCH_RANGES["other"])
    shift = (0.5 - sens) * 0.3
    _, _, events = predict(
        path, ICASSP_2022_MODEL_PATH,
        onset_threshold=min(0.85, max(0.25, onset + shift)), frame_threshold=min(0.6, max(0.15, frame + shift * 0.6)),
        minimum_note_length=min_ms, minimum_frequency=fmin, maximum_frequency=fmax, multiple_pitch_bends=False,
        melodia_trick=True,
    )
    return [{"s": float(s), "e": float(e), "p": int(p), "v": int(max(1, min(127, round(a * 127))))} for s, e, p, a, *_ in events]


_transkun = None


def poly_transkun(audio, device: str):
    """Transkun 2 (Yan & Duan, ISMIR 2024): transformer scores + semi-CRF decoding of note intervals."""
    global _transkun
    import numpy as np
    import torch
    import librosa
    import moduleconf
    import transkun

    if _transkun is None:
        base = os.path.join(os.path.dirname(transkun.__file__), "pretrained")
        conf = moduleconf.parseFromFile(os.path.join(base, "2.0.conf"))
        model = conf["Model"].module.TransKun(conf=conf["Model"].config)
        ck = torch.load(os.path.join(base, "2.0.pt"), map_location="cpu")
        model.load_state_dict(ck.get("best_state_dict", ck.get("state_dict")), strict=False)
        _transkun = model.eval()
    model = _transkun.to(device)
    x = audio.T if audio.shape[0] == 2 else np.stack([audio, audio], 1)
    if model.fs != SR:
        x = librosa.resample(np.ascontiguousarray(x.T), orig_sr=SR, target_sr=model.fs).T
    with torch.no_grad():
        notes = model.transcribe(torch.from_numpy(np.ascontiguousarray(x, dtype=np.float32)).to(device), discardSecondHalf=False)
    return [{"s": float(n.start), "e": float(n.end), "p": int(n.pitch), "v": int(n.velocity)} for n in notes if 0 < n.pitch < 128]


def clean_poly(notes, family: str, sens: float, max_poly: int, rules=("range", "blips", "ghosts", "strums")):
    """Take out what a listener would not call a note: overtones, bleed and blips.

    - range: notes outside what the instrument can play
    - blips: very short and quiet notes
    - bleed/ghosts: much quieter than what plays around them
    - overtones (off by default: on our tests it removed more real notes than false ones)
    - strums: notes of one strummed chord start a few ms apart; they get one start time
    - polyphony: at most `max_poly` notes start together (the loudest are kept)
    """
    import numpy as np

    if not notes:
        return notes
    lo, hi = MIDI_RANGE.get(family, (21, 108)) if "range" in rules else (0, 127)
    notes = [dict(n) for n in notes if lo <= n["p"] <= hi]
    strict = 0.5 + (0.5 - sens)  # 0..1, higher removes more
    min_len = 0.045 + 0.04 * strict
    if "blips" in rules:
        notes = [n for n in notes if n["e"] - n["s"] >= min_len or n["v"] > 70]
    if not notes:
        return notes
    notes.sort(key=lambda n: n["s"])
    starts = np.array([n["s"] for n in notes])
    vel = np.array([n["v"] for n in notes], dtype=float)
    keep = np.ones(len(notes), bool)
    # ghosts: quieter than the loudest note starting within ±120 ms by more than a margin
    margin = 34 - 14 * strict
    for i, n in enumerate(notes):
        if "ghosts" not in rules:
            break
        a, b = np.searchsorted(starts, [n["s"] - 0.12, n["s"] + 0.12])
        if vel[i] < vel[a:b].max() - margin:
            keep[i] = False
    # overtones of a simultaneous louder note
    for i, n in enumerate(notes):
        if not keep[i] or "overtones" not in rules:
            continue
        a, b = np.searchsorted(starts, [n["s"] - 0.05, n["s"] + 0.05])
        for j in range(a, b):
            if j != i and keep[j] and (n["p"] - notes[j]["p"]) in (12, 19, 24, 28) and vel[i] < vel[j] - 6 * strict:
                keep[i] = False
                break
    notes = [n for n, k in zip(notes, keep) if k]
    # strums and arpeggiated chords: chain onsets closer than 35 ms (whole spread up to 110 ms)
    clusters: list[list[dict]] = []
    for n in notes:
        if "strums" in rules and clusters and n["s"] - clusters[-1][-1]["s"] < 0.035 and n["s"] - clusters[-1][0]["s"] < 0.11:
            clusters[-1].append(n)
        else:
            clusters.append([n])
    out = []
    for c in clusters:
        t = c[0]["s"]
        c = sorted(c, key=lambda n: -n["v"])
        seen = set()
        for n in c:
            if n["p"] in seen:
                continue
            seen.add(n["p"])
            if len(seen) > max_poly:
                break
            out.append({**n, "s": t, "e": max(n["e"], t + 0.05)})
    out.sort(key=lambda n: (n["s"], n["p"]))
    return out


# --------------------------------------------------------------------------- notes: single lines
def f0_track(mono, fmin: float, fmax: float, device: str = "cpu"):
    """10 ms pitch track: CREPE (tiny, Viterbi-smoothed) if installed, else librosa pYIN.
    On our bass and singing tests CREPE gave far fewer wrong notes than Basic Pitch."""
    import numpy as np
    import librosa

    y16 = librosa.resample(mono.astype(np.float32), orig_sr=SR, target_sr=16000)
    if have("torchcrepe"):
        import torch
        import torchcrepe

        f, conf = torchcrepe.predict(torch.from_numpy(y16[None]), 16000, 160, max(fmin, 32.7), fmax, "tiny", batch_size=2048,
                                     device=device, return_periodicity=True, decoder=torchcrepe.decode.viterbi)
        f = f[0].cpu().numpy().astype(np.float64)
        conf = np.nan_to_num(conf[0].cpu().numpy().astype(np.float64))
    else:
        f, _, conf = librosa.pyin(y16, fmin=fmin, fmax=fmax, sr=16000, frame_length=1024, hop_length=160)
        f = np.nan_to_num(f, nan=1.0)
        conf = np.nan_to_num(conf)
    midi = 69 + 12 * np.log2(np.maximum(f, 1e-6) / 440.0)
    return midi, conf


def mono_line(mono, family: str, sens: float, device: str = "cpu"):
    """Pitch track -> notes. A new note starts at a pitch change that holds, after a silence,
    or at a fresh attack on the same pitch (repeated bass notes, re-sung syllables)."""
    import numpy as np
    import librosa
    from scipy.ndimage import median_filter

    fmin, fmax = (28.0, 420.0) if family == "bass" else (70.0, 1100.0)
    midi, conf = f0_track(mono, fmin, fmax, device)
    n = len(midi)
    hop = 0.01
    frame = int(SR * hop)
    level = librosa.feature.rms(y=mono, frame_length=frame * 4, hop_length=frame, center=True)[0]
    level = np.interp(np.arange(n), np.arange(len(level)), level)
    db = 20 * np.log10(level + 1e-9)
    loud = db > (np.percentile(db, 98) - (34 if family == "bass" else 30))
    thr = (0.5 if family == "bass" else 0.6) + (0.5 - sens) * 0.3
    voiced = (conf > thr) & loud & (midi > librosa.hz_to_midi(fmin)) & (midi < librosa.hz_to_midi(fmax))
    sm = median_filter(np.where(voiced, midi, np.nan), size=5, mode="nearest")
    sm = np.where(voiced, np.where(np.isnan(sm), midi, sm), np.nan)
    attacks = np.zeros(n, bool)
    if family == "bass":
        # plucks: onsets in the low band (kick drum bleed sits lower and is short)
        env = librosa.onset.onset_strength(y=mono, sr=SR, hop_length=frame, fmax=1500)
        env = np.interp(np.arange(n), np.arange(len(env)), env)
        if env.max() > 0:
            on = librosa.onset.onset_detect(onset_envelope=env / env.max(), sr=SR, hop_length=frame, units="frames", delta=0.12, wait=6)
            attacks[np.clip(on, 0, n - 1)] = True
    else:
        # a singer re-articulates the same pitch by dipping in level and coming back; percussive
        # bleed in the vocal stem makes onset detectors fire on every hi-hat, so look for the dip
        for i in range(8, n - 6):
            if not voiced[i]:
                continue
            dip = db[i - 4:i + 1].min()
            if db[i - 8:i - 3].max() - dip > 5 and db[i:i + 6].max() - dip > 5:
                attacks[i] = True
    min_frames = int((70 if family == "bass" else 90) / 10)
    notes: list[dict] = []
    start = None

    def close(i):
        nonlocal start
        if start is not None and i - start >= min_frames:
            seg = sm[start:i]
            seg = seg[~np.isnan(seg)]
            if len(seg):
                vel = int(np.clip(40 + 2.2 * (np.max(db[start:i]) - np.percentile(db, 50)), 30, 120))
                notes.append({"s": round(start * hop, 4), "e": round(i * hop, 4), "p": int(np.round(np.median(seg))), "v": vel})
        start = None

    for i in range(n):
        if np.isnan(sm[i]):
            close(i)
            continue
        if start is None:
            start = i
            continue
        ref = np.median(sm[max(start, i - 8):i])
        if abs(sm[i] - ref) > 0.7:
            ahead = sm[i:i + 4]
            ahead = ahead[~np.isnan(ahead)]
            if len(ahead) >= 3 and np.all(np.abs(ahead - sm[i]) < 0.5):
                close(i)
                start = i
                continue
        if attacks[i] and i - start >= min_frames:
            close(i)
            start = i
    close(n)
    merged: list[dict] = []
    for nt in notes:
        if merged and nt["p"] == merged[-1]["p"] and nt["s"] - merged[-1]["e"] < 0.03 and not attacks[int(nt["s"] / hop)]:
            merged[-1]["e"] = nt["e"]
        else:
            merged.append(nt)
    return merged


# --------------------------------------------------------------------------- drums
def drums_adtof(path: str, sens: float):
    """ADTOF (Zehren et al. 2023): CNN + recurrent model trained on ~360 h of real drum performances."""
    import torch
    from adtof_pytorch import create_frame_rnn_model, calculate_n_bins, load_pytorch_weights, get_default_weights_path
    from adtof_pytorch import load_audio_for_model, PeakPicker, FRAME_RNN_THRESHOLDS, LABELS_5

    model = create_frame_rnn_model(calculate_n_bins())
    model = load_pytorch_weights(model, get_default_weights_path(), strict=False).eval()
    x = load_audio_for_model(path)
    with torch.no_grad():
        act = model(x).cpu().numpy()
    scale = 1.0 + (0.5 - sens) * 0.6
    picks = PeakPicker(thresholds=[t * scale for t in FRAME_RNN_THRESHOLDS], fps=100).pick(act, labels=LABELS_5)[0]
    names = {35: "kick", 38: "snare", 47: "tomMid", 42: "hh", 49: "crash"}
    hits = []
    for label, times in picks.items():
        col = LABELS_5.index(label)
        for t in times:
            f = min(act.shape[1] - 1, int(round(t * 100)))
            peak = float(act[0, max(0, f - 2):f + 3, col].max())
            hits.append({"t": round(float(t), 4), "piece": names[label], "v": int(min(127, 55 + 72 * peak))})
    # an open hi-hat rings: hats whose band keeps sounding are written open
    hits.sort(key=lambda h: h["t"])
    return hits


def transcribe_drums(audio, out_dir: str | None):
    """Band-based drum hit detection: kick / snare / hi-hat / crash. Used when ADTOF is not installed."""
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


# --------------------------------------------------------------------------- words
def transcribe_words(audio, models_dir, language: str | None = None, model_name: str = "base"):
    import librosa
    import whisper

    mono = audio.mean(0)
    samples = librosa.resample(mono, orig_sr=SR, target_sr=16000)
    model = whisper.load_model(model_name, device="cpu", download_root=models_dir)
    result = model.transcribe(samples, fp16=False, word_timestamps=True, condition_on_previous_text=False, verbose=None,
                              language=language or None)
    words = []
    for segment in result.get("segments", []):
        if segment.get("no_speech_prob", 0) > 0.6:
            continue
        for word in segment.get("words", []):
            if word.get("probability", 1) >= 0.2:
                words.append({"start": float(word["start"]), "end": float(word["end"]), "text": word["word"].strip()})
    return {"language": result.get("language", ""), "words": words, "text": " ".join(word["text"] for word in words)}


def snap_words(words, sung):
    """Whisper's word times are approximate (often 100-300 ms early or late on singing). Each word
    moves to the sung note it belongs to: the nearest unused note start, in order, within reach."""
    if not sung or not words:
        return words
    starts = sorted(n["s"] for n in sung)
    import bisect

    used = -1
    out = []
    for w in words:
        i = bisect.bisect_left(starts, w["start"] - 0.35)
        best = None
        for j in range(max(i, used + 1), len(starts)):
            if starts[j] > w["start"] + 0.35 or starts[j] >= w["end"]:
                break
            if best is None or abs(starts[j] - w["start"]) < abs(starts[best] - w["start"]):
                best = j
        if best is not None:
            used = best
            out.append({**w, "start": round(starts[best], 4)})
        else:
            out.append(w)
    return out


# --------------------------------------------------------------------------- pipeline
def stem_notes(name: str, family: str, audio, path: str, a, sens: float, device: str, preset: dict):
    """Notes for one pitched stem, with the model that suits the instrument."""
    if family in ("bass", "vocals"):
        notes = mono_line(audio.mean(0), family, sens, device)
        method = "pitch tracker"
    elif preset["poly"] == "transkun" and family in ("piano", "guitar") and have("transkun"):
        notes = poly_transkun(audio, device)
        method = "Transkun"
    else:
        notes = poly_basic_pitch(path, family, sens)
        method = "Basic Pitch"
    if family not in ("bass", "vocals"):
        notes = clean_poly(notes, family, sens, 6 if family == "guitar" else 10)
    return notes, method


def cmd_process(a) -> None:
    import numpy as np

    t0 = time.time()
    preset = QUALITY.get(a.quality, QUALITY["balanced"])
    sens = max(0.0, min(1.0, a.sensitivity))
    progress("Reading audio", 0.01)
    sr, mix = read_wav(a.input)
    if sr != SR:
        raise RuntimeError(f"Expected {SR} Hz input, got {sr}")
    mix_rms = rms(mix)
    device = pick_device(a.device)
    if a.stems_dir:
        stems = load_stems_dir(a.stems_dir)
    else:
        six = a.model == "htdemucs_6s"
        best_split = a.quality == "best" and six and (not a.sources or any(x in a.sources for x in ("vocals", "drums", "bass")))
        stems = separate(mix, a.model, device, 0.03, 0.3 if best_split else 0.55, preset["shifts"], preset["overlap"])
        if best_split:
            # Best: the fine-tuned 4-source model gives cleaner vocals, drums and bass than the
            # 6-source one; guitar, piano and "other" still come from the 6-source split.
            try:
                four = separate(mix, "htdemucs_ft", device, 0.3, 0.55, preset["shifts"], preset["overlap"])
                for k in ("vocals", "drums", "bass"):
                    stems[k] = four[k]
            except Exception as e:  # noqa: BLE001
                log("Fine-tuned separation skipped:", e)

    stem_dir = os.path.join(a.out, "stems")
    os.makedirs(stem_dir, exist_ok=True)

    # ---- beats (from the full mix: the beat model was trained on mixes)
    progress("Finding the beat", 0.56, "beats and bar lines")
    beat_model = a.beat_model if a.beat_model and os.path.exists(a.beat_model) else None
    if beat_model and preset["beats"] == "small":
        small = os.path.join(os.path.dirname(beat_model), "beat_this_small.onnx")
        beat_model = small if os.path.exists(small) else beat_model
    down_logit = None
    if beat_model and have("onnxruntime"):
        try:
            beat_logit, down_logit = beat_activations(mix.mean(0), beat_model)
            beats, downs = logit_peaks(beat_logit), logit_peaks(down_logit)
            beat_method = "Beat This!"
        except Exception as e:  # noqa: BLE001
            log("Beat model failed, using librosa:", e)
            beats, downs = librosa_beats(mix.mean(0))
            beat_method = "librosa"
    else:
        beats, downs = librosa_beats(mix.mean(0))
        beat_method = "librosa"

    names = [n for n in stems if rms(stems[n]) / (mix_rms + 1e-9) > 0.04]
    skipped = [n for n in stems if n not in names]
    if skipped:
        log("Skipping near-silent stems:", ", ".join(skipped))
    if a.sources:
        names = [name for name in names if name in a.sources]
        if not names:
            raise RuntimeError("The selected instrument groups did not produce audible stems.")
    jobs = []
    for name in names:
        audio = stems[name]
        if name == "vocals" and len(stems) > 1:
            progress("Isolating vocals", 0.58, "removing the band from the voice")
            try:
                rest = sum(stems[k] for k in stems if k != "vocals")
                audio = isolate_vocals(audio, rest)
            except Exception as e:  # noqa: BLE001
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

    analysis = {"engine": ENGINE_VERSION, "quality": a.quality, "duration": mix.shape[1] / SR, "device": device,
                "stems": [], "notes": {}, "methods": {"beats": beat_method}}
    n = max(1, len(jobs))
    for i, (name, f, family, audio, extra) in enumerate(jobs):
        base = 0.6 + 0.36 * (i / n)
        kind, conf, traits = ("singer", 1.0, {}) if family == "vocals" else classify(family, audio, mix_rms)
        traits.update(extra)
        analysis["stems"].append({"name": name, "file": f, "kind": kind, "confidence": round(conf, 2), "traits": traits})
        path = os.path.join(a.out, f)
        if family == "drums":
            use_adtof = a.drum_model != "basic" and have("adtof_pytorch")
            progress("Transcribing drums", base, "ADTOF · kick, snare, toms, hi-hat, cymbals" if use_adtof else "kick · snare · hi-hat · cymbals")
            try:
                analysis["drums"] = drums_adtof(path, sens) if use_adtof else transcribe_drums(audio, None)
                analysis["methods"]["drums"] = "ADTOF" if use_adtof else "band filters"
            except Exception as e:  # noqa: BLE001
                log("ADTOF failed, using band filters:", e)
                analysis["drums"] = transcribe_drums(audio, None)
                analysis["methods"]["drums"] = "band filters"
            if a.drums:
                transcribe_drums(audio, stem_dir)
            continue
        if family == "vocals" and not a.melody and not a.words:
            continue
        if family != "vocals" or a.melody:
            progress("Transcribing " + ("the singer’s melody" if family == "vocals" else name.replace("_", " ")), base,
                     "pitch tracking" if family in ("bass", "vocals") else ("Transkun" if preset["poly"] == "transkun" and family in ("piano", "guitar") else "Basic Pitch"))
            try:
                notes, method = stem_notes(name, family, audio, path, a, sens, device, preset)
            except Exception as e:  # noqa: BLE001
                log(f"{name}: preferred model failed ({e}); using Basic Pitch")
                notes, method = clean_poly(poly_basic_pitch(path, family, sens), family, sens, 6), "Basic Pitch"
            analysis["notes"][name] = notes
            analysis["methods"][name] = method
        if family == "vocals" and a.words:
            progress("Transcribing the singer’s words", base + 0.18 / n, "Whisper · local processing")
            try:
                transcript = transcribe_words(audio, a.models_dir, a.language, a.words_model)
                transcript["words"] = snap_words(transcript["words"], analysis["notes"].get(name, []))
            except Exception as error:  # noqa: BLE001
                log("Word transcription failed:", error)
                transcript = {"language": "", "words": [], "text": "", "error": str(error)}
            analysis.setdefault("lyrics", {})[name] = transcript

    # ---- bar lines and beat positions for everything
    progress("Placing notes on the beat", 0.97)
    events = [n["s"] for notes in analysis["notes"].values() for n in notes] + [h["t"] for h in analysis.get("drums", [])]
    events += [w["start"] for t in analysis.get("lyrics", {}).values() for w in t["words"]]
    ends = [n["e"] for notes in analysis["notes"].values() for n in notes] + events
    first, last = (min(events), max(ends)) if events else (0.0, mix.shape[1] / SR)
    grid = build_grid(beats, downs, down_logit, first, last) if len(beats) >= 4 else None
    if grid:
        times = grid["times"]
        onsets = []
        for notes in analysis["notes"].values():
            for nt in notes:
                nt["b"] = round(to_beats(nt["s"], times), 4)
                nt["be"] = round(to_beats(nt["e"], times), 4)
                onsets.append(nt["b"])
        for h in analysis.get("drums", []):
            h["b"] = round(to_beats(h["t"], times), 4)
            onsets.append(h["b"])
        for t in analysis.get("lyrics", {}).values():
            for w in t["words"]:
                w["b"] = round(to_beats(w["start"], times), 4)
        division, swing = feel(onsets)
        m = grid["meter"]
        if division == "ternary" and m in (2, 4):
            ts = {"num": 3 * m, "den": 8}  # 6/8, 12/8: each tracked beat is a dotted quarter
        elif m == 6:
            ts = {"num": 6, "den": 8}  # beat tracker followed the eighth notes
        elif m == 2:
            ts = {"num": 2, "den": 4}
        else:
            ts = {"num": m, "den": 4}
        grid.update({"division": division, "swing": round(swing, 3), "timeSig": ts})
        analysis["grid"] = grid
        analysis["timeSig"] = ts
        quarter_per_beat = 1.5 if ts["den"] == 8 and m != 6 else (0.5 if m == 6 else 1.0)
        analysis["tempo"] = round(grid["bpm"] * quarter_per_beat, 2)
        analysis["beats"] = times
        analysis["downbeat"] = times[0]
        analysis["beatOffset"] = times[0]
    else:
        analysis.update({"tempo": 120.0, "beats": [], "downbeat": 0.0, "beatOffset": 0.0, "timeSig": {"num": 4, "den": 4}})

    progress("Writing results", 0.99)
    with open(os.path.join(a.out, "analysis.json"), "w", encoding="utf-8") as fh:
        json.dump(analysis, fh)
    log(f"Finished in {time.time() - t0:.1f}s on {device}")
    emit("result", analysis="analysis.json")


def cmd_prepare_beats(directory: str) -> None:
    """Download the Beat This! model (ONNX export, MIT licence) from GitHub."""
    import hashlib
    import urllib.request

    os.makedirs(directory, exist_ok=True)
    base = "https://github.com/danigb/beat-this-rs/releases/download/model-large/"
    target = os.path.join(directory, "beat_this.onnx")
    if not os.path.exists(target):
        tmp = target + ".part"
        urllib.request.urlretrieve(base + "beat_this.onnx", tmp)
        want = urllib.request.urlopen(base + "beat_this.onnx.sha256").read().decode().split()[0]
        got = hashlib.sha256(open(tmp, "rb").read()).hexdigest()
        if want != got:
            os.remove(tmp)
            raise RuntimeError("The beat model download was damaged. Try again.")
        os.replace(tmp, target)
    small = os.path.join(directory, "beat_this_small.onnx")
    if not os.path.exists(small):
        url = "https://raw.githubusercontent.com/danigb/beat-this-rs/1ae768e78f1ad83b0ed3886241dc29ffde853c40/models/beat_this_small.onnx"
        urllib.request.urlretrieve(url, small + ".part")
        os.replace(small + ".part", small)


def main() -> None:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("status")
    prepare = sub.add_parser("prepare-model")
    prepare.add_argument("--model", default="htdemucs_6s")
    words = sub.add_parser("prepare-words")
    words.add_argument("--models-dir", required=True)
    words.add_argument("--words-model", default="base")
    beats = sub.add_parser("prepare-beats")
    beats.add_argument("--dir", required=True)
    p = sub.add_parser("process")
    p.add_argument("--input", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--model", default="htdemucs_6s")
    p.add_argument("--device", default="auto")
    p.add_argument("--drums", action="store_true", help="also write band-split drum stems")
    p.add_argument("--models-dir", default=None, help="Whisper models")
    p.add_argument("--beat-model", default=None, help="beat_this.onnx")
    p.add_argument("--quality", default="balanced", choices=list(QUALITY))
    p.add_argument("--sensitivity", type=float, default=0.5, help="0 = only clear notes, 1 = catch quiet notes too")
    p.add_argument("--drum-model", default="adtof", choices=["adtof", "basic"])
    p.add_argument("--melody", type=int, default=1, help="write the singer's melody as notes")
    p.add_argument("--words", type=int, default=1, help="recognise the singer's words")
    p.add_argument("--words-model", default="base")
    p.add_argument("--language", default=None)
    p.add_argument("--sources", nargs="+", choices=["vocals", "drums", "bass", "guitar", "piano", "other"])
    p.add_argument("--stems-dir", default=None, help="use pre-separated stems instead of running Demucs")
    a = ap.parse_args()
    try:
        if a.cmd == "status":
            cmd_status()
        elif a.cmd == "prepare-words":
            import whisper

            whisper.load_model(a.words_model, device="cpu", download_root=a.models_dir)
        elif a.cmd == "prepare-beats":
            cmd_prepare_beats(a.dir)
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
