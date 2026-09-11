@echo off
title XiaoAi KeBiao Importer - Local Server
cd /d "%~dp0"

set PORT=8787
if not "%~1"=="" set PORT=%~1

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found.
  echo Install LTS from: https://nodejs.org/zh-cn
  echo Then double-click this file again.
  pause
  exit /b 1
)

netstat -ano | findstr ":%PORT% " | findstr "LISTENING" >nul 2>nul
if not errorlevel 1 (
  echo [INFO] Port %PORT% is already in use - a previous server is still running.
  echo [INFO] It may serve STALE code. Killing it and starting a fresh one...
  for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%PORT% " ^| findstr "LISTENING"') do taskkill /F /PID %%a >nul 2>nul
  ping -n 3 127.0.0.1 >nul
)

echo ============================================
echo   XiaoAi KeBiao Importer (ChengFang edition)
echo.
echo   URL: http://localhost:%PORT%
echo   Browser opens automatically.
echo   Keep this window open; close it to stop.
echo ============================================
start "" "http://localhost:%PORT%"
node scripts\dev_server.mjs %PORT%

echo.
echo [STOPPED] Server exited. Check messages above if unexpected.
pause
