@echo off
setlocal
cd /d "%~dp0"
title Moa ToDo
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
if not exist "dist\index.html" (
 echo App files are missing. Run: npm run build
 pause
 exit /b 1
)
set "HOST=127.0.0.1"
if not defined PORT set "PORT=4174"
echo Moa ToDo - keep this window open.
echo Open http://127.0.0.1:%PORT%/todo/ in Edge or Chrome.
echo Press Ctrl+C to stop.
node scripts\serve.mjs --preview
pause
