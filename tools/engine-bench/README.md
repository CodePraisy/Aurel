# Engine benchmark

Measures what matters for a transcription: notes on exactly the right beat, with exactly the right pitch.

1. `songgen.py` writes pop-style songs with known notes: chord progressions with strummed, picked or power-chord guitar, bass, piano, a sung-style melody and drums. Timing is humanised, the tempo can drift, some songs swing, some are in 3/4. Every note's beat position is recorded in `truth.json`.
2. `dirty.py` gives each stem what a separation leaves behind: 12–22 % of the other instruments plus some room sound.
3. `run.sh` runs the real engine (`engine/aurel_engine.py process --stems-dir …`) on each song's mix and dirty stems, then `tests/bench.notation.test.ts` turns each analysis into a score the same way the app does and compares it with the truth.

```sh
SF2=/path/to/GeneralUser-GS.sf2 PY=/path/to/engine-venv/bin/python BEAT=/path/to/beat_this.onnx ./tools/engine-bench/run.sh
```

Needs the engine's Python packages plus `tinysoundfont`, `soundfile` and `mir_eval`. `evaluate.py` scores raw note timing (mir_eval, 50 ms onset tolerance) for quick experiments on single models.

## Real songs with known scores

Generated songs can flatter a change, so every engine change is also checked on real music in
`real/`:

* **AlpacaGuitarSet open subset** (CC-BY-4.0): three songs rendered from Guitar Pro with their
  MusicXML (guitars, fretless bass, percussion), including a song that shows every guitar technique.
  Their tabs also score **tab fingering** (`tests/fingering.bench.test.ts`).
* **Bach10** (Duan et al.): ten Bach chorales played by violin, clarinet, saxophone and bassoon,
  real recordings with every note aligned to the audio.

```sh
ALPACA=alpaca-guitarset/data/open_subset BACH10=Bach10_v1.1 OUT=real/songs python real/prep.py
PY=... BEAT=beat_this.onnx TAG=demucs MODEL=htdemucs_6s real/run.sh $(ls real/songs)
SONGS=real/songs python real/score.py real/runs/demucs
```

`score.py` reports note F1 with mir_eval (onset within 50 ms, right pitch).
`techniques_check.py` checks bend, vibrato and slide detection on synthetic tones.
