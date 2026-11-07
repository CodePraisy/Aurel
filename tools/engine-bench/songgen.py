"""Synthetic pop-style test songs with exact ground truth (notes per instrument, beats, downbeats).

Each song: chord progression, guitar (strummed or picked), bass, piano or not, a sung-style melody,
drums. Timing is humanised and the tempo can drift, like a band without a click.
"""
from __future__ import annotations

import json
import math
import os
import random
import sys

import numpy as np
import soundfile as sf
import tinysoundfont

SR = 44100
SF2 = os.environ.get("SF2") or os.path.expanduser("~/ref/GeneralUser-GS/GeneralUser-GS.sf2")

MAJOR = [0, 2, 4, 5, 7, 9, 11]
# guitar shapes as (string offsets from low E) per chord quality, as movable barre shapes
E_SHAPE = {"maj": [0, 2, 2, 1, 0, 0], "min": [0, 2, 2, 0, 0, 0], "7": [0, 2, 0, 1, 0, 0]}
A_SHAPE = {"maj": [None, 0, 2, 2, 2, 0], "min": [None, 0, 2, 2, 1, 0], "7": [None, 0, 2, 0, 2, 0]}
OPEN = {  # name -> frets low E..high e
    ("C", "maj"): [None, 3, 2, 0, 1, 0], ("G", "maj"): [3, 2, 0, 0, 0, 3], ("D", "maj"): [None, None, 0, 2, 3, 2],
    ("A", "maj"): [None, 0, 2, 2, 2, 0], ("E", "maj"): [0, 2, 2, 1, 0, 0], ("A", "min"): [None, 0, 2, 2, 1, 0],
    ("E", "min"): [0, 2, 2, 0, 0, 0], ("D", "min"): [None, None, 0, 2, 3, 1], ("F", "maj"): [1, 3, 3, 2, 1, 1],
}
TUNING = [40, 45, 50, 55, 59, 64]
NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def guitar_voicing(root_pc: int, quality: str) -> list[int]:
    name = NAMES[root_pc]
    if (name, quality) in OPEN:
        frets = OPEN[(name, quality)]
    else:
        e_fret = (root_pc - 4) % 12
        a_fret = (root_pc - 9) % 12
        if e_fret <= a_fret and e_fret >= 1 or a_fret == 0:
            frets = [None if x is None else x + e_fret for x in E_SHAPE[quality]] if a_fret != 0 else [None if x is None else x + a_fret for x in A_SHAPE[quality]]
        else:
            frets = [None if x is None else x + a_fret for x in A_SHAPE[quality]]
    return [TUNING[i] + f for i, f in enumerate(frets) if f is not None]


class Song:
    def __init__(self, seed: int):
        r = self.r = random.Random(seed)
        self.seed = seed
        self.tempo = r.choice([72, 80, 88, 96, 100, 108, 116, 120, 126, 132, 140, 150])
        self.meter = 3 if r.random() < 0.15 else 4
        self.bars = r.choice([12, 16])
        self.drift = r.choice([0.0, 0.0, 0.02, 0.04])  # tempo wander (fraction)
        self.jitter = r.choice([0.004, 0.008, 0.012])  # seconds of human timing noise
        self.key = r.randrange(12)
        self.minor = r.random() < 0.35
        self.swing = r.random() < 0.12 and self.meter == 4
        self.guitar_prog = r.choice([24, 25, 27, 29, 30])  # nylon, steel, clean, overdrive, distortion
        self.guitar_style = r.choice(["strum", "strum", "pick", "power"]) if self.guitar_prog < 29 else r.choice(["power", "strum"])
        self.lead_in = r.choice([0.0, 0.0, 0.5, 1.2])  # silence/pickup before bar 1
        self.notes: dict[str, list[dict]] = {k: [] for k in ("guitar", "bass", "piano", "vocals", "drums")}
        self.use_piano = r.random() < 0.5
        self._beats()
        self._compose()

    # beat grid with drift
    def _beats(self):
        n = self.bars * self.meter + 1
        t = self.lead_in + 0.6
        self.beat_times = []
        phase = self.r.random() * 6.28
        for k in range(n):
            self.beat_times.append(t)
            local = self.tempo * (1 + self.drift * math.sin(phase + k / 9.0))
            t += 60.0 / local
        self.downbeats = self.beat_times[:: self.meter][: self.bars]

    def time(self, beat: float, human=True) -> float:
        """Position in beats -> seconds (interpolating the drifting grid), plus swing and jitter."""
        if self.swing:
            frac = beat % 1
            if abs(frac - 0.5) < 1e-6:
                beat = math.floor(beat) + 0.62
        k = int(math.floor(beat))
        k = max(0, min(k, len(self.beat_times) - 2))
        t = self.beat_times[k] + (beat - k) * (self.beat_times[k + 1] - self.beat_times[k])
        return t + (self.r.gauss(0, self.jitter) if human else 0.0)

    def add(self, stem, beat, dur_beats, pitch, vel, offset=0.0):
        s = self.time(beat) + offset
        e = self.time(beat + dur_beats, human=False) - 0.01
        self.notes[stem].append({"s": max(0.0, s), "e": max(s + 0.03, e), "p": int(pitch), "v": int(vel), "beat": beat, "dur": dur_beats})

    def _compose(self):
        r = self.r
        degrees = r.choice([[0, 4, 5, 3], [0, 5, 3, 4], [5, 3, 0, 4], [0, 3, 4, 4], [0, 5, 1, 4], [0, 3, 0, 4]])
        if self.minor:
            degrees = r.choice([[5, 3, 0, 4], [5, 2, 3, 4], [5, 5, 3, 4]])
        scale = [(self.key + x) % 12 for x in MAJOR]
        chords = []
        for bar in range(self.bars):
            d = degrees[bar % len(degrees)]
            root = scale[d]
            third = (scale[(d + 2) % 7] - root) % 12
            chords.append((root, "maj" if third == 4 else "min"))
        self.chords = chords
        m = self.meter
        # ---- guitar
        for bar, (root, q) in enumerate(chords):
            b0 = bar * m
            voicing = guitar_voicing(root, q)
            if self.guitar_style == "strum":
                pattern = r.choice([[0, 1, 1.5, 2.5, 3], [0, 1, 2, 3], [0, 1.5, 2, 2.5, 3.5], [0, 0.5, 1.5, 2, 3, 3.5]]) if m == 4 else [0, 1, 2]
                for i, pos in enumerate(pattern):
                    nxt = pattern[i + 1] if i + 1 < len(pattern) else m
                    up = (pos % 1) != 0
                    strings = voicing[::-1] if up else voicing
                    if up:
                        strings = strings[: max(3, len(strings) - 2)]
                    t0 = r.uniform(-0.01, 0.01)
                    for j, p in enumerate(strings):
                        self.add("guitar", b0 + pos, nxt - pos, p, r.randint(60, 95) - (12 if up else 0), offset=t0 + j * r.uniform(0.006, 0.014))
            elif self.guitar_style == "power":
                base = TUNING[0] + (root - 4) % 12 if (root - 4) % 12 <= 7 else TUNING[1] + (root - 9) % 12
                for pos in [x * 0.5 for x in range(m * 2)]:
                    for p in (base, base + 7, base + 12):
                        self.add("guitar", b0 + pos, 0.45, p, r.randint(75, 100))
            else:  # fingerpicked arpeggio
                order = r.choice([[0, 2, 3, 4, 3, 2, 1, 2], [0, 3, 2, 4, 1, 3, 2, 4]])
                for i in range(m * 2):
                    p = voicing[order[i % len(order)] % len(voicing)]
                    self.add("guitar", b0 + i * 0.5, 1.0 if i % 2 == 0 else 0.5, p, r.randint(60, 90))
        # ---- bass (mono)
        for bar, (root, q) in enumerate(chords):
            b0 = bar * m
            low = 28 + (root - 4) % 12
            fifth = low + 7
            pattern = r.choice([[(0, 1, low), (1, 1, low), (2, 1, fifth), (3, 1, low)], [(0, 1.5, low), (1.5, 0.5, low), (2, 1, low + 12), (3, 0.5, fifth), (3.5, 0.5, low)], [(i * 0.5, 0.5, low) for i in range(8)]]) if m == 4 else [(0, 1, low), (1, 1, fifth), (2, 1, low)]
            for pos, dur, p in pattern:
                self.add("bass", b0 + pos, dur * 0.95, p, r.randint(80, 105))
        # ---- piano: block chords in RH, octave LH
        if self.use_piano:
            for bar, (root, q) in enumerate(chords):
                b0 = bar * m
                third = 3 if q == "min" else 4
                rh = sorted(((60 + root + x - 60) % 12) + 60 for x in (0, third, 7))
                for pos in ([0, 2] if m == 4 else [0]):
                    for p in rh:
                        self.add("piano", b0 + pos, 2 if m == 4 else 3, p, r.randint(55, 80))
                self.add("piano", b0, m, 36 + (root % 12), 70)
        # ---- melody (vocal-like), in scale, phrases with rests
        prev = 64 + self.key % 12
        if prev > 72:
            prev -= 12
        for bar in range(self.bars):
            if bar % 4 == 3 and r.random() < 0.6:
                continue  # breath
            b0 = bar * m
            pos = 0.0 if r.random() < 0.6 else 0.5
            while pos < m - 0.25:
                dur = r.choice([0.5, 0.5, 1, 1, 1.5, 2]) if pos + 0.5 <= m else 0.5
                dur = min(dur, m - pos)
                step = r.choice([-2, -1, -1, 0, 1, 1, 2, 3, -3])
                cand = prev
                for _ in range(abs(step)):
                    cand += 1 if step > 0 else -1
                    while cand % 12 not in [(self.key + x) % 12 for x in MAJOR]:
                        cand += 1 if step > 0 else -1
                cand = min(max(cand, 57), 76)
                self.add("vocals", b0 + pos, dur * 0.92, cand, r.randint(75, 100))
                prev = cand
                pos += dur
                if r.random() < 0.15:
                    pos += 0.5
        # ---- drums
        for bar in range(self.bars):
            b0 = bar * m
            fill = bar % 4 == 3 and r.random() < 0.5
            for i in range(m * 2):
                pos = i * 0.5
                if fill and pos >= m - 1:
                    self.add("drums", b0 + pos, 0.25, r.choice([45, 47, 50]), 100)
                    continue
                self.add("drums", b0 + pos, 0.25, 42 if not (bar % 8 == 7 and pos == m - 0.5) else 46, r.randint(55, 85))
                if m == 4:
                    if pos in (0, 2) or (pos == 2.5 and r.random() < 0.4):
                        self.add("drums", b0 + pos, 0.25, 36, r.randint(95, 120))
                    if pos in (1, 3):
                        self.add("drums", b0 + pos, 0.25, 38, r.randint(95, 120))
                else:
                    if pos == 0:
                        self.add("drums", b0 + pos, 0.25, 36, 110)
                    if pos in (1, 2):
                        self.add("drums", b0 + pos, 0.25, 38, 100)
            if bar % 4 == 0:
                self.add("drums", b0, 1, 49, 110)

    def render(self, out_dir: str):
        os.makedirs(out_dir, exist_ok=True)
        programs = {"guitar": self.guitar_prog, "bass": self.r.choice([33, 34]), "piano": 0, "vocals": self.r.choice([52, 53, 85]), "drums": 0}
        length = int((self.beat_times[-1] + 2.5) * SR)
        stems = {}
        for stem, notes in self.notes.items():
            if not notes:
                continue
            gain = {"vocals": 3.0, "bass": 1.6}.get(stem, 1.0)
            stems[stem] = gain * render_notes(notes, programs[stem], drums=stem == "drums", length=length)
        mix = sum(stems.values())
        peak = np.abs(mix).max() + 1e-9
        g = 0.89 / peak
        for k in stems:
            sf.write(os.path.join(out_dir, f"{k}.wav"), (stems[k] * g).T, SR, subtype="PCM_16")
        sf.write(os.path.join(out_dir, "mix.wav"), (mix * g).T, SR, subtype="PCM_16")
        truth = {
            "tempo": self.tempo, "meter": self.meter, "beats": self.beat_times, "downbeats": self.downbeats,
            "notes": self.notes, "programs": programs, "guitar_style": self.guitar_style, "drift": self.drift,
            "swing": self.swing, "key": self.key, "minor": self.minor, "chords": self.chords,
        }
        with open(os.path.join(out_dir, "truth.json"), "w") as fh:
            json.dump(truth, fh)


_synth = None


def render_notes(notes, program, drums=False, length=None):
    global _synth
    if _synth is None:
        _synth = tinysoundfont.Synth(samplerate=SR, gain=-6)
        _synth_sf = _synth.sfload(SF2)
        _synth._sfid = _synth_sf
    s = _synth
    ch = 9 if drums else 0
    s.notes_off()
    s.sounds_off()
    if drums:
        s.program_select(ch, s._sfid, 0, 0, True)
    else:
        s.program_select(ch, s._sfid, 0, program)
    ev = []
    for n in notes:
        ev.append((n["s"], 1, n["p"], n["v"]))
        ev.append((n["e"] if not drums else n["s"] + 0.2, 0, n["p"], 0))
    ev.sort(key=lambda x: (x[0], x[1]))
    total = length or int((max(e[0] for e in ev) + 2) * SR)
    out = np.zeros((total, 2), np.float32)
    pos = 0
    for t, kind, p, v in ev:
        at = min(total, int(t * SR))
        if at > pos:
            buf = np.frombuffer(s.generate(at - pos), dtype=np.float32).reshape(-1, 2)
            out[pos:at] = buf
            pos = at
        if kind:
            s.noteon(ch, p, v)
        else:
            s.noteoff(ch, p)
    if total > pos:
        out[pos:] = np.frombuffer(s.generate(total - pos), dtype=np.float32).reshape(-1, 2)
    return out.T


if __name__ == "__main__":
    root = sys.argv[1]
    seeds = [int(x) for x in sys.argv[2:]] or list(range(8))
    for seed in seeds:
        song = Song(seed)
        song.render(os.path.join(root, f"song{seed:02d}"))
        print(seed, song.tempo, song.meter, song.guitar_prog, song.guitar_style, "drift", song.drift, "swing", song.swing)
