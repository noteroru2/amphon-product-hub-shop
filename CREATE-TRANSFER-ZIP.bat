@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0deployment\CREATE-TRANSFER-ZIP.ps1"
set EC=%ERRORLEVEL%
if not "%EC%"=="0" (
  echo.
  echo EXPORT FAILED. Exit code: %EC%
  pause
  exit /b %EC%
)
echo.
echo EXPORT COMPLETE.
pause
