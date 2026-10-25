@echo off
chcp 65001 >nul
title J.A.R.V.I.S. HUD
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Brak Node.js. Zainstaluj Node.js 22 LTS ze strony https://nodejs.org i uruchom ponownie.
  pause
  exit /b 1
)

for /f "tokens=1 delims=." %%v in ('node -p "process.versions.node"') do set NODEMAJOR=%%v
if %NODEMAJOR% LSS 22 (
  echo Potrzebny Node.js 22 lub nowszy. Masz wersje %NODEMAJOR%.
  pause
  exit /b 1
)

rem Serwer sam otworzy HUD w Edge (najlepsze polskie glosy), gdy bedzie gotowy.
set HUD_OPEN=1
node server.mjs
pause
