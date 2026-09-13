@echo off
setlocal
cd /d "%~dp0"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\deployment\CHECK-INSTALLER.ps1" -Path ".\deployment\RESUME-FROM-BUILD.ps1"
if errorlevel 1 (
  echo.
  echo RESUME-BUILD PARSER CHECK FAILED. No deployment steps were run.
  pause
  exit /b %ERRORLEVEL%
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\deployment\RESUME-FROM-BUILD.ps1"
set EXITCODE=%ERRORLEVEL%
echo.
if not "%EXITCODE%"=="0" (
  echo RESUME BUILD FAILED. Exit code: %EXITCODE%
) else (
  echo RESUME BUILD COMPLETE.
)
pause
exit /b %EXITCODE%
