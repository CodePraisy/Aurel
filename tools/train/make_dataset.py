"""Training data for fine-tuning Aurel's note models: audio of one instrument *as it comes out of
the separator*, with the exact notes that were played.

Why separated audio: inside Aurel the note models never hear a clean instrument, they hear a
Demucs/RoFormer stem with bleed and artefacts. Training on that (the "trick that matters" from the
research notes) teaches the model to ignore exactly those artefacts.

Sources of notes, mixed freely:
  * generated songs (tools/engine-bench/songgen.py): chord progressions, strums, picking, bass…
  * your own MIDI files (--midi-dir): e.g. GuitarPro files exported to MIDI, DadaGP, Lakh MIDI.
    Tracks are chosen by General MIDI program (guitar 24-31, bass 32-39, piano 0-7).
Each song is rendered with a random SoundFont from --sf2 (use several for timbre variety), the
target instrument gets a random amp/effects chain (pedalboard, if installed), and then the whole
mix goes through the separator. Output per item: <id>.wav (separated stem) + <id>.json (notes).

  python make_dataset.py --out D:/aurel-train/guitar --stem guitar --songs 400 \
      --sf2 GeneralUser-GS.sf2 FluidR3_GM.sf2 --separate demucs --device cuda
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import random
import sys

import numpy as np
import soundfile as sf

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "engine-bench"))
sys.path.insert(0, os.path.join(HERE, "..", "..", "engine"))

SR = 44100
PROGRAMS = {"guitar": range(24, 32), "bass": range(32, 40), "piano": range(0, 8)}


def effects_chain(stem: str, r: random.Random):
    """A random amp/effects chain for the target instrument, or None without pedalboard."""
    try:
        import pedalboard as pb
    except ImportError:
        return None
    fx = []
    if stem == "guitar":
        kind = r.choice(["clean", "crunch", "lead", "metal", "acoustic"])
        if kind != "clean" and kind != "acoustic":
            fx.append(pb.Gain(gain_db=r.uniform(6, 18)))
            fx.append(pb.Distortion(drive_db={"crunch": r.uniform(8, 16), "lead": r.uniform(16, 26), "metal": r.uniform(24, 34)}[kind]))
            fx.append(pb.LowpassFilter(cutoff_frequency_hz=r.uniform(3500, 7000)))  # speaker cabinet
            fx.append(pb.HighpassFilter(cutoff_frequency_hz=r.uniform(70, 140)))
        if r.random() < 0.35:
            fx.append(pb.Chorus(rate_hz=r.uniform(0.3, 1.5), depth=r.uniform(0.1, 0.4), mix=r.uniform(0.2, 0.5)))
        if r.random() < 0.25:
            fx.append(pb.Phaser(rate_hz=r.uniform(0.2, 1.0), mix=r.uniform(0.2, 0.5)))
        if r.random() < 0.3:
            fx.append(pb.Delay(delay_seconds=r.uniform(0.18, 0.45), feedback=r.uniform(0.1, 0.35), mix=r.uniform(0.1, 0.3)))
    elif stem == "bass":
        if r.random() < 0.4:
            fx.append(pb.Distortion(drive_db=r.uniform(4, 14)))
        fx.append(pb.Compressor(threshold_db=r.uniform(-24, -12), ratio=r.uniform(2, 6)))
        fx.append(pb.LowShelfFilter(cutoff_frequency_hz=120, gain_db=r.uniform(-3, 6)))
    fx.append(pb.Reverb(room_size=r.uniform(0.1, 0.6), wet_level=r.uniform(0.03, 0.2), dry_level=1.0))
    return pb.Pedalboard(fx)


def midi_songs(folder: str, stem: str, r: random.Random):
    """(notes_by_stem, programs) from MIDI files: the target instrument plus whatever else plays."""
    import mido

    files = sorted(glob.glob(os.path.join(folder, "**", "*.mid*"), recursive=True))
    r.shuffle(files)
    for f in files:
        try:
            mid = mido.MidiFile(f)
        except Exception:  # noqa: BLE001
            continue
        tempo, t, notes, prog, on = 500000, 0.0, {}, {}, {}
        for msg in mido.merge_tracks(mid.tracks):
            t += mido.tick2second(msg.time, mid.ticks_per_beat, tempo)
            if msg.type == "set_tempo":
                tempo = msg.tempo
            elif msg.type == "program_change":
                prog[msg.channel] = msg.program
            elif msg.type == "note_on" and msg.velocity > 0:
                on[(msg.channel, msg.note)] = (t, msg.velocity)
            elif msg.type in ("note_off", "note_on"):
                s = on.pop((msg.channel, msg.note), None)
                if s and t - s[0] > 0.02:
                    notes.setdefault(msg.channel, []).append({"s": s[0], "e": t, "p": msg.note, "v": s[1]})
        groups: dict[str, list] = {}
        programs: dict[str, int] = {}
        for ch, ns in notes.items():
            p = prog.get(ch, 0)
            name = "drums" if ch == 9 else next((k for k, rg in PROGRAMS.items() if p in rg), "other")
            groups.setdefault(name, []).extend(ns)
            programs.setdefault(name, p)
        if groups.get(stem):
            yield groups, programs


def render(groups, programs, sf2: str, length: float):
    import songgen

    songgen.SF2 = sf2
    songgen._synth = None
    n = int((length + 2) * SR)
    return {k: songgen.render_notes(v, programs.get(k, 0), drums=k == "drums", length=n) for k, v in groups.items() if v}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", required=True)
    ap.add_argument("--stem", default="guitar", choices=list(PROGRAMS))
    ap.add_argument("--songs", type=int, default=200, help="generated songs")
    ap.add_argument("--midi-dir", default=None, help="also use the MIDI files in this folder")
    ap.add_argument("--midi-songs", type=int, default=200)
    ap.add_argument("--sf2", nargs="+", required=True, help="one or more General MIDI SoundFonts")
    ap.add_argument("--separate", default="demucs", choices=["demucs", "roformer", "bleed", "none"])
    ap.add_argument("--roformer-dir", default=None, help="folder that holds roformer/BS-Roformer-SW.ckpt")
    ap.add_argument("--device", default="cuda")
    ap.add_argument("--seed", type=int, default=1000, help="first song seed (keep the bench's 0-15 out of training)")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    r = random.Random(a.seed)
    import songgen

    jobs = [("gen", a.seed + i) for i in range(a.songs)]
    midi_iter = midi_songs(a.midi_dir, a.stem, r) if a.midi_dir else None
    jobs += [("midi", i) for i in range(a.midi_songs if midi_iter else 0)]
    for kind, k in jobs:
        uid = f"{kind}{k:05d}"
        if os.path.exists(os.path.join(a.out, uid + ".json")):
            continue
        if kind == "gen":
            song = songgen.Song(k)
            groups, programs = song.notes, {"guitar": song.guitar_prog, "bass": r.choice([33, 34, 35, 38]), "piano": r.choice([0, 1, 4]), "vocals": r.choice([52, 53, 85]), "drums": 0}
            length = song.beat_times[-1] + 0.5
        else:
            try:
                groups, programs = next(midi_iter)
            except StopIteration:
                break
            length = min(240.0, max(n["e"] for v in groups.values() for n in v))
            groups = {g: [n for n in v if n["s"] < length] for g, v in groups.items()}
        if not groups.get(a.stem):
            continue
        stems = render(groups, programs, r.choice(a.sf2), length)
        fx = effects_chain(a.stem, r)
        if fx is not None:
            stems[a.stem] = fx(stems[a.stem], SR)[:, : stems[a.stem].shape[1]]
        gains = {k: r.uniform(0.6, 1.4) for k in stems}
        mix = sum(v * gains[k] for k, v in stems.items())
        peak = np.abs(mix).max() + 1e-9
        mix = (mix * 0.9 / peak).astype(np.float32)
        target = stems[a.stem] * gains[a.stem] * 0.9 / peak
        if a.separate == "none":
            out = target
        elif a.separate == "bleed":
            others = mix - target
            out = target + r.uniform(0.08, 0.25) * others
        else:
            import aurel_engine as ae

            if a.separate == "roformer":
                sep = ae.separate_roformer(mix, a.roformer_dir, "bs_roformer_sw", a.device, 0, 1)
            else:
                sep = ae.separate(mix, "htdemucs_6s", a.device, 0, 1, 0, 0.25)
            out = sep[a.stem]
        sf.write(os.path.join(a.out, uid + ".wav"), np.clip(out.T, -1, 1), SR, subtype="PCM_16")
        with open(os.path.join(a.out, uid + ".json"), "w") as fh:
            json.dump({"notes": [{k: n[k] for k in ("s", "e", "p", "v")} for n in groups[a.stem]], "length": length, "source": kind}, fh)
        print(uid, f"{length:.0f}s", len(groups[a.stem]), "notes", flush=True)


if __name__ == "__main__":
    main()
