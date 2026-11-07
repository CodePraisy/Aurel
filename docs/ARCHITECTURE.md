# Aurel: architecture, MVP and limits

## First usable MVP (this build)

The three home-screen workflows all open the same Studio. The Studio is a notation editor, mixer and practice player.

- **Library.** SQLite index plus one folder per project (`project.json`, audio, stems, analysis). Includes search, favorites, collections, recently opened, duplicate detection (SHA-256 / YouTube ID) and portable `.aurel` files (zip).
- **Saving and recovery.** Autosave runs 600 ms after every edit. Writes are atomic and the previous version is kept as `project.bak.json`. On startup the library re-indexes project folders, so a crash between writing a project and updating the index loses nothing.
- **Import.** Any audio or video FFmpeg can decode, by file picker, drag-and-drop or direct URL. Plus MIDI files and YouTube (see below). Original audio is stored as 44.1 kHz WAV.
- **Composition.** Multi-part scores (piano grand staff, guitars, bass, drums, voice, orchestral, synth). Supported:
  - Note entry by keyboard, mouse, fretboard, piano or USB MIDI keyboard.
  - Tab entry by fret number.
  - Drum step grid.
  - Durations, dots, ties, rests, chords, articulations, dynamics.
  - Bends, slides, hammer-ons, palm muting, harmonics, vibrato.
  - Alternate tunings and capo.
  - Copy, paste, duplicate, transpose, insert or delete measures.
  - Undo/redo (200 steps).
  - Time signature, key and tempo changes.
- **Views.** Sheet, tab, or both, for one part or the full score. Zoom.
- **Playback.** The transport is synced across MIDI parts and isolated audio stems. Features:
  - Mute, solo, volume and pan per part.
  - Audio/MIDI switch per part, plus a compare mode (recording left, MIDI right).
  - Speed 25–200%; recordings keep their pitch.
  - Saved loops, metronome, count-in, gradual tempo trainer.
  - Transposition (recordings are re-pitched with FFmpeg).
  - Click to seek, double-click to play from there.
  - Live fretboard and keyboard display.
- **VST3 instruments and effects, in real time.** See *Real-time plug-in audio* below.
- **MIDI keyboards.** USB or Bluetooth (via Windows), hot-plugged. Notes sound for as long as the key or sustain pedal is held, on the part's own instrument and plug-ins. Write mode enters them at the cursor; keys pressed within 60 ms form one chord. Device and channel filters in Settings → MIDI.
- **AI (engine 3).** The recording is split into instruments by **BS-RoFormer** (jarredou's six-stem "SW" weights, run from vendored MIT code in `engine/sep_roformer/`) on an NVIDIA GPU, or by Demucs on the processor (`htdemucs_6s` when guitar or piano are wanted, the fine-tuned 4-source model otherwise; *Best* combines both). Settings → Transcription → Instrument separation overrides the choice. Then each part gets a model made for it:
  - **Beats and bar lines:** Beat This! (CP JKU, ISMIR 2024) on the full mix, run through ONNX Runtime. Every note is placed on that beat grid, so a band that drifts from a click stays in time; the score gets tempo changes where the recording speeds up or slows down. Meter (3/4, 4/4, 6/8, 12/8) comes from the downbeats and how notes divide the beat; swing is detected and written straight.
  - **Piano and guitar:** Transkun 2 (transformer + semi-CRF), then a clean-up pass: instrument range, blips, notes much quieter than their neighbours (bleed), and strummed chords pulled onto one start. Guitar uses gentler blip and ghost limits than piano: on real guitar recordings the piano settings removed real fingerpicked notes. A fine-tuned Transkun checkpoint (`tools/train`) can replace the built-in one.
  - **Other instruments** (strings, winds, synths): Basic Pitch, with onset and length thresholds tuned on real string and wind recordings (Bach10).
  - **Bass and singing:** CREPE pitch tracking, cut into notes at pitch changes, silences and fresh attacks (level dips for the voice, low-band onsets for bass).
  - **Drums:** ADTOF (kick, snare, toms, hi-hat, cymbals). Its weights are CC BY-NC-SA; *Settings → Transcription → Drum transcription → Basic* uses band filters instead.
  - **Words:** Whisper; each word is then moved onto the sung note it belongs to.
  - **The parts, together** (engine 3):
    - *Bleed between stems:* a constant-Q spectrogram of every pitched stem shows where each note actually sounds. A note that another stem also has, and that is clearly louder there, is that instrument leaking through the separation and is removed; a note only one stem has is removed only if it is almost silent there.
    - *Key and chords:* chords are chosen beat by beat from all pitched parts (the bass weighs most for the root), smoothed with a Viterbi pass that prefers changes on bar lines and half bars; the key is the one whose chords explain the song best (tonic chord, first and last chord). Chord symbols are drawn over the score, shown live in the transport and exported to MusicXML as `<harmony>`.
    - *Chord-aware clean-up:* short, weak notes that fit neither the current nor the next chord are removed.
    - *Strum direction:* the order in which a strum's notes start (low strings first = down).
    - *Techniques:* on single-note guitar and bass lines, the CREPE pitch curve marks bends (with the amount), vibrato, slides and hammer-ons.
  - **Writing it down** (`music/beatgrid.ts`): each beat uses the simplest rhythm that explains its notes (quarter, 8ths, 16ths…), short gaps are held over, and chords share a start. A beat is written as **triplets** when its notes clearly sit on thirds of the beat (and not near sixteenths); triplets are drawn with VexFlow tuplets and exported with `<time-modification>`. These settings can be re-applied to a song without transcribing again.
  - Missing optional models fall back to Basic Pitch, librosa beats and band-filter drums, so older installs keep working; the next Transcribe offers the ~300 MB upgrade.
- **Export.**
  - WAV/MP3/FLAC rendered with the assigned sounds, or the isolated recordings.
  - MIDI, MusicXML (with string/fret data), PDF and ASCII tab.
  - Scope: whole song, a measure, a range, one instrument, or every instrument separately.
  - Sample rate, bit depth, mono/stereo, normalization and release tail.
  - **Export to DAW** folder: full mix, aligned stems, per-part MIDI, multitrack MIDI, MusicXML, PDF and a README.
- **UI.** Dark, Light and Sakura themes; accent colours; resizable panels; keyboard shortcuts; reduced-motion option.

## Not in this build (next milestones)

1. **Recorded parameter automation.** Plug-in controls can be changed live while playing, but changes are not yet recorded over time as automation lanes.
2. **User SF2/SFZ soundfonts.** Built-in sampled instruments now ship as downloadable packs (Salamander Grand Piano, MusyngKite GM set, acoustic kit) with a per-part effects chain (EQ, compressor, reverb, delay, chorus, amp/drive, filter, utility). Loading your own soundfonts is still to do.
3. **Guitar Pro (.gp) import/export, and MusicXML import.**
4. **Not supported in notation:** quintuplets and other tuplets beyond triplets (and typing triplets by hand), multiple voices per staff, repeats/voltas, and per-measure time-signature changes.
5. **Trained classifiers.** Lead/rhythm detection and acoustic-vs-electric classification need trained models; today these are heuristics.

## Realistic transcription quality

| Material | Expect |
|---|---|
| Bass lines, sung melodies, piano | Good first draft: most notes right, on the right beat |
| Clean or acoustic guitar chords | Usable chords; a few extra or missing inner notes |
| Distorted guitar, dense mixes, heavy reverb | Recognisable, still needs correcting |
| Drums | Kick, snare and hi-hat very reliable; toms and cymbals mostly right; ghost notes often missed |
| Rhythm | Follows the band's tempo bar by bar. Triplets are written where a beat is clearly played in three |
| Chords and key | Chord roots right in every bar of the test songs, major/minor/7th right in about 9 of 10; key signature right in 7 of 8 |
| Tab fingerings | Chosen by reading the whole line ahead (stay in a hand position, shift with the phrase), not detected from the recording: 62 % of notes on the same string and fret as the real tabs in the test set, up from 5 % |
| Techniques | Bends, vibrato, slides and hammer-ons on single-note lines; nothing inside chords; palm muting and harmonics are not detected |

### How it was measured

`tools/engine-bench` renders songs with exact ground truth (General MIDI soundfont, human timing, tempo drift, swing, 3/4 and 4/4), adds the kind of bleed and room sound a separation leaves behind (each stem carries 12–22 % of the other instruments), runs the real engine on the mix and those stems, and scores the *notation*: a note counts only if it is on exactly the right beat with exactly the right pitch.

| Part | Before (engine 1) | Now (engine 2) |
|---|---|---|
| Guitar | 0.22 | **0.82** |
| Bass | 0.20 | **0.80** |
| Drums | 0.33 | **0.98** |
| Piano | 0.08 | **0.72** |
| Sung melody | not written | **0.77** |
| Time signature right | 6 of 8 songs | **8 of 8** |

F1 score of notes on exactly the right beat with the right pitch (1.0 = perfect), 8 songs, simulated separation bleed. Engine 1 lost most notes to tempo drift: one rounded tempo for the whole song moves later bars off the beat.

Real recordings were used where annotated audio is available: on sung notes (Vocadito) CREPE note onsets scored 0.77 F1 against 0.53 for Basic Pitch. Beat This! found 97–100 % of beats in the test songs even with the drums removed.

### Research behind engine 3

- Separation: BS-RoFormer / Mel-RoFormer lead the music-separation leaderboards by several dB over HT-Demucs ([MVSEP algorithms](https://mvsep.com/en/algorithms), [2026 benchmark](https://dev.to/codesugar_lin_037a57b06a4/htdemucs-vs-bs-roformer-vs-spleeter-a-2026-audio-source-separation-benchmark-2ll8), [Lu et al.](https://arxiv.org/abs/2309.02612)). The six-stem "SW" weights score bass 14.6, drums 14.1, guitar 9.1 and piano 7.8 dB SDR on MVSEP's sets ([MVSEP news](https://mvsep.com/news/64?lang=en)).
- Guitar transcription improves most from guitar data in realistic conditions: synthesized tabs ([SynthTab](https://arxiv.org/abs/2309.09085)), amp and effect tones ([Pedroza et al.](https://arxiv.org/abs/2405.14679)), domain adaptation from piano models ([Riley et al., GAPS](https://arxiv.org/abs/2402.15258)), large Guitar Pro corpora ([DadaGP](https://arxiv.org/abs/2107.14653)). `tools/train` follows this: separated stems, random amp chains, optional Guitar Pro/MIDI songs, fine-tuning instead of training from scratch.
- Strum direction from the order of a strum's onsets, and chords transcribed together with notes ([Kim et al. 2025](https://arxiv.org/abs/2508.07973)).
- Multi-instrument models (YourMT3+, the 2025 AMT challenge winners) are much better than Basic Pitch on mixed instruments, but are GPL- or non-commercially licensed and large; they are a candidate for an optional download, not part of this build.

## Real-time plug-in audio

Each part that uses VST3 plug-ins gets its own `aurel-vst-host.exe serve` process, started when the piece opens and kept running until it closes. One process per part means a crashing plug-in takes down only that part's track.

- **Clock.** The AudioContext's frame counter is the only clock. Every event sent to a host carries the frame at which it must be heard: note on/off, all-notes-off, "start this stem file at frame F from offset O", and live audio input. An AudioWorklet (`stream-worklet.js`) plays each track's stream and asks its host for audio up to ~30 ms (or 4 buffers) ahead of the clock. Output blocks are stamped with their frame and written into a ring buffer by frame number, so plug-in tracks stay sample-locked to the metronome, the playhead and the other parts through pause, seek and loops.
- **Streaming path.** Audio goes host stdout → main process → a `MessagePort` that the renderer hands straight to the worklet, so it never waits on the UI thread. The worklet's requests travel the same port back.
- **Seek, pause, loop.** A reset with a new generation number drops the old timeline in the host and the worklet; late messages from the old generation are ignored. Loops release held notes and re-cue stems at the wrap frame. Nothing is rendered ahead of time, so Play after an edit starts immediately.
- **Latency compensation.** The host adds up its plug-ins' reported latency and stamps output that much earlier, discarding the pre-roll after a reset. Notes are scheduled far enough ahead to cover it.
- **Sources.** A part's chain is fed by (1) its VST3 instrument, (2) its recorded stem, converted once by FFmpeg to raw float audio at the playback speed and key, or (3) a built-in instrument. The built-in sound is played early by a fixed delay, captured in the worklet, and sent to the host stamped with the frame it must be heard at.
- **Order.** VST3 effects run first, then Aurel's built-in effects, in playback and export alike (`orderChain`).
- **Live editing.** The plug-in's own editor opens on the instance being heard, as a window owned by Aurel's. Changes are audible straight away (edits flow into the audio thread's parameter queue). When the window closes, the host saves the component and controller state, and Aurel stores it in the piece. That also happens if the piece was closed first. Quick controls change parameters live too. A part's chain is a per-piece copy; *Save as instrument default* writes it back to Settings → Default effects.
- **Reliability.** Host crashes are caught by an exception filter that names the plug-in. Aurel restarts the track without that plug-in (up to 3 times a minute), tells you which one crashed, and offers *Try again*. A host that stops answering for 4 s is restarted. Plug-ins that fail to load are named with their error and leave the part silent: Aurel never substitutes another sound. Failures are listed in Settings → Plug-ins. Idle tracks (no notes held, nothing queued, silent output) skip processing.
- **Export** renders through the same host code, faster than real time, with the same chain and saved state.
- **Tests.** `native/vst-host/test/protocol-test.cjs` drives the real host with the SDK's mda plug-ins (run under Wine on Linux). `tests/fixtures/mock-vst-host.cjs` stands in for the host so the Electron pipeline can be tested end to end on any OS (`AUREL_VST_HOST="node|tests/fixtures/mock-vst-host.cjs"`).

## Out-of-the-box setup

- First launch downloads all instrument sounds (~40 MB) and the YouTube importer (yt-dlp plus the Deno runtime it needs).
- The first Transcribe press installs the AI engine automatically: uv fetches a private Python 3.10, PyTorch (CUDA build when an NVIDIA GPU is present), Demucs, Basic Pitch and Whisper, then the per-instrument models (Transkun, CREPE, ADTOF, ONNX Runtime and the Beat This! model).
- Imports detect tempo, 3/4 vs 4/4 and the first downbeat immediately (JS autocorrelation); the AI engine refines it.

## Design decisions

- **One score model** (`src/shared/types.ts`) for transcriptions and compositions. MIDI and MusicXML are export formats generated from it, not internal formats. A purpose-built JSON model keeps editing simple and lossless (tab positions, techniques, AI confidence) and round-trips to both standards.
- **Measures are always full.** Edits overwrite time spans and re-fill gaps with rests, MuseScore-style. Durations that can't be written as one note become tied notes. This keeps engraving and playback consistent.
- **Python is a replaceable worker.** Each step (separate, classify, transcribe, drums, tempo) is its own function behind a JSON-lines protocol. Swapping a model doesn't touch the app.
- **Security.** Context isolation is on and the renderer has no Node access. A typed preload API is the only bridge. File access goes through `aurel://` URLs that are confined to project folders. The packaged app has a strict CSP. External links open only over https.
- **sql.js (WASM SQLite)** instead of a native SQLite module, so `npm install` on Windows needs no C++ build tools.
