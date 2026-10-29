@echo off
setlocal
cd /d "%~dp0"
title ELSOLTEC - Local Test
where node >nul 2>nul
if errorlevel 1 (
 echo Node.js 24 or later is required. Install from https://nodejs.org/
 pause
 exit /b 1
)
node -e "if(Number(process.versions.node.split('.')[0])<24)process.exit(1)"
if errorlevel 1 (
 echo Please install Node.js 24 or later.
 pause
 exit /b 1
)
node --input-type=module -e "await Promise.all(['nodemailer','mailparser','exceljs','image-size','date-holidays'].map(name=>import(name)))" >nul 2>nul
if errorlevel 1 (
 echo Installing required groupware packages...
 call npm.cmd ci --cache "%TEMP%\elsoltec-npm-cache"
 if errorlevel 1 (
  echo Package installation failed. Check your internet connection.
  pause
  exit /b 1
 )
)
set "HOST=127.0.0.1"
set "PORT=3000"
set "OFFICE_IP=127.0.0.1"
set "NODE_ENV=development"
set "TRUSTED_PROXY_IPS="
set "PUBLIC_ORIGIN=http://127.0.0.1:3000"
set "DATA_DIR=%~dp0data"
echo ELSOLTEC local test - keep this window open.
echo After "Groupware started", open http://127.0.0.1:3000 in Edge.
echo No account yet? Run CREATE-ACCOUNT.cmd first.
echo This launcher allows local attendance for testing only.
echo Press Ctrl+C to stop.
node server.js
pause
