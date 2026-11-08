"""Real-song test set: GuitarPro-rendered songs with their MusicXML (AlpacaGuitarSet open subset,
CC-BY-4.0) and Bach10 (real recordings of four players with score-aligned notes)."""
import json, os, glob
import numpy as np, soundfile as sf
from music21 import converter, chord

ALP = os.environ.get('ALPACA', 'alpaca-guitarset/data/open_subset')
B10 = os.environ.get('BACH10', 'Bach10_v1.1')
OUT = os.environ.get('OUT', 'songs')
os.makedirs(OUT, exist_ok=True)

def group(name):
    n = name.lower()
    if 'bass' in n: return 'bass'
    if 'guitar' in n: return 'guitar'
    if any(k in n for k in ('maracas', 'bongo', 'drum', 'perc')): return 'perc'
    return 'other'

for s in ('blur_of_life', 'starlight', 'tec'):
    sc = converter.parse(f'{ALP}/{s}/score/{s}.xml').toSoundingPitch()
    mm = sc.flatten().getElementsByClass('MetronomeMark')
    bpm = float(mm[0].number) if mm else 120.0
    notes = {}
    for p in sc.parts:
        g = group(p.partName or '')
        if g == 'perc': continue
        for el in p.flatten().notes:
            heads = el.notes if isinstance(el, chord.Chord) else [el]
            for h in heads:
                if h.tie is not None and h.tie.type in ('stop', 'continue'): continue
                item = {'beat': float(el.offset), 'p': int(h.pitch.midi), 'dur': float(el.quarterLength), 'part': p.partName}
                for t in h.articulations:
                    if t.classes[0] in ('StringIndication',): item['string'] = int(t.number)
                    if t.classes[0] in ('FretIndication',): item['fret'] = int(t.number)
                notes.setdefault(g, []).append(item)
    info = sf.info(f'{ALP}/{s}/audio/{s}.wav')
    beats = [i * 60 / bpm for i in range(int(info.duration * bpm / 60) + 2)]
    d = f'{OUT}/{s}'; os.makedirs(d, exist_ok=True)
    x, sr = sf.read(f'{ALP}/{s}/audio/{s}.wav', always_2d=True)
    sf.write(f'{d}/mix.wav', x.astype(np.float32), sr, subtype='PCM_16')
    json.dump({'meter': 4, 'bpm': bpm, 'beats': beats, 'notes': notes, 'source': 'AlpacaGuitarSet open subset (CC-BY-4.0)'}, open(f'{d}/truth.json', 'w'))
    print(s, bpm, {k: len(v) for k, v in notes.items()})

for folder in sorted(glob.glob(f'{B10}/[0-9]*')):
    name = 'bach10_' + os.path.basename(folder).split('-')[0]
    base = glob.glob(f'{folder}/*.txt')[0]
    rows = [list(map(float, l.split())) for l in open(base) if l.strip()]
    inst = {1: 'violin', 2: 'clarinet', 3: 'saxophone', 4: 'bassoon'}
    notes = [{'s': r[0] / 1000, 'e': r[1] / 1000, 'p': int(r[2]), 'inst': inst[int(r[3])]} for r in rows]
    d = f'{OUT}/{name}'; os.makedirs(d, exist_ok=True)
    x, sr = sf.read(f'{folder}/{os.path.basename(folder)}.wav', always_2d=True)
    sf.write(f'{d}/mix.wav', np.repeat(x, 2, axis=1).astype(np.float32) if x.shape[1] == 1 else x, sr, subtype='PCM_16')
    json.dump({'notes_time': notes, 'source': 'Bach10 v1.1 (Duan et al.)'}, open(f'{d}/truth.json', 'w'))
    print(name, len(notes))
