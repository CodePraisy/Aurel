# Aurel real-time audio update

Aurel already supports score editing, audio transcription, and installed Windows VST3 instruments and effects. It opens native plug-in editors, saves their state, and supports default and per-track chains. The earlier build rendered VST3 tracks before playback. The current Windows source includes a streaming VST3 path. The goals below describe the behavior to verify and complete.

## Real-time audio goals

- Keep plug-ins loaded and process notes and stems in small audio blocks during playback.
- Use each imported VST3 instrument's own sound and saved preset for note entry, on-screen and MIDI keyboard audition, playback, and export. Show a load error when the plug-in is unavailable.
- Connect the native editor to the instance being heard so edits are audible immediately and saved on close. Keep default chains and per-piece overrides separate.
- Sync the cursor, notes, stems, and metronome through pause, seek, and loops. Compensate for plug-in delay, handle crashes, and use the same settings for offline export.

## Settings

- Audio output, sample rate, buffer size, and reported latency.
- MIDI input and channel, audition track, and Play only or Write notes mode.
- Plug-in search folders, rescan, enable or disable, and failed-load details.
- Count-in, metronome volume, solo follows selection, and effect tails after stopping.

Verify that playback needs no new preparation pass, audition matches export, and live edits survive reopening a piece.
