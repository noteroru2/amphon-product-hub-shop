@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0deployment\VERIFY-NEW-LAPTOP.ps1"
set EC=%ERRORLEVEL%
if not "%EC%"=="0" (
  echo.
  echo VERIFY FAILED. Exit code: %EC%
  pause
  exit /b %EC%
)
echo.
echo VERIFY COMPLETE.
pause
