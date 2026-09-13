@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\deployment\CHECK-INSTALLER.ps1" -Path ".\deployment\SHOP64-OWNER-ACTIVATE.ps1"
if errorlevel 1 (
  echo.
  echo SHOP-6.4 OWNER ACTIVATION PARSER FAILED.
  pause
  exit /b 1
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\deployment\SHOP64-OWNER-ACTIVATE.ps1"
if errorlevel 1 (
  echo.
  echo SHOP-6.4 OWNER ACTIVATION DID NOT COMPLETE.
  echo Review SHOP6_4_OWNER_ACTIVATION_REPORT.md.
  pause
  exit /b 1
)
echo.
echo SHOP-6.4 OWNER ACTIVATION: PASS
echo Review SHOP6_4_OWNER_ACTIVATION_REPORT.md.
pause
