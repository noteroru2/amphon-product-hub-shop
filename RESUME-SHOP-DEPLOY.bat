@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File ".\deployment\CHECK-INSTALLER.ps1" -Path ".\deployment\RESUME-SHOP-DEPLOY.ps1"
if errorlevel 1 (
  echo.
  echo RESUME SHOP PARSER CHECK FAILED.
  pause
  exit /b 1
)
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File ".\deployment\RESUME-SHOP-DEPLOY.ps1"
set "EC=%ERRORLEVEL%"
if not "%EC%"=="0" (
  echo.
  echo RESUME SHOP FAILED. Exit code: %EC%
  pause
  exit /b %EC%
)
echo.
echo RESUME SHOP COMPLETE.
pause
endlocal
