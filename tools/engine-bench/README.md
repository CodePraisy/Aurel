# Engine benchmark

Measures what matters for a transcription: notes on exactly the right beat, with exactly the right pitch.

1. `songgen.py` writes pop-style songs with known notes: chord progressions with strummed, picked or power-chord guitar, bass, piano, a sung-style melody and drums. Timing is humanised, the tempo can drift, some songs swing, some are in 3/4. Every note's beat position is recorded in `truth.json`.
2. `dirty.py` gives each stem what a separation leaves behind: 12–22 % of the other instruments plus some room sound.
3. `run.sh` runs the real engine (`engine/aurel_engine.py process --stems-dir …`) on each song's mix and dirty stems, then `tests/bench.notation.test.ts` turns each analysis into a score the same way the app does and compares it with the truth.

```sh
SF2=/path/to/GeneralUser-GS.sf2 PY=/path/to/engine-venv/bin/python BEAT=/path/to/beat_this.onnx ./tools/engine-bench/run.sh
```

Needs the engine's Python packages plus `tinysoundfont`, `soundfile` and `mir_eval`. `evaluate.py` scores raw note timing (mir_eval, 50 ms onset tolerance) for quick experiments on single models.
