@echo off
setlocal
cd /d "%~dp0"
title ELSOLTEC - Create Account
where node >nul 2>nul
if errorlevel 1 (
 echo Install Node.js 24 or later from https://nodejs.org/
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

set "DATA_DIR=%~dp0data"
echo Create a groupware account. This is NOT your email password.
echo Roles: employee = staff, manager = director, ceo = CEO.
powershell.exe -NoProfile -Command "& { $login = Read-Host 'Login ID'; $name = Read-Host 'Display name'; $role = Read-Host 'Role (employee / manager / ceo)'; $secret = Read-Host 'New password (at least 12 characters)' -AsSecureString; try { $env:NEW_USER_PASSWORD = [System.Net.NetworkCredential]::new('', $secret).Password; & node server.js user:add $login $name $role; if ($LASTEXITCODE -ne 0) { exit 1 } } finally { Remove-Item Env:NEW_USER_PASSWORD -ErrorAction SilentlyContinue } }"
pause
