@echo off
setlocal
title Aurel
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Get the LTS version from https://nodejs.org and run this again.
  pause
  exit /b 1
)

node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=12)?0:1)"
if errorlevel 1 (
  echo Aurel needs Node.js 22.12 or newer. You have:
  node -v
  echo Update from https://nodejs.org and run this again.
  pause
  exit /b 1
)

rem Install or update dependencies when package.json has changed since the last install
fc /b package.json node_modules\.aurel-installed >nul 2>nul
if errorlevel 1 (
  echo Installing dependencies, this can take a few minutes...
  call npm install
  if errorlevel 1 (
    echo.
    echo npm install failed. See the messages above.
    pause
    exit /b 1
  )
  copy /y package.json node_modules\.aurel-installed >nul
)

rem Electron 45+ downloads its binary on demand; make sure it is present
if not exist node_modules\electron\path.txt (
  echo Downloading Electron...
  call node node_modules\electron\install.js
  if errorlevel 1 (
    echo Electron download failed. Check your internet connection and run this again.
    pause
    exit /b 1
  )
)

echo Starting Aurel...
call npm start
if errorlevel 1 pause
