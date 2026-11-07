#!/bin/bash
# Run the engine on generated songs (mix + stems with simulated separation bleed), then score the notation.
#   SF2=path/to/GeneralUser-GS.sf2 PY=path/to/engine/python ./run.sh
set -e
HERE=$(cd "$(dirname "$0")" && pwd); ROOT=$(cd "$HERE/../.." && pwd)
PY=${PY:-python}; OUT=${OUT:-/tmp/aurel-bench}; BEAT=${BEAT:-$HOME/.aurel-models/beat_this.onnx}
$PY "$HERE/songgen.py" "$OUT/songs" ${SEEDS:-0 2 4 6 8 10 12 14}
$PY "$HERE/dirty.py" "$OUT/songs"
for d in "$OUT"/songs/song*; do
  s=$(basename "$d"); mkdir -p "$OUT/runs/$s"
  $PY "$ROOT/engine/aurel_engine.py" process --input "$d/mix.wav" --out "$OUT/runs/$s" --stems-dir "$d/dirty" \
    --beat-model "$BEAT" --quality "${Q:-balanced}" --words 0 --device "${DEVICE:-cpu}" > "$OUT/runs/$s/log.txt" 2>&1 || echo "$s failed"
done
cd "$ROOT" && BENCH_RUNS="$OUT/runs" BENCH_SONGS="$OUT/songs" npx vitest run tests/bench.notation.test.ts --disableConsoleIntercept --silent=false
