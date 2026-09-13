@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0deployment\SETUP-NEW-LAPTOP.ps1"
set EC=%ERRORLEVEL%
if not "%EC%"=="0" (
  echo.
  echo SETUP FAILED. Exit code: %EC%
  pause
  exit /b %EC%
)
echo.
echo NEW LAPTOP SETUP COMPLETE.
pause
