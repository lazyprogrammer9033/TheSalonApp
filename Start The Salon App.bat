@echo off
rem Double-click this file on the salon Windows PC to start The Salon App.
rem Keep this window open while the salon is using the app (you can minimise it).
title The Salon App
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed.
  echo Please install the LTS version from https://nodejs.org and then double-click this file again.
  start "" https://nodejs.org
  pause
  exit /b 1
)

if not exist node_modules (
  echo First run: installing. This takes a minute or two...
  call npm install --omit=dev
  if errorlevel 1 (
    echo.
    echo Install failed. Check the internet connection and try again.
    if exist node_modules rmdir /s /q node_modules
    pause
    exit /b 1
  )
)

rem Open the app in the browser a few seconds after the server starts.
start "" /min powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 4; Start-Process 'http://localhost:4000'"

call npm start
echo.
echo The Salon App has stopped.
pause
