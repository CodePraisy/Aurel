# Aurel

**Desktop studio for AI music transcription, notation and practice.**

Aurel separates a recording into instrument stems (vocals, drums, bass, guitar, piano, other) and transcribes each stem into standard notation and guitar tablature. It also gives you a synchronized practice player, a full score editor, and real-time hosting for VST3 instruments and effects on Windows. Projects, audio and AI processing all stay on your machine.

## Download — v0.6.2

- [`Aurel-0.6.2-Windows-x64.exe`](https://github.com/CodePraisy/Aurel/releases/download/v0.6.2/Aurel-0.6.2-Windows-x64.exe) (Windows 10/11, 64-bit — installer, recommended)
- [`Aurel-0.6.2-Windows-x64-Portable.exe`](https://github.com/CodePraisy/Aurel/releases/download/v0.6.2/Aurel-0.6.2-Windows-x64-Portable.exe) (Windows 10/11, 64-bit — portable, no installation)
- [`Aurel-0.6.2-macOS-arm64.zip`](https://github.com/CodePraisy/Aurel/releases/download/v0.6.2/Aurel-0.6.2-macOS-arm64.zip) (Mac with Apple silicon)
- [`Aurel-0.6.2-macOS-x64.zip`](https://github.com/CodePraisy/Aurel/releases/download/v0.6.2/Aurel-0.6.2-macOS-x64.zip) (Mac with an Intel processor)

[Release notes and source archives](https://github.com/CodePraisy/Aurel/releases/tag/v0.6.2)

To check which Mac you have, choose **Apple menu → About This Mac**. **Chip: Apple M…** means Apple silicon. **Processor: Intel** means Intel.

**System requirements**

- Windows 10 or 11 (64-bit), or macOS 13 Ventura or later.
- About 8 GB of free disk space for the AI transcription engine and its models.
- An NVIDIA GPU is optional. With one, transcription uses CUDA; without one, it runs on the CPU and is slower.

## Installation

### Windows (installer)

1. Download `Aurel-0.6.2-Windows-x64.exe` and run it.
2. If Microsoft Defender SmartScreen shows **"Windows protected your PC"**, select **More info → Run anyway**. The warning appears because the build is not yet code-signed.
3. Complete the setup wizard; the defaults are fine. During installation, the AI transcription engine is downloaded and configured (one-time, 3–5 GB), so an internet connection is required. If this step is interrupted, Aurel still installs, and you can finish later from **Settings → AI Engine**.
4. Launch **Aurel** from the Start menu or the desktop shortcut.

### Windows (portable)

Download `Aurel-0.6.2-Windows-x64-Portable.exe` and run it from any folder or a USB drive. Nothing is installed. The SmartScreen note above also applies. The AI engine is set up the first time you transcribe.

### macOS

1. Download the `.zip` for your processor and open it to extract **Aurel.app**.
2. Move **Aurel.app** to **Applications**.
3. On first launch, Control-click (or right-click) Aurel, choose **Open**, then confirm with **Open**. This is required once because the build is not yet notarized by Apple.
4. If macOS reports that **"Aurel is damaged and can't be opened"**, remove the download quarantine flag in Terminal, then launch the app again:

   ```sh
   xattr -cr /Applications/Aurel.app
   ```

### First launch

- Instrument sample libraries (about 40 MB) download in the background. Aurel is usable immediately.
- If the AI engine was not set up during installation (portable build or macOS), it installs automatically the first time you press **Transcribe**. This is a one-time 3–5 GB download that includes a private Python runtime, PyTorch, Demucs and Basic Pitch; nothing needs to be installed manually. Transcription then works offline.
- Aurel has no accounts and no telemetry.

## Features

- **Import:** MP3, WAV, FLAC, M4A, OGG and video files, by drag-and-drop or file picker. You can also import from a YouTube link, a direct URL, or a MIDI file.
- **Transcription:** separates the instruments (BS-RoFormer on an NVIDIA GPU, Demucs otherwise), finds every beat and bar line, and uses a model made for each instrument (piano and guitar, bass, singing, drums). The parts are checked against each other, chord symbols and the key are found, and notes are written on the band's own beat with the simplest rhythm that fits, including triplets, strum directions, bends, slides and vibrato. Choose Fast, Balanced or Best, and how many notes to keep, in **Settings → Transcription**.
- **Practice:** speed from 25% to 200% with pitch preserved, saved loops, a gradual tempo trainer, metronome and count-in, transposition, a follow-along cursor, and an **Original / Transcription** playback switch.
- **Notation editor:** multi-part scores, tab, drum step grid, chords with adjustable arpeggio direction and spacing, articulations and techniques, alternate tunings and capo, and 200-step undo. Enter notes with the keyboard, the mouse, an on-screen piano or fretboard, or a USB MIDI keyboard.
- **Sound:** sampled instruments with a per-part effects chain. You can add instruments made from your own samples and use them in any part, or in place of a built-in sound. On Windows, installed VST3 instruments and effects (for example Kontakt or Guitar Rig) run in real time with their native editors.
- **Export:** WAV, MP3, FLAC, MIDI, MusicXML (MuseScore, Sibelius, Finale), PDF and ASCII tab, plus a DAW-ready folder of aligned stems.
- **Sessions:** every piece you open stays in the sidebar, so you can switch between transcriptions and compositions. Drag them to reorder or into folders.
- **Editing:** drag notes to move them (up or down changes pitch, Ctrl copies). Delete either leaves a rest or shifts the following notes back. Type the number of bars; Aurel warns before removing bars that have notes. Tap tempo.
- **Looping:** loop the whole piece, the selected bars, or typed bar numbers, and save named sections like "Chorus".
- **Interface:** Dark, Light and Sakura themes, with floating notes in the background (amount, speed and size in **Settings → Appearance**). Settings has a search box (**Ctrl+F**) that shows where each setting lives.
- **Updates:** Aurel checks for a new release at startup and asks before installing. To check manually or turn off automatic checks, open **Settings → About & limits**.

---

## What’s new in v0.6.2

Click the existing guitar, piano, or other instrument icon to choose its color; the extra color dot is removed. Custom colors now carry through the icon tile, selected track, volume slider, fretboard strings and markers, and played keyboard keys. Click the instrument name to select its sheet. Song-information and other popups render above the editor with an opaque background and stay inside the window, including at different interface sizes.

## What’s new in v0.6.1

Deleted songs no longer leave placeholder sessions, including when the library is empty. Stale saved tabs and navigation history are cleaned up. Instrument colors can be changed from their color dot, right-click menu, or instrument menu, using a palette or custom color; paired piano staves stay consistent, and Use theme color restores the default. Colors are saved with each piece and appear on its notation.

YouTube transcriptions show the original video link in song information (click the title). Copy or open it there, or right-click the title or a song in the library to copy its original link. Existing saved YouTube source links are supported.

## What’s new in v0.6.0

Better models, models that work together, and a nicer studio.

- **BS-RoFormer separation** on NVIDIA GPUs: the six-instrument RoFormer splits bass and drums about 4–5 dB more cleanly than Demucs on our real test song (bass 14.0 vs 9.8 dB SDR, drums 14.3 vs 9.6). Demucs stays the default on the processor, where RoFormer is about 18× slower. Choose in **Settings → Transcription → Instrument separation**.
- **The parts check each other:** a note that another instrument's stem also has, and plays much louder, is that instrument leaking through the separation and is removed (on real Bach chorales: note F1 0.556 → 0.600 and 0.474 → 0.545). Bass is left out of this check, because bass and guitar often double a riff.
- **Chord symbols and the key:** chords are found beat by beat from every part and printed over the score, shown live in the transport while you play, and exported to MusicXML. The key signature now comes from the chords (right in 7 of 8 test songs, up from 4). Chord roots were right in every test bar.
- **Triplets** are written where a beat is clearly played in three (and exported to MusicXML).
- **Strum arrows** (down or up) over guitar chords, and **bends, vibrato, slides and hammer-ons** found on single-note guitar and bass lines.
- **Better notes on real music:** gentler guitar clean-up (real guitar songs: note F1 0.486 → 0.625; it had been deleting real fingerpicked notes), Basic Pitch retuned for strings, winds and synths, and a better piano clean-up on the generated test songs (0.72 → 0.81).
- **Tab fingering** reads the whole line ahead and stays in a hand position: 62 % of notes on the same string and fret as real tabs, up from 5 %.
- **Chord boxes:** click the chord in the transport to see every chord of the song as a guitar chord diagram.
- **Lyrics:** Whisper Medium and Large v3 Turbo, Whisper on the GPU when there is one, and no words invented over long instrumental passages.
- **Train your own note model** on an RTX 3050 (6 GB) or better with `tools/train` (see its README), and use it in **Settings → Transcription → Custom note model**.
- **Arrow keys work everywhere:** they move between cards, buttons and rows on every page, and in the studio they move the note cursor even right after you touched a slider or a picker, before anything is selected, and across empty bars. Keyboard focus is now visible.
- **Studio look:** instrument colours, glowing selection, a paper-like score, a glassy transport with the current chord, the played part of the waveform highlighted, and small animations throughout, in all three themes.
- **New settings:** instrument separation, bleed removal, chords and key, chord-aware clean-up, triplets, playing techniques, strum arrows, chord symbols, custom note model, two larger lyrics models.
- **Fixes:** the waveform playhead could appear outside the waveform; the arrow keys stopped working after using a slider, picker or empty bar; the 6-instrument separation model downloaded on the first transcription instead of during setup.
- **Tested on real music** with known scores: Bach10 (real recordings of four players) and the open AlpacaGuitarSet songs. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## What’s new in v0.5.0

A rebuilt transcription engine.

- **Beat and bar lines** come from Beat This! (ISMIR 2024) running on the whole mix. Notes are placed on the band's own beat, so the score keeps time when the band speeds up or slows down; tempo changes are written where needed. 3/4, 4/4, 6/8 and 12/8 are detected, and swing is written as straight eighths.
- **A model for each instrument:** Transkun for piano and guitar, CREPE for bass and singing, ADTOF for drums (kick, snare, toms, hi-hat, cymbals). Strummed chords become one chord, and bleed from other instruments is filtered out.
- **Rhythm that reads like a person wrote it:** each beat uses the simplest rhythm that fits what was played, and tiny rests between notes are held over.
- **Lyrics line up with the music:** each word is moved onto the note it is sung on and drawn under that beat. Turn on **Write the singer’s melody** to get the vocal line as notes, with the words under it.
- **Settings → Transcription:** quality (Fast, Balanced, Best), a note sensitivity slider, rhythm detail, tempo mode, chord size, drum model and the lyrics model and language. **Apply** rewrites an open song with new settings without transcribing again.
- **Settings search** with the page each setting is on, plus new appearance options. A step-by-step progress panel shows what the engine is doing.
- On our benchmark (songs with exact ground truth and simulated separation bleed), the share of notes written on exactly the right beat with the right pitch (F1) went from 0.22 to 0.82 for guitar, 0.20 to 0.80 for bass, 0.33 to 0.98 for drums and 0.08 to 0.72 for piano, and the sung melody scores 0.77. Details in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

Existing installs add the new models (about 300 MB) the next time you press Transcribe.

## What’s new in v0.4.8

Lyrics now sit directly beneath each row of sheet music, sharing its scroll instead of occupying a separate timeline. Switch between Staff and Lyrics views: Lyrics shows large phrase-based words, highlights the current word, and follows playback. Click any word to seek; each word in Lyrics view shows its precise recording timestamp (for example, 0:32.334). Recognized words remain editable, and Singer tracks continue to play the original isolated vocal recording.

## What’s new in v0.4.7

Singer tracks play the isolated vocal recording and show recognized words on a beat-aligned lyric timeline. They generate no vocal MIDI notes. Click words to seek and use Edit words to correct the text. Whisper runs locally; its dependency and multilingual base model are prepared by AI-engine setup, including the Windows installer. Older recordings need re-transcription to produce words.

Choir is removed from new instrument and sound choices. Existing saved parts remain readable. The default separator for new installations is fine-tuned four-stem Demucs (vocals, bass, drums, and music). Six-source separation is used when guitar or piano is explicitly requested. Fine-tuned separation is slower than the standard model. Singing recognition and separation can contain errors.

## What’s new in v0.4.6

Downloads open a recording with instrument selection buttons. Choose instruments or Detect automatically, then press Start transcription. Import completion always waits for this explicit action, including installations with the older automatic-transcription setting enabled.

## What’s new in v0.4.5

Transcription progress aligns with its bar. YouTube previews and imports validate the current link consistently. Before transcribing, select source groups and instrument types or use automatic detection. Leading empty bars are omitted, and playback skips the removed introduction. PDF export offers score size, bar spacing, and a preview in your PDF viewer.

Windows releases rebuild the VST3 helper from source and require a successful Defender scan before packaging.

## What’s new in v0.4.4

Arrow keys switch Settings categories immediately. On Home and in the main sidebar, use the arrow keys to move and Enter to open the focused item.

## What’s new in v0.4.3

Use the arrow keys to navigate menus and dropdowns. In context menus, Right opens a submenu and Left goes back. Reduce motion now freezes the floating notes immediately and follows the system motion preference.

## What’s new in v0.4.2

The About screen credits Praise Onuoha.

## What’s new in v0.4.1

On Windows, opening a VST3 effect editor from Studio keeps playback running and edits the effect on the live track.

## What’s new in v0.4.0

- **Sessions in the sidebar.** Every transcription and composition you open stays in the sidebar until you close it, with its undo history. Make folders, drag pieces between them, and collapse the sidebar to icons. The Back buttons are gone.
- **Editing.** Drag a note to move it; drag up or down to change its pitch, hold Ctrl to copy. Delete can leave a rest or shift the following notes back (**Settings → Editor**; Shift+Delete does the other one, and the right-click menu offers both). Type the number of bars at the bottom right; Aurel warns before removing bars that contain notes. **Tap tempo** in the tempo dialog and in New composition.
- **Looping.** The loop button opens a panel: whole piece, the selected bars, the current bar, typed bar numbers, and named sections. The loop is shown on the progress bar.
- **Playback cursor** moves smoothly and keeps time with each note and rest, including on 16th notes.
- **VST3.** Notes entered on a VST3 part sound right away, even before you first press Play. An imported VST3 instrument can replace a built-in sound everywhere, and a part's sound menu lists your VST3 instruments.
- **Instrument names** follow the instrument when you change it, unless you renamed the part yourself.
- **Vocals.** The vocal stem is cleaned to hold only the singers.
- **Look and feel.** Grey backgrounds with floating notes and rests in the accent colour; the amount is set in **Settings → Appearance** (high values turn red, as they can slow older computers). New sidebar, and animations for pages, dialogs, menus and lists. Dialogs now dim the whole window, and right-click menus stay clear of the window edges.
- **Fixes.** The instruments list in Studio scrolls and no longer clips the first instrument.

## What’s new in v0.3.0

- **Background jobs** run side by side for different recordings. Click a download or transcription card to see its progress, then open the recording or score from there. Repeated transcription requests for the same project share one job.
- **Transcription** offers **Detect automatically** or a choice of vocals, drums, bass, guitar, piano or other instruments. The choices filter the separated tracks. Detected BPM uses whole numbers. Open the tempo control to restore the detected BPM or choose whether tempo edits also change the speed of the recording.
- **Studio** has a shared **Audio / MIDI** control at the bottom of transcription projects. With a part soloed, Audio plays its isolated stem and MIDI plays its notes. Parts without an isolated stem are silent in Audio solo mode. The transport also offers saved loops and up to four bars of count-in.
- **Composing** supports **Ctrl+S** (or **Cmd+S** on Mac), live title and composer edits, and cover photos from the project’s cover or the library context menu. The score adds space around high and low notes. In **Settings → Editor**, choose whether new piano, E-Piano and organ parts default to one or two staves.
- **Guitar and bass** support custom open-string pitches. **Suggest tuning** ranks compatible presets by how playable the written notes are.
- **VST3 on Windows** can use installed instruments as named presets with an instrument type under **Settings → Instrument sounds → Your instruments**. In Studio, double-click a VST3 track’s name or open its context menu to edit the plug-in. **Settings → Default effects** plays major and minor scales in a random key through the draft chain, with a Stop button.
- **Appearance** adds floating musical notes and rests to Dark and Light, and a moonlit cherry-blossom scene to Sakura. **Settings → Appearance → Reduce motion** applies across all themes.
- **Updates** are checked on first launch and at startup by default. The small version widget at the bottom left can also check on demand and offers to install a newer release when a compatible download is available.

## Features in more detail

### Transcription

1. **Separation.** On an NVIDIA GPU, BS-RoFormer splits the recording into vocals, drums, bass, guitar, piano and the rest. On the processor, Demucs does it (six sources, or four when guitar and piano aren't wanted); **Best** runs two Demucs models and keeps the cleanest of each.
2. **Beats.** Beat This! finds every beat and downbeat in the full mix, even in songs without drums. The meter (3/4, 4/4, 6/8, 12/8), the tempo of every bar and any swing come from it.
3. **Notes.** Transkun (piano and guitar), CREPE (bass and singing) and ADTOF (drums) each handle the part they are best at. A clean-up pass removes notes outside the instrument's range, blips, and quiet bleed from other instruments, and pulls each strummed chord onto one start.
4. **The parts together.** A note one stem shares with a louder stem is removed as bleed; chords and the key come from all parts; weak notes outside the chords go; strum direction and playing techniques are marked.
5. **Words.** Whisper recognises the singer's words, and each word is moved onto the sung note it belongs to.
6. **Notation.** Every note is placed on the beat grid. Each beat gets the simplest rhythm that explains it, short gaps are held over, and the score gets a tempo change wherever the band drifts, so it stays in sync with the recording.

Everything runs on your computer, on an NVIDIA graphics card when there is one.

What to expect:

| Material | Result |
|---|---|
| Bass lines, sung melodies, piano | A good first draft: most notes right, on the right beat |
| Clean or acoustic guitar chords | Usable chords, with a few extra or missing inner notes |
| Distorted guitar, dense mixes, heavy reverb | Recognisable, still needs correcting |
| Drums | Kick, snare and hi-hat very reliable; toms and cymbals mostly right; ghost notes often missed |
| Rhythm | Follows the band's tempo bar by bar; triplets are written where a beat is clearly in three |
| Chords and key | Chord roots right in every test bar; the quality (major, minor, 7th) in about 9 of 10 |

**Settings → Transcription** sets the quality, how many notes to keep, rhythm detail, the tempo mode, the drum model and the lyrics model and language. The ADTOF drum model is licensed for non-commercial use; **Basic** drums use band filters instead. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for how quality was measured.

### VST3 instruments and effects (Windows)

Aurel uses the VST3 plug-ins already installed on your computer. In **Settings → Plug-ins** you can add extra folders, rescan, switch plug-ins on or off, and see any that failed to load.

- **A VST3 instrument for a part.** Open the part's **Sound & effects** and choose **Use a VST3 instrument…**. Note entry, the on-screen keyboard, a MIDI keyboard, playback and audio export all use the plug-in's own sound and preset.
- **Effects.** Any part can have VST3 effects and built-in effects, including recorded stems and built-in instruments. VST3 effects run first, then built-in ones. **Settings → Default effects** holds each built-in instrument's default chain. Changing a part's chain makes a copy for that piece only.
- **Editing.** **Open plug-in editor** opens the plug-in's own window on the copy you are hearing, so you hear changes straight away. Its settings are saved into the piece when you close the window.
- **Safety.** Plug-ins run live, in a separate helper program for each part. If a plug-in crashes, Aurel tells you which one, and only that part reloads.

### MIDI keyboards

Plug in a USB MIDI keyboard, or pair a Bluetooth one in Windows; it is picked up automatically. Notes sound for as long as you hold the key or the sustain pedal. In **Write** mode they are added to the score at the cursor, and keys pressed together become a chord. Pick the device, channel and which part it plays in **Settings → MIDI**.

### Your own instruments

In **Settings → Instrument sounds → Your instruments**, choose one or more audio files (WAV, AIFF, FLAC, MP3, OGG or M4A). Aurel reads each sample's root note from its file name, such as `Piano C4.wav` or `Bass_A#2.wav`, and you can change it. Notes between samples are re-pitched from the nearest one. Pick the instrument in any part's **Sound & effects**, or set **Use everywhere instead of** to replace a built-in sound in every piece. Imported VST3 instruments can replace a built-in sound everywhere in the same way.

### Settings

- **Audio device:** output, sample rate, buffer size and the measured latency.
- **MIDI:** input device, channel, which part the keyboard plays, and Write notes or Play only.
- **Plug-ins:** search folders, rescan, turn plug-ins on or off, and a list of failed plug-ins.
- **Playback:** count-in, metronome volume, solo follows track selection, and whether reverb and delay ring out after you stop.
- **Transcription:** quality, note sensitivity, rhythm detail, tempo mode, notes per guitar chord, drum model, singer's words and melody, and **Apply** to rewrite an open song.
- **About & limits:** installed version, automatic update checks and **Check now**.
- **Search:** press **Ctrl+F** (or **/**) in Settings and type; each result shows which page it is on.

### YouTube import

The first time you import from YouTube, Aurel downloads its own copy of yt-dlp. **Settings → Import** can update it. Aurel never signs in to YouTube or uses cookies. You are responsible for the content you download; see **Settings → Terms & privacy**.

### Platform differences

| | Windows | Mac |
|---|---|---|
| Transcription, practice, notation, export | Yes | Yes |
| VST3 plug-ins | Yes | Not yet |
| AI engine set up during install | Yes (installer) | Set up the first time you press Transcribe |
| Signed by the publisher | Not yet ("Run anyway") | Not yet (right-click → Open) |

---

## For developers

### Run from source

Requires **Node.js 22.12+** (nodejs.org, LTS).

On Windows, double-click **`Aurel.bat`**. It installs dependencies the first time (and whenever `package.json` changes), then starts the app.

From a terminal:

```powershell
npm install
npm run dev        # development with hot reload
npm start          # production build, then run
npm test           # unit tests
npm run typecheck
npm run dist       # Windows installer into release/
npm run dist:mac   # Mac .zip into release/ (on a Mac)
```

To publish a release, set `version` in `package.json`, then run the **Build release downloads** workflow from the Actions tab (or push a matching tag such as `v0.3.1` for version `0.3.1`). It creates the release if needed, builds the Windows installer, the Windows portable app and both Mac packages, and attaches them. Installed copies of Aurel then offer the update. Update checks use the public GitHub API, so the repository's releases must be public for them to find anything.

To rebuild the VST3 helper (`build/vst-host/aurel-vst-host.exe`), run `powershell -File native/vst-host/build.ps1` with Visual Studio 2022 (C++ workload) and CMake installed. `native/vst-host/test/protocol-test.cjs` tests it against real plug-ins.

### Project layout

| Path | What |
|---|---|
| `src/main` | Electron main process: library (SQLite via sql.js), FFmpeg import and convert, YouTube, AI job runner, VST3 host sessions, PDF and export, `aurel://` file protocol |
| `src/preload` | The only bridge to the renderer (context-isolated, typed in `src/shared/api.ts`) |
| `src/shared/types.ts` | Score and project data model |
| `src/renderer/src/music` | Notation logic: measures, quantization, tab fingering, MIDI, MusicXML, ASCII tab, WAV |
| `src/renderer/src/notation` | VexFlow engraving (staff, tab, percussion) |
| `src/renderer/src/audio` | Built-in instruments, synced transport, real-time VST3 streaming (AudioWorklet), MIDI input, offline render |
| `native/vst-host` | C++ VST3 host: one real-time process per part, plus the plug-in editor window |
| `engine/aurel_engine.py` | Separation, beat grid, per-instrument transcription (Transkun, CREPE, ADTOF, Basic Pitch), words |
| `tools/engine-bench` | Generates songs with exact ground truth and scores the engine's notation |

### How it works

- **One score model** is used for every project. MIDI and MusicXML are export formats generated from it.
- **Real-time plug-ins.** Each part that uses VST3 plug-ins has its own host process, which stays loaded while the piece is open. The audio clock is the only clock: every note and audio block carries the exact sample frame it belongs to. That keeps plug-in tracks in sync with the metronome and the other parts through pause, seek and loops, and plug-in latency is compensated. Export uses the same host code.
- **Security.** The renderer has no Node access. A typed preload API is the only bridge, file access is confined to project folders, and the packaged app has a strict content security policy.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full design, the transcription quality limits, and what is not built yet.
