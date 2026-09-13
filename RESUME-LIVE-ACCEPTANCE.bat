@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File ".\deployment\CHECK-INSTALLER.ps1" -Path ".\deployment\RESUME-LIVE-ACCEPTANCE.ps1"
if errorlevel 1 (
  echo.
  echo LIVE ACCEPTANCE PARSER CHECK FAILED.
  pause
  exit /b 1
)
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File ".\deployment\RESUME-LIVE-ACCEPTANCE.ps1"
set "EC=%ERRORLEVEL%"
if not "%EC%"=="0" (
  echo.
  echo LIVE ACCEPTANCE FAILED. Exit code: %EC%
  pause
  exit /b %EC%
)
echo.
echo LIVE ACCEPTANCE COMPLETE.
pause
endlocal
