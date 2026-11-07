#!/bin/bash
# Run the engine with real separation on the real test songs (see README): one analysis.json each.
#   PY=engine-venv/bin/python BEAT=beat_this.onnx TAG=demucs MODEL=htdemucs_6s ./run.sh $(ls songs)
#   TAG=roformer MODEL=bs_roformer_sw ROFORMER=models ./run.sh $(ls songs)
#   python score.py runs/demucs
here=$(cd "$(dirname "$0")" && pwd)
ENG="$here/../../../engine/aurel_engine.py"
for s in "$@"; do
  d=$here/songs/$s; o=$here/runs/${TAG:-new}/$s; mkdir -p "$o"
  "${PY:-python}" "$ENG" process --input "$d/mix.wav" --out "$o" --model "${MODEL:-htdemucs_6s}" ${ROFORMER:+--roformer-dir "$ROFORMER"} ${BEAT:+--beat-model "$BEAT"} --quality "${Q:-balanced}" --words 0 --device "${DEVICE:-cpu}" $EXTRA > "$o/log.txt" 2>&1
  echo "$s $(tail -1 "$o/log.txt" | head -c 160)"
done
