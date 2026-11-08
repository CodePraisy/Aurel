"""Run YourMT3+ (Chang et al., MLSP 2024) on an audio file and print its notes as JSON.

YourMT3+ is an optional download for Aurel: its code (GPL-3.0) and weights (Apache-2.0) are
fetched into the engine folder only when chosen in Settings, and run here as a separate process.
Nothing of it is part of Aurel itself.

    python ymt3_runner.py --code <dir with amt/> --ckpt <model.ckpt> --audio x.wav --out notes.json [--device cuda]

Output: {"notes": [{"s": onset, "e": offset, "p": pitch, "v": velocity, "prog": program, "drum": bool}, ...]}
"""
from __future__ import annotations

import argparse
import importlib
import json
import os
import sys
from pathlib import Path
from unittest.mock import patch

# the published checkpoint: YPTF.MoE+Multi, no pitch-shift augmentation (best in the paper)
EXP = "mc13_256_g4_all_v7_mt3f_sqr_rms_moe_wf4_n8k2_silu_rope_rp_b36_nops"
MODEL_ARGS = [EXP + "@last.ckpt", "-p", "2024", "-tk", "mc13_full_plus_256", "-dec", "multi-t5", "-nl", "26",
              "-enc", "perceiver-tf", "-sqr", "1", "-ff", "moe", "-wf", "4", "-nmoe", "8", "-kmoe", "2",
              "-act", "silu", "-epe", "rope", "-rp", "1", "-ac", "spec", "-hop", "300", "-atc", "1", "-pr", "32"]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--code", required=True)
    ap.add_argument("--ckpt", required=True)
    ap.add_argument("--audio", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--device", default="cpu")
    a = ap.parse_args()

    code = Path(a.code).resolve()
    sys.path.insert(0, str(code))
    # the code looks for the checkpoint at amt/logs/2024/<exp>/checkpoints/last.ckpt
    ck_dir = code / "amt" / "logs" / "2024" / EXP / "checkpoints"
    ck_dir.mkdir(parents=True, exist_ok=True)
    link = ck_dir / "last.ckpt"
    if not link.exists():
        try:
            os.symlink(os.path.abspath(a.ckpt), link)
        except OSError:  # Windows without symlink rights: hard link, else copy
            try:
                os.link(os.path.abspath(a.ckpt), link)
            except OSError:
                import shutil

                shutil.copyfile(a.ckpt, link)

    import torch
    import torchaudio

    import model_helper as mh

    # checkpoints pickled before `utils` moved under `amt`
    aliases = {k: importlib.import_module("amt." + k) for k in ("utils", "utils.event_codec", "utils.note_event_dataclasses", "utils.task_manager", "utils.tokenizer")}
    cwd = os.getcwd()
    os.chdir(code)
    try:
        with patch.dict(sys.modules, aliases):
            model = mh.load_model_checkpoint(args=MODEL_ARGS, device="cpu")
    finally:
        os.chdir(cwd)
    dev = torch.device(a.device if a.device == "cuda" and torch.cuda.is_available() else "cpu")
    model = model.to(dev).eval()

    from amt.utils.audio import slice_padded_array
    from amt.utils.event2note import merge_zipped_note_events_and_ties_to_notes
    from amt.utils.note2event import mix_notes

    audio, sr = torchaudio.load(a.audio)
    audio = torchaudio.functional.resample(audio.mean(0, keepdim=True), sr, model.audio_cfg["sample_rate"])
    frames = model.audio_cfg["input_frames"]
    seg = torch.from_numpy(slice_padded_array(audio, frames, frames).astype("float32")).to(dev).unsqueeze(1)
    with torch.inference_mode(), torch.autocast("cuda", dtype=torch.bfloat16, enabled=dev.type == "cuda"):
        tokens, _ = model.inference_file(bsz=8 if dev.type == "cuda" else 2, audio_segments=seg)
    starts = [frames * i / model.audio_cfg["sample_rate"] for i in range(seg.shape[0])]
    per_channel = []
    for ch in range(model.task_manager.num_decoding_channels):
        zipped, _, _ = model.task_manager.detokenize_list_batches([t[:, ch, :] for t in tokens], starts, return_events=True)
        notes_ch, _ = merge_zipped_note_events_and_ties_to_notes(zipped)
        per_channel.append(notes_ch)
    notes = mix_notes(per_channel)
    out = [{"s": round(float(n.onset), 4), "e": round(float(n.offset), 4), "p": int(n.pitch), "v": int(n.velocity) if n.velocity > 1 else 90,
            "prog": int(n.program), "drum": bool(n.is_drum)} for n in notes]
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump({"notes": out, "model": "YourMT3+ " + EXP}, f)
    print(json.dumps({"type": "done", "notes": len(out)}), flush=True)


if __name__ == "__main__":
    main()
