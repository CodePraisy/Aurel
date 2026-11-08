# Training Aurel's note models on your own GPU

These scripts fine-tune **Transkun 2** (the model Aurel uses for guitar and piano notes) on audio
that has been through Aurel's own separator. They are sized for an **RTX 3050 with 6 GB**.

## Why this helps

The built-in Transkun was trained on clean solo piano (MAESTRO). Inside Aurel it listens to a
separated guitar stem: a different instrument, with bleed from the band and separation artefacts.
Fine-tuning on separated stems with known notes teaches it exactly that situation. Papers that
did this for guitar report large gains: SynthTab pretraining on synthesized tabs
([Zang et al. 2024](https://arxiv.org/abs/2309.09085)), training on amp and effect tones
([Pedroza et al. 2024](https://arxiv.org/abs/2405.14679)), and domain adaptation from piano to
guitar ([Riley et al. 2024](https://arxiv.org/abs/2402.15258)).

## 1. Install (once)

Use the Python that Aurel installed (`%APPDATA%\Aurel\engine\venv\Scripts\python.exe`) or any
Python 3.10 with the engine's packages, plus:

```bat
python -m pip install tinysoundfont soundfile pedalboard mido mir_eval
```

You also need one or more General MIDI SoundFonts (`.sf2`). GeneralUser GS and FluidR3_GM are
free. More SoundFonts means more timbres, which generalises better.

## 2. Make training data

```bat
python tools\train\make_dataset.py --out D:\aurel-train\guitar --stem guitar --songs 600 ^
    --sf2 D:\sf2\GeneralUser-GS.sf2 D:\sf2\FluidR3_GM.sf2 --separate demucs --device cuda
```

* `--separate demucs` runs every song through Demucs, as Aurel does on a GPU-less PC. Use
  `roformer` if you run Aurel with BS-RoFormer, or `bleed` to skip separation (fast, less realistic).
* `--midi-dir` adds your own MIDI files: Guitar Pro files exported to MIDI, the DadaGP dataset
  ([Sarmento et al. 2021](https://arxiv.org/abs/2107.14653)), Lakh MIDI. These are the biggest
  win, because real songs have real riffs.
* A random amp and effects chain (clean, crunch, lead, metal, chorus, delay, reverb) is put on
  the guitar before mixing.
* 600 songs take about 1–2 hours on a 3050 and ~4 GB of disk.

## 3. Fine-tune

```bat
python tools\train\finetune_transkun.py --data D:\aurel-train\guitar --out D:\aurel-train\guitar-ft.pt
```

| Setting | Default | Why |
|---|---|---|
| `--chunk` | 8 s | Transkun's own 16 s windows don't fit next to the optimizer in 6 GB |
| `--batch` × `--accum` | 2 × 8 | effective batch of 16 without the memory of 16 |
| `--amp` | bf16 | RTX 30-series cards run bfloat16 natively; no loss scaling needed |
| `--lr` | 2e-5 | small: adapt the model, don't overwrite what it knows |
| `--freeze` | 0 | `--freeze 2` freezes the spectrogram front-end and two lowest layers (less memory, safer on little data) |

If a step runs out of GPU memory, the window is shortened by a quarter and training continues.
Every 250 steps it transcribes the held-out songs and reports note F1; the best checkpoint is
saved as `guitar-ft-best.pt`. Ctrl+C at any time; running the same command again resumes.
About 5 000 steps (6–10 hours) is a good first run.

## 4. Use it in Aurel

Settings → Transcription → **Custom note model** → choose `guitar-ft-best.pt`. Aurel then uses
it for guitar and piano stems. Turn it off there to go back to the built-in model.

## 5. Check that it's actually better

Fine-tuning on generated songs can make the generated-song benchmark look better than real music
will. Judge it on real recordings: the real-song set in `tools/engine-bench/real/` (AlpacaGuitarSet
open subset and Bach10, both with known scores) scores a model the same way on audio it never saw.
