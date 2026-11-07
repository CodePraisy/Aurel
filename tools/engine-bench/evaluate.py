"""Score an engine on the synthetic songs: notes per stem, drums per piece, beats and tempo."""
import importlib.util, json, os, sys, time
import numpy as np, mir_eval, soundfile as sf

DRUM_CLASS = {36: "kick", 35: "kick", 38: "snare", 40: "snare", 37: "snare", 42: "hh", 44: "hh", 46: "hh", 49: "cym", 51: "cym", 57: "cym", 52: "cym", 55: "cym", 45: "tom", 47: "tom", 50: "tom", 48: "tom", 43: "tom", 41: "tom"}
PIECE_CLASS = {"kick": "kick", "snare": "snare", "hh": "hh", "hhOpen": "hh", "crash": "cym", "ride": "cym", "tom": "tom", "tomHigh": "tom", "tomMid": "tom", "tomLow": "tom", "floorTom": "tom"}


def load(path):
    spec = importlib.util.spec_from_file_location("eng", path)
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); return m


def note_scores(ref, est):
    if not ref or not est:
        return {"onF": 0.0, "onP": 0.0, "onR": 0.0, "noteF": 0.0}
    ri = np.array([[n["s"], n["e"]] for n in ref]); rp = mir_eval.util.midi_to_hz(np.array([n["p"] for n in ref]))
    ei = np.array([[n["s"], max(n["e"], n["s"] + 0.01)] for n in est]); ep = mir_eval.util.midi_to_hz(np.array([n["p"] for n in est]))
    P, R, F, _ = mir_eval.transcription.precision_recall_f1_overlap(ri, rp, ei, ep, offset_ratio=None, onset_tolerance=0.05)
    _, _, F2, _ = mir_eval.transcription.precision_recall_f1_overlap(ri, rp, ei, ep, offset_ratio=0.2, onset_tolerance=0.05)
    return {"onF": F, "onP": P, "onR": R, "noteF": F2}


def drum_scores(ref, est):
    out = {}
    for c in ("kick", "snare", "hh"):
        r = np.array(sorted(n["s"] for n in ref if DRUM_CLASS.get(n["p"]) == c))
        e = np.array(sorted(h["t"] for h in est if PIECE_CLASS.get(h["piece"], h["piece"]) == c))
        out[c] = mir_eval.onset.f_measure(r, e, window=0.05)[0] if len(r) and len(e) else 0.0
    return out


def run(engine_path, song_dirs, stems=("guitar", "bass", "piano", "vocals"), tag=""):
    eng = load(engine_path)
    rows = []
    for d in song_dirs:
        truth = json.load(open(os.path.join(d, "truth.json")))
        row = {"song": os.path.basename(d)}
        mix, sr = sf.read(os.path.join(d, "mix.wav"), dtype="float32"); mix = mix.T
        t0 = time.time()
        res = eng.bench_song(d, truth) if hasattr(eng, "bench_song") else legacy(eng, d, mix, truth, stems)
        row["sec"] = time.time() - t0
        ref_beats = np.array(truth["beats"][:-1])
        if res.get("beats") is not None:
            row["beatF"] = mir_eval.beat.f_measure(ref_beats, np.array(res["beats"]))
            true_tempo = 60 / np.median(np.diff(ref_beats))
            row["tempoOK"] = float(abs(res["tempo"] - true_tempo) / true_tempo < 0.04)
            row["meterOK"] = float(res.get("meter") == truth["meter"])
            if res.get("downbeats") is not None and len(res["downbeats"]):
                row["downF"] = mir_eval.beat.f_measure(np.array(truth["downbeats"]), np.array(res["downbeats"]), f_measure_threshold=0.07)
        for s in stems:
            if truth["notes"].get(s) and s in res.get("notes", {}):
                sc = note_scores(truth["notes"][s], res["notes"][s])
                row[f"{s}.onF"] = sc["onF"]; row[f"{s}.noteF"] = sc["noteF"]; row[f"{s}.P"] = sc["onP"]; row[f"{s}.R"] = sc["onR"]
        if "drums" in res:
            for k, v in drum_scores(truth["notes"]["drums"], res["drums"]).items():
                row[f"drum.{k}"] = v
        rows.append(row)
        print(tag, json.dumps({k: (round(v, 3) if isinstance(v, float) else v) for k, v in row.items()}), flush=True)
    keys = sorted({k for r in rows for k in r if k != "song"})
    summary = {k: float(np.mean([r[k] for r in rows if k in r])) for k in keys}
    print(tag, "MEAN", json.dumps({k: round(v, 3) for k, v in summary.items()}))
    return summary


def legacy(eng, d, mix, truth, stems):
    out = {"notes": {}}
    drums, _ = sf.read(os.path.join(d, "drums.wav"), dtype="float32")
    tempo, beats, meter, down = eng.tempo_and_beats(drums.T.mean(0))
    out.update(tempo=tempo, beats=beats, meter=meter, downbeats=[b for i, b in enumerate(beats) if False])
    for s in stems:
        p = os.path.join(d, f"{s}.wav")
        if os.path.exists(p) and truth["notes"].get(s):
            out["notes"][s] = eng.transcribe(p, s)
    a, _ = sf.read(os.path.join(d, "drums.wav"), dtype="float32")
    out["drums"] = eng.transcribe_drums(a.T, None)
    return out


if __name__ == "__main__":
    eng = sys.argv[1]
    dirs = sorted(os.path.join(sys.argv[2], x) for x in os.listdir(sys.argv[2]))[: int(sys.argv[3]) if len(sys.argv) > 3 else None]
    run(eng, dirs, tag=os.path.basename(eng))
