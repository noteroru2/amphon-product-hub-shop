@echo off
setlocal
cd /d "%~dp0"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\deployment\CHECK-INSTALLER.ps1" -Path ".\deployment\INSTALL-ALL.ps1"
if errorlevel 1 (
  echo.
  echo INSTALLER PARSER CHECK FAILED. No further deployment steps were run.
  pause
  exit /b %ERRORLEVEL%
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\deployment\INSTALL-ALL.ps1" -ResumeFromCloudflare
set EXITCODE=%ERRORLEVEL%
echo.
if not "%EXITCODE%"=="0" (
  echo RESUME FAILED. Exit code: %EXITCODE%
) else (
  echo RESUME COMPLETE.
)
pause
exit /b %EXITCODE%
