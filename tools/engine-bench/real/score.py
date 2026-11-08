"""Score engine runs on the real songs. Time-based note F1 (mir_eval: onset within 50 ms, pitch
within 50 cents; offsets ignored) per instrument group, plus pitch-class F1 for Bach10."""
import json, os, sys
import numpy as np, mir_eval

RUN = sys.argv[1]
SONGS = os.environ.get('SONGS', 'songs')
fam = lambda name: 'bass' if name.startswith('bass') else 'guitar' if name.startswith('guitar') else 'vocals' if name.startswith('vocal') else 'other'

def f1(ref, est):
    if not len(ref) or not len(est): return 0.0, 0.0, 0.0
    ri = np.array([[r[0], r[0] + max(0.05, r[1] - r[0])] for r in ref]); rp = mir_eval.util.midi_to_hz(np.array([r[2] for r in ref]))
    ei = np.array([[e[0], e[0] + max(0.05, e[1] - e[0])] for e in est]); ep = mir_eval.util.midi_to_hz(np.array([e[2] for e in est]))
    p, r, f, _ = mir_eval.transcription.precision_recall_f1_overlap(ri, rp, ei, ep, offset_ratio=None, onset_tolerance=0.05)
    return p, r, f

tot = {}
rows = []
for s in sorted(os.listdir(RUN)):
    ap = f'{RUN}/{s}/analysis.json'
    if not os.path.exists(ap): continue
    a = json.load(open(ap)); t = json.load(open(f'{SONGS}/{s}/truth.json'))
    est = {}
    for name, notes in a.get('notes', {}).items():
        est.setdefault(fam(name), []).extend((n['s'], n['e'], n['p']) for n in notes)
    if 'notes_time' in t:
        ref = {'all': [(n['s'], n['e'], n['p']) for n in t['notes_time']]}
        est = {'all': [x for v in est.values() for x in v]}
    else:
        spb = 60 / t['bpm']
        ref = {g: [(n['beat'] * spb, (n['beat'] + n['dur']) * spb, n['p']) for n in v] for g, v in t['notes'].items()}
        # the separator may put a guitar in "other" or "piano": also score every pitched non-bass note together
        ref['pitched'] = [x for g, v in ref.items() if g != 'bass' for x in v]
        est['pitched'] = [x for g, v in est.items() if g not in ('bass', 'vocals') for x in v]
    for g, r in ref.items():
        p, rc, f = f1(r, est.get(g, []))
        rows.append(f'{s:14s} {g:7s} F1 {f:.3f} (P {p:.2f} R {rc:.2f})  ref {len(r)} est {len(est.get(g, []))}')
        k = 'bach10' if s.startswith('bach10') else g
        T = tot.setdefault(k, [0, 0, 0]); T[0] += p * len(est.get(g, [])); T[1] += rc * len(r); T[2] += 0
        T.append((len(r), len(est.get(g, []))))
print('\n'.join(rows))
for k, T in tot.items():
    nr = sum(x[0] for x in T[3:]); ne = sum(x[1] for x in T[3:])
    P = T[0] / max(1, ne); R = T[1] / max(1, nr)
    print(f'TOTAL {k:7s} F1 {2 * P * R / max(1e-9, P + R):.3f}  (P {P:.2f} R {R:.2f})')
