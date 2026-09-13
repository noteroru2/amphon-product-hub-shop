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

powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\deployment\INSTALL-ALL.ps1" -DatabaseOnly
set EXITCODE=%ERRORLEVEL%
echo.
if not "%EXITCODE%"=="0" (
  echo DATABASE SETUP FAILED. Exit code: %EXITCODE%
) else (
  echo DATABASE SETUP COMPLETE.
)
pause
exit /b %EXITCODE%
