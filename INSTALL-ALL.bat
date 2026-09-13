@echo off
setlocal
cd /d "%~dp0"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\deployment\CHECK-INSTALLER.ps1" -Path ".\deployment\INSTALL-ALL.ps1"
if errorlevel 1 (
  echo.
  echo INSTALLER PARSER CHECK FAILED. No database changes were made by INSTALL-ALL.ps1.
  pause
  exit /b %ERRORLEVEL%
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\deployment\INSTALL-ALL.ps1"
set EXITCODE=%ERRORLEVEL%
echo.
if not "%EXITCODE%"=="0" (
  echo INSTALL FAILED. Exit code: %EXITCODE%
) else (
  echo INSTALL COMPLETE.
)
pause
exit /b %EXITCODE%
