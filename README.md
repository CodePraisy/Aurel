# Aurel

AI music transcription, composition and practice studio for Windows.

## Run it

Requires **Node.js 22.12+** (nodejs.org, LTS).

Double-click **`Aurel.bat`**. It installs dependencies the first time (and whenever `package.json` changes), then starts the app.

From a terminal instead:

```powershell
npm install
npm run dev        # development with hot reload
npm start          # production build, then run
npm run dist       # build the Windows installer into release/
```

Run `npm test` for the music-core unit tests.

## Install AI transcription

The Windows installer sets up a private Python environment, installs PyTorch, Demucs and Basic Pitch, and downloads the default separation model before setup finishes. The first setup needs an internet connection and may download several gigabytes on NVIDIA systems.

If you launch from source or the installer download is interrupted, open **Settings → AI Engine → Install engine**. The default model works offline after setup. Selecting a different separation model may require one more download.

## VST3 instruments and effects

Aurel uses the VST3 plug-ins already installed on your computer. Add extra folders, rescan, switch plug-ins on or off and see any that failed in **Settings → Plug-ins**.

- **A VST3 instrument for a part:** open the part's **Sound & effects** and choose **Use a VST3 instrument…**. Note entry, the on-screen keyboard, a MIDI keyboard, playback and audio export all use the plug-in's own sound and preset.
- **Effects:** add VST3 effects and built-in effects to any part, including recorded stems and built-in instruments. VST3 effects run first, then built-in ones. **Settings → Default effects** holds each built-in instrument's default chain; changing a part's chain makes a copy for that piece.
- **Editing:** **Open plug-in editor** opens the plug-in's own window on the instance you are hearing, so changes are audible straight away. Its settings are saved into the piece when you close the window.
- Plug-ins run live in a separate helper process per part. Nothing is rendered ahead of playback. A crashing plug-in is named and removed from that part only.

To rebuild the helper (`build/vst-host/aurel-vst-host.exe`), run `powershell -File native/vst-host/build.ps1` with Visual Studio 2022 (C++ workload) and CMake installed.

## YouTube import (optional)

Aurel downloads its own copy of yt-dlp the first time you import from YouTube; **Settings → Import** can update it or use your own copy. It never signs in or uses cookies. You are responsible for the content you download (see **Settings → Terms & privacy**).

## Layout

| Path | What |
|---|---|
| `src/main` | Electron main process: library (SQLite via sql.js), FFmpeg import/convert, YouTube checks, AI job runner, PDF/export, `aurel://` file protocol |
| `src/preload` | The only bridge to the renderer (context-isolated, typed in `src/shared/api.ts`) |
| `src/shared/types.ts` | Score / project data model |
| `src/renderer/src/music` | Notation logic: measures, quantization, tab fingering, MIDI, MusicXML, ASCII tab, WAV |
| `src/renderer/src/notation` | VexFlow engraving (staff, tab, percussion) |
| `src/renderer/src/audio` | Built-in instruments, synced transport, offline WAV render |
| `engine/aurel_engine.py` | Demucs separation, Basic Pitch transcription, drum and tempo analysis |

See `docs/ARCHITECTURE.md` for the MVP scope, design decisions and what is not built yet.

## Platform builds

Run npm ci, then npm run dist on Windows or npm run dist:mac on macOS. GitHub Actions builds unsigned Apple silicon and Intel ZIP packages. The native VST3 host and AI installer hook are Windows features.

Download the Windows installer, Windows portable executable, or a Mac package from [GitHub Releases](https://github.com/CodePraisy/Aurel/releases). npm is only needed when building from source.
