@echo off
setlocal EnableDelayedExpansion
title Aurel - train the guitar note model
cd /d "%~dp0..\.."

rem ---- where things go (change these if you like) ----
set "WORK=%USERPROFILE%\aurel-train"
set "DATA=%WORK%\guitar"
set "MODEL=%WORK%\guitar-ft.pt"
set "SONGS=600"
set "PY=%APPDATA%\Aurel\engine-venv\Scripts\python.exe"

echo.
echo  Aurel guitar model training
echo  ===========================
echo  Training data and the model go in %WORK%
echo.

if not exist "%PY%" (
  echo  Aurel's AI engine isn't installed yet. Open Aurel, press Transcribe once to install it, then run this again.
  goto :end
)

rem ---- 1. the GPU ----
"%PY%" -c "import torch,sys; ok=torch.cuda.is_available(); print('  GPU:', torch.cuda.get_device_name(0) if ok else 'none found'); sys.exit(0 if ok else 1)"
if errorlevel 1 (
  echo.
  echo  No NVIDIA GPU is visible to PyTorch, so training would take days on the processor. Stopping.
  goto :end
)

rem ---- 2. SoundFonts: every .sf2 in this folder or in %WORK%\sf2 ----
if not exist "%WORK%\sf2" mkdir "%WORK%\sf2"
set "SF2="
for %%F in ("%~dp0*.sf2" "%WORK%\sf2\*.sf2") do set "SF2=!SF2! "%%~fF""
if "!SF2!"=="" (
  echo.
  echo  No SoundFont found. Download GeneralUser GS from https://github.com/mrbumpy409/GeneralUser-GS
  echo  and put the .sf2 file in %WORK%\sf2 ^(more SoundFonts = better^), then run this again.
  start "" "%WORK%\sf2"
  goto :end
)
echo  SoundFonts:!SF2!

rem ---- optional: your own MIDI files (Guitar Pro / DadaGP exported to MIDI) ----
set "MIDI="
if exist "%WORK%\midi\*.mid" set "MIDI=--midi-dir "%WORK%\midi""
if defined MIDI echo  Using your MIDI files in %WORK%\midi

rem ---- 3. packages (quick when already installed) ----
echo.
echo  Installing the training packages...
"%PY%" -m pip install --quiet tinysoundfont soundfile pedalboard mido mir_eval
if errorlevel 1 goto :failed

rem ---- 4. training data (skips songs already made, so it can be resumed) ----
echo.
echo  Step 1 of 2: making %SONGS% training songs (about 1-2 hours)...
"%PY%" tools\train\make_dataset.py --out "%DATA%" --stem guitar --songs %SONGS% --sf2 !SF2! !MIDI! --separate demucs --device cuda
if errorlevel 1 goto :failed

rem ---- 5. fine-tune (resumes if stopped; Ctrl+C is safe) ----
echo.
echo  Step 2 of 2: training (about 6-10 hours). You can close this window at any time;
echo  run this file again to carry on where it stopped.
"%PY%" tools\train\finetune_transkun.py --data "%DATA%" --out "%MODEL%"
if errorlevel 1 goto :failed

echo.
if exist "%WORK%\guitar-ft-best.pt" (
  echo  Done. In Aurel: Settings ^> Transcription ^> Custom note model ^> Choose... and pick
  echo  %WORK%\guitar-ft-best.pt
  start "" "%WORK%"
) else (
  echo  Done, but the new model did not beat the built-in one, so keep using the built-in model.
)
goto :end

:failed
echo.
echo  Something went wrong (see the message above). Copy it into the chat with Claude.

:end
echo.
pause
