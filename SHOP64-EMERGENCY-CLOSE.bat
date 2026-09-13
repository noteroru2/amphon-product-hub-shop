@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\deployment\CHECK-INSTALLER.ps1" -Path ".\deployment\SHOP64-EMERGENCY-CLOSE.ps1"
if errorlevel 1 (
  echo.
  echo SHOP-6.4 EMERGENCY CLOSE PARSER FAILED.
  pause
  exit /b 1
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\deployment\SHOP64-EMERGENCY-CLOSE.ps1"
if errorlevel 1 (
  echo.
  echo SHOP-6.4 EMERGENCY CLOSE FAILED.
  pause
  exit /b 1
)
echo.
echo SHOP-6.4 EMERGENCY CLOSE: PASS
pause
