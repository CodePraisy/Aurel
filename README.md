# Aurel

**Turn any song into sheet music and guitar tab, then practice it, edit it, or write your own.**

Aurel listens to a song, separates the instruments (vocals, drums, bass, guitar, piano), writes down the notes for each one, and lets you play along at any speed. You can also start from a blank page and compose.

## Download

| Your computer | Download |
|---|---|
| **Windows 10 or 11** (most people) | [**Aurel for Windows — installer**](https://github.com/CodePraisy/Aurel/releases/download/v0.1.0/Aurel-0.1.0-Windows-x64.exe) (152 MB) |
| Windows, without installing | [Aurel for Windows — portable](https://github.com/CodePraisy/Aurel/releases/download/v0.1.0/Aurel-0.1.0-Windows-x64-Portable.exe) (137 MB) — runs from any folder or a USB stick |
| **Mac with Apple silicon** (M1, M2, M3, M4) | [**Aurel for Mac — Apple silicon**](https://github.com/CodePraisy/Aurel/releases/download/v0.1.0/Aurel-0.1.0-macOS-arm64.zip) (145 MB) |
| Mac with an Intel processor | [Aurel for Mac — Intel](https://github.com/CodePraisy/Aurel/releases/download/v0.1.0/Aurel-0.1.0-macOS-x64.zip) (155 MB) |

Not sure which Mac you have? Click the Apple menu  → **About This Mac**. If it says **Chip: Apple M…**, choose Apple silicon. If it says **Processor: Intel**, choose Intel.

## Install

### Windows

1. Click the Windows installer link above. Your browser downloads `Aurel-0.1.0-Windows-x64.exe`.
2. Open the downloaded file.
3. Windows may show a blue box saying **"Windows protected your PC"**. This appears because Aurel is new and not yet signed with a paid certificate. Click **More info**, then **Run anyway**.
4. Follow the installer. You can keep all the default choices. Near the end, it downloads the AI transcription engine (3–5 GB, one time), so this step needs an internet connection and can take a while. If it is interrupted, Aurel still installs, and you can finish later in **Settings → AI Engine**.
5. Open **Aurel** from the Start menu or the desktop shortcut.

Using the portable version instead? Just open `Aurel-0.1.0-Windows-x64-Portable.exe`. There is nothing to install. Step 3 above applies to it too.

### Mac

1. Click the Mac link for your computer above. Your browser downloads a `.zip` file.
2. Open the `.zip` file. It unpacks into **Aurel**.
3. Drag **Aurel** into your **Applications** folder.
4. The first time, **right-click** (or Control-click) Aurel and choose **Open**, then click **Open** again. This is needed once because Aurel is not yet signed by Apple.
5. If your Mac says **"Aurel is damaged and can't be opened"**, the app is fine: macOS says this about unsigned apps downloaded from the internet. Open the **Terminal** app, paste this line and press Return, then open Aurel again:

   ```sh
   xattr -cr /Applications/Aurel.app
   ```

### The first time you open Aurel

- Aurel downloads its instrument sounds (about 40 MB) in the background. You can start using it right away.
- **AI engine:** the Windows installer has already set it up. With the portable version or on a Mac, Aurel sets it up the first time you press **Transcribe**. That is a one-time 3–5 GB download that takes a while, and you don't need to install anything yourself. After that, transcription works offline.
- Everything you make stays on your computer. Aurel has no accounts and collects no data.

## What you can do

- **Import a song.** Drop in an MP3, WAV, FLAC or video file, or paste a YouTube link.
- **Transcribe it.** Aurel separates the instruments and writes sheet music and tab for each one. Treat the result as a strong first draft, ready for you to fix up.
- **Practice.** Slow songs down without changing the pitch, loop a hard section, and speed up a little each time round. Follow a moving cursor across the music.
- **Compose.** Write notes with your computer keyboard, the mouse, an on-screen piano or guitar neck, or a MIDI keyboard.
- **Make it sound good.** Use the built-in recorded instruments and effects. On Windows, you can also use VST3 plug-ins you already own, such as Guitar Rig or Kontakt.
- **Export.** Save audio (WAV, MP3, FLAC), MIDI, MusicXML (for MuseScore, Sibelius or Finale), PDF sheet music, or a folder of separate tracks for your recording software.
- **Look and feel.** Choose a Dark, Light or Sakura theme.

---

## Features in more detail

### Transcription

Demucs separates the recording into vocals, drums, bass, guitar, piano and other. Basic Pitch turns each part into notes. Tempo, time signature and the first beat are detected, and the notes are lined up to a 16th-note grid as editable notation and tab. Aurel uses an NVIDIA graphics card when one is available, otherwise the processor.

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

### Settings

- **Audio device:** output, sample rate, buffer size and the measured latency.
- **MIDI:** input device, channel, which part the keyboard plays, and Write notes or Play only.
- **Plug-ins:** search folders, rescan, turn plug-ins on or off, and a list of failed plug-ins.
- **Playback:** count-in, metronome volume, solo follows track selection, and whether reverb and delay ring out after you stop.

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

The **Build release downloads** GitHub Actions workflow builds the Windows installer, the Windows portable app, and both Mac packages, then attaches them to the release.

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
