"""Fine-tune Transkun 2 (the piano/guitar note model Aurel uses) on separated stems, sized for an
RTX 3050 with 6 GB.

What makes it fit in 6 GB:
  * mixed precision (bf16 on RTX 30xx, which needs no loss scaling)
  * short chunks (8 s instead of Transkun's 16 s) and a batch of 2, with gradient accumulation so
    the effective batch is still 16
  * if a step still runs out of memory, the chunk is shortened by a quarter and training goes on
  * the lowest layers can be frozen (--freeze 2), saving memory and protecting what the model
    already knows
A run of ~5 000 steps (≈ 6–10 h on a 3050 at the defaults) is usually enough to adapt the model to
separated guitar. Checkpoints are written every --save-every steps; Ctrl+C and run again to resume.

  python finetune_transkun.py --data D:/aurel-train/guitar --out D:/aurel-train/guitar-ft.pt

Use the result in Aurel: Settings → Transcription → Custom note model, or pass
`--transkun-checkpoint <file>` to the engine.
"""
from __future__ import annotations

import argparse
import glob
import json
import math
import os
import random
import time

import numpy as np
import soundfile as sf
import torch


def load_model(checkpoint: str | None, device: str):
    import moduleconf
    import transkun

    base = os.path.join(os.path.dirname(transkun.__file__), "pretrained")
    conf = moduleconf.parseFromFile(os.path.join(base, "2.0.conf"))
    model = conf["Model"].module.TransKun(conf=conf["Model"].config)
    ck = torch.load(checkpoint or os.path.join(base, "2.0.pt"), map_location="cpu", weights_only=False)
    state = ck.get("best_state_dict") or ck.get("state_dict") or ck
    model.load_state_dict(state, strict=False)
    return model.to(device)


class Clips(torch.utils.data.Dataset):
    """Random windows of the separated stems, with the notes inside each window."""

    def __init__(self, items, chunk: float, per_epoch: int, seed: int):
        self.items, self.chunk, self.per_epoch = items, chunk, per_epoch
        self.r = random.Random(seed)

    def __len__(self):
        return self.per_epoch

    def __getitem__(self, _):
        from transkun.Data import Note

        wav, notes, length = self.items[self.r.randrange(len(self.items))]
        info = sf.info(wav)
        dur = info.frames / info.samplerate
        begin = self.r.uniform(-1.0, max(0.0, dur - self.chunk + 1.0))
        end = begin + self.chunk
        b, e = int(round(begin * info.samplerate)), int(round(begin * info.samplerate)) + int(round(self.chunk * info.samplerate))
        x, _ = sf.read(wav, start=max(0, b), stop=max(0, min(info.frames, e)), dtype="float32", always_2d=True)
        x = np.pad(x, ((max(0, -b), max(0, e - b - len(x) - max(0, -b))), (0, 0)))
        if x.shape[1] == 1:
            x = np.repeat(x, 2, 1)
        gain = self.r.uniform(0.5, 1.2)  # loudness varies between songs
        x = x * gain / max(1e-3, np.abs(x).max())
        clip = [Note(max(n["s"], begin) - begin, min(n["e"], end) - begin, int(n["p"]), int(n["v"]), n["s"] >= begin, n["e"] < end)
                for n in notes if n["e"] > begin and n["s"] < end and 21 <= n["p"] <= 108]
        return {"x": torch.from_numpy(x[: e - b].astype(np.float32)), "notes": clip}


def untangle(notes):
    """Transkun needs notes of one pitch not to overlap: a repeated note ends where the next starts."""
    out, last = [], {}
    for n in sorted((dict(n) for n in notes), key=lambda n: (n["s"], n["p"])):
        prev = last.get(n["p"])
        if prev is not None and n["s"] < prev["e"]:
            prev["e"] = n["s"]
        last[n["p"]] = n
        out.append(n)
    return [n for n in out if n["e"] - n["s"] >= 0.01]


def collate(batch):
    n = min(b["x"].shape[0] for b in batch)
    return torch.stack([b["x"][:n] for b in batch]), [b["notes"] for b in batch]


def note_f1(model, items, device, limit=8):
    """Onset F1 (50 ms, mir_eval) on whole held-out songs, the way Aurel transcribes them."""
    import mir_eval

    model.eval()
    scores = []
    for wav, notes, _ in items[:limit]:
        x, fs = sf.read(wav, dtype="float32", always_2d=True)
        if x.shape[1] == 1:
            x = np.repeat(x, 2, 1)
        with torch.no_grad():
            est = model.transcribe(torch.from_numpy(x).to(device), discardSecondHalf=False)
        ref = [n for n in notes if 21 <= n["p"] <= 108]
        if not ref or not est:
            scores.append(0.0)
            continue
        ri = np.array([[n["s"], max(n["e"], n["s"] + 0.05)] for n in ref])
        ei = np.array([[n.start, max(n.end, n.start + 0.05)] for n in est])
        rp = mir_eval.util.midi_to_hz(np.array([n["p"] for n in ref]))
        ep = mir_eval.util.midi_to_hz(np.array([n.pitch for n in est]))
        scores.append(mir_eval.transcription.precision_recall_f1_overlap(ri, rp, ei, ep, offset_ratio=None)[2])
    model.train()
    return float(np.mean(scores)) if scores else 0.0


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", required=True, help="folder from make_dataset.py (<id>.wav + <id>.json)")
    ap.add_argument("--out", required=True, help="checkpoint to write (and resume from)")
    ap.add_argument("--base", default=None, help="start from this checkpoint instead of Transkun 2.0")
    ap.add_argument("--steps", type=int, default=5000, help="optimizer steps")
    ap.add_argument("--chunk", type=float, default=8.0, help="seconds per training window (16 = Transkun's own)")
    ap.add_argument("--batch", type=int, default=2)
    ap.add_argument("--accum", type=int, default=8, help="batches per optimizer step (effective batch = batch × accum)")
    ap.add_argument("--lr", type=float, default=2e-5, help="small: we adapt the model, not retrain it")
    ap.add_argument("--freeze", type=int, default=0, help="freeze this many of the lowest transformer layers")
    ap.add_argument("--amp", default="auto", choices=["auto", "bf16", "fp16", "off"])
    ap.add_argument("--device", default="cuda" if torch.cuda.is_available() else "cpu")
    ap.add_argument("--val", type=float, default=0.08, help="share of songs held out for scoring")
    ap.add_argument("--eval-every", type=int, default=250)
    ap.add_argument("--save-every", type=int, default=100)
    ap.add_argument("--workers", type=int, default=2)
    ap.add_argument("--seed", type=int, default=7)
    a = ap.parse_args()

    os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")
    items = []
    for j in sorted(glob.glob(os.path.join(a.data, "*.json"))):
        wav = j[:-5] + ".wav"
        if os.path.exists(wav):
            d = json.load(open(j))
            items.append((wav, untangle(d["notes"]), d.get("length", 0)))
    if len(items) < 4:
        raise SystemExit(f"Only {len(items)} items in {a.data}; make more with make_dataset.py first.")
    rnd = random.Random(a.seed)
    rnd.shuffle(items)
    n_val = max(2, int(len(items) * a.val))
    val, train = items[:n_val], items[n_val:]
    print(f"{len(train)} training songs, {len(val)} held out")

    resume = os.path.exists(a.out)
    model = load_model(a.out if resume else a.base, a.device)
    ck = torch.load(a.out, map_location="cpu", weights_only=False) if resume else {}
    a.freeze = ck.get("freeze", a.freeze)  # a resumed run keeps the layers it froze
    if a.freeze:
        # the backbone's longest stack of transformer blocks; its first layers see the spectrogram
        stacks = [m for _, m in model.backbone.named_modules() if isinstance(m, torch.nn.ModuleList)]
        layers = list(max(stacks, key=len))[: a.freeze] if stacks else []
        for layer in layers:
            for p in layer.parameters():
                p.requires_grad = False
        for p in model.framewiseFeatureExtractor.parameters():
            p.requires_grad = False
        print(f"froze the spectrogram front-end and {len(layers)} transformer layers")
    params = [p for p in model.parameters() if p.requires_grad]
    opt = torch.optim.AdamW(params, lr=a.lr, weight_decay=1e-4)
    step, best = 0, -1.0
    if resume:
        if "optimizer" in ck:
            opt.load_state_dict(ck["optimizer"])
        step, best = ck.get("step", 0), ck.get("best_f1", -1.0)
        print(f"resuming at step {step} (best F1 {best:.3f})")
    sched = torch.optim.lr_scheduler.LambdaLR(opt, lambda s: min(1.0, (s + 1) / 200) * 0.5 * (1 + math.cos(math.pi * min(1.0, s / a.steps))))
    for _ in range(step):
        sched.step()

    cuda = a.device.startswith("cuda")
    amp = a.amp
    if amp == "auto":
        amp = "bf16" if cuda and torch.cuda.is_bf16_supported() else ("fp16" if cuda else "off")
    dtype = {"bf16": torch.bfloat16, "fp16": torch.float16}.get(amp)
    scaler = torch.amp.GradScaler("cuda", enabled=amp == "fp16")
    if cuda:
        print(f"GPU {torch.cuda.get_device_name(0)}, {torch.cuda.get_device_properties(0).total_memory / 2**30:.1f} GB, precision {amp}")
    chunk = a.chunk

    def save(path, f1=None):
        tmp = path + ".tmp"
        ck = {"state_dict": model.state_dict(), "optimizer": opt.state_dict(), "step": step, "best_f1": best, "chunk": chunk, "freeze": a.freeze, "base": "transkun-2.0"}
        if f1 is not None:
            ck["best_state_dict"] = ck.pop("state_dict")
            ck.pop("optimizer")
        torch.save(ck, tmp)
        os.replace(tmp, path)

    if best < 0:
        best = note_f1(model, val, a.device)
        print(f"before fine-tuning: held-out note F1 {best:.3f}")
    model.train()
    t0, losses = time.time(), []
    while step < a.steps:
        data = torch.utils.data.DataLoader(Clips(train, chunk, a.batch * a.accum * 50, a.seed + step), batch_size=a.batch, collate_fn=collate, num_workers=a.workers)
        it = iter(data)
        try:
            while step < a.steps:
                opt.zero_grad(set_to_none=True)
                for _ in range(a.accum):
                    x, notes = next(it)
                    with torch.autocast("cuda" if cuda else "cpu", dtype=dtype, enabled=dtype is not None):
                        logp = model.log_prob(x.to(a.device), notes)
                        loss = -logp.sum(-1).mean()
                    scaler.scale(loss / (a.accum * 50)).backward()
                    losses.append(float(loss.detach()) / max(1e-6, x.shape[1] / 44100))
                scaler.unscale_(opt)
                torch.nn.utils.clip_grad_norm_(params, 1.0)
                scaler.step(opt)
                scaler.update()
                sched.step()
                step += 1
                if step % 20 == 0:
                    print(f"step {step}/{a.steps}  loss/s {np.mean(losses[-20 * a.accum:]):.2f}  lr {sched.get_last_lr()[0]:.1e}  {(time.time() - t0) / 20:.1f} s/step", flush=True)
                    t0 = time.time()
                if step % a.save_every == 0:
                    save(a.out)
                if step % a.eval_every == 0:
                    f1 = note_f1(model, val, a.device)
                    print(f"step {step}: held-out note F1 {f1:.3f} (best {best:.3f})", flush=True)
                    if f1 > best:
                        best = f1
                        save(os.path.splitext(a.out)[0] + "-best.pt", f1)
        except torch.cuda.OutOfMemoryError:
            opt.zero_grad(set_to_none=True)
            torch.cuda.empty_cache()
            chunk = max(3.0, chunk * 0.75)
            print(f"out of GPU memory: windows are now {chunk:.1f} s")
        except StopIteration:
            continue
    save(a.out)
    best_path = os.path.splitext(a.out)[0] + "-best.pt"
    if os.path.exists(best_path):
        print(f"done. best held-out note F1 {best:.3f}: use {best_path}")
    else:
        print(f"done. The model did not beat the original on the held-out songs (F1 {best:.3f}); keep using the built-in one.")


if __name__ == "__main__":
    main()
