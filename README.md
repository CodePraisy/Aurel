# Aurel

**Desktop studio for AI music transcription, notation and practice.**

Aurel separates a recording into instrument stems (vocals, drums, bass, guitar, piano, other) and transcribes each stem into standard notation and guitar tablature. It also gives you a synchronized practice player, a full score editor, and real-time hosting for VST3 instruments and effects on Windows. Projects, audio and AI processing all stay on your machine.

## Download — v0.4.1

- [`Aurel-0.4.1-Windows-x64.exe`](https://github.com/CodePraisy/Aurel/releases/download/v0.4.1/Aurel-0.4.1-Windows-x64.exe) (Windows 10/11, 64-bit — installer, recommended)
- [`Aurel-0.4.1-Windows-x64-Portable.exe`](https://github.com/CodePraisy/Aurel/releases/download/v0.4.1/Aurel-0.4.1-Windows-x64-Portable.exe) (Windows 10/11, 64-bit — portable, no installation)
- [`Aurel-0.4.1-macOS-arm64.zip`](https://github.com/CodePraisy/Aurel/releases/download/v0.4.1/Aurel-0.4.1-macOS-arm64.zip) (Mac with Apple silicon)
- [`Aurel-0.4.1-macOS-x64.zip`](https://github.com/CodePraisy/Aurel/releases/download/v0.4.1/Aurel-0.4.1-macOS-x64.zip) (Mac with an Intel processor)

[Release notes and source archives](https://github.com/CodePraisy/Aurel/releases/tag/v0.4.1)

To check which Mac you have, choose **Apple menu → About This Mac**. **Chip: Apple M…** means Apple silicon. **Processor: Intel** means Intel.

**System requirements**

- Windows 10 or 11 (64-bit), or macOS 13 Ventura or later.
- About 8 GB of free disk space for the AI transcription engine and its models.
- An NVIDIA GPU is optional. With one, transcription uses CUDA; without one, it runs on the CPU and is slower.

## Installation

### Windows (installer)

1. Download `Aurel-0.4.1-Windows-x64.exe` and run it.
2. If Microsoft Defender SmartScreen shows **"Windows protected your PC"**, select **More info → Run anyway**. The warning appears because the build is not yet code-signed.
3. Complete the setup wizard; the defaults are fine. During installation, the AI transcription engine is downloaded and configured (one-time, 3–5 GB), so an internet connection is required. If this step is interrupted, Aurel still installs, and you can finish later from **Settings → AI Engine**.
4. Launch **Aurel** from the Start menu or the desktop shortcut.

### Windows (portable)

Download `Aurel-0.4.1-Windows-x64-Portable.exe` and run it from any folder or a USB drive. Nothing is installed. The SmartScreen note above also applies. The AI engine is set up the first time you transcribe.

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
- **Transcription:** stem separation, note transcription, and tempo, meter and downbeat detection. Results are quantized into editable notation and tablature.
- **Practice:** speed from 25% to 200% with pitch preserved, saved loops, a gradual tempo trainer, metronome and count-in, transposition, a follow-along cursor, and an **Original / Transcription** playback switch.
- **Notation editor:** multi-part scores, tab, drum step grid, chords with adjustable arpeggio direction and spacing, articulations and techniques, alternate tunings and capo, and 200-step undo. Enter notes with the keyboard, the mouse, an on-screen piano or fretboard, or a USB MIDI keyboard.
- **Sound:** sampled instruments with a per-part effects chain. You can add instruments made from your own samples and use them in any part, or in place of a built-in sound. On Windows, installed VST3 instruments and effects (for example Kontakt or Guitar Rig) run in real time with their native editors.
- **Export:** WAV, MP3, FLAC, MIDI, MusicXML (MuseScore, Sibelius, Finale), PDF and ASCII tab, plus a DAW-ready folder of aligned stems.
- **Sessions:** every piece you open stays in the sidebar, so you can switch between transcriptions and compositions. Drag them to reorder or into folders.
- **Editing:** drag notes to move them (up or down changes pitch, Ctrl copies). Delete either leaves a rest or shifts the following notes back. Type the number of bars; Aurel warns before removing bars that have notes. Tap tempo.
- **Looping:** loop the whole piece, the selected bars, or typed bar numbers, and save named sections like "Chorus".
- **Interface:** Dark, Light and Sakura themes, with floating notes in the background (adjustable in **Settings → Appearance**).
- **Updates:** Aurel checks for a new release at startup and asks before installing. To check manually or turn off automatic checks, open **Settings → About & limits**.

---

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

Demucs separates the recording into vocals, drums, bass, guitar, piano and other. The vocal stem is then cleaned so it holds only the singers: what is left of the band is filtered out, and passages without singing are silent. Basic Pitch turns each part into notes. Tempo, time signature and the first beat are detected, and the notes are lined up to a 16th-note grid as editable notation and tab. Aurel uses an NVIDIA graphics card when one is available, otherwise the processor.

What to expect:

| Material | Result |
|---|---|
| Bass lines, sung melodies, clear lead lines | A good first draft |
| Clean guitar or piano chords | Usable chords, with some extra or missing notes |
| Distorted guitar, dense mixes, heavy reverb | A rough sketch to correct |
| Drums | Kick, snare, hi-hat and cymbal timing is usually right; toms and ghost notes are often missed |
| Rhythm | One tempo per song; swing, triplets and tempo changes are not detected |

The AI engine can be installed ahead of time in **Settings → AI Engine**.

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
- **About & limits:** installed version, automatic update checks and **Check now**.

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
| `engine/aurel_engine.py` | Demucs separation, Basic Pitch transcription, drum and tempo analysis |

### How it works

- **One score model** is used for every project. MIDI and MusicXML are export formats generated from it.
- **Real-time plug-ins.** Each part that uses VST3 plug-ins has its own host process, which stays loaded while the piece is open. The audio clock is the only clock: every note and audio block carries the exact sample frame it belongs to. That keeps plug-in tracks in sync with the metronome and the other parts through pause, seek and loops, and plug-in latency is compensated. Export uses the same host code.
- **Security.** The renderer has no Node access. A typed preload API is the only bridge, file access is confined to project folders, and the packaged app has a strict content security policy.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full design, the transcription quality limits, and what is not built yet.
