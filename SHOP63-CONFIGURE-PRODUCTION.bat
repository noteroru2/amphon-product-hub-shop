@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\deployment\CHECK-INSTALLER.ps1" -Path ".\deployment\SHOP63-CONFIGURE-PRODUCTION.ps1"
if errorlevel 1 (
  echo.
  echo SHOP-6.3 PRODUCTION CONFIG PARSER FAILED.
  pause
  exit /b 1
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\deployment\SHOP63-CONFIGURE-PRODUCTION.ps1"
if errorlevel 1 (
  echo.
  echo SHOP-6.3 PRODUCTION READINESS WAS NOT CHANGED OR IS INCOMPLETE.
  echo purchase_enabled was not enabled.
  pause
  exit /b 1
)
echo.
echo SHOP-6.3 PRODUCTION READINESS CONFIGURED.
echo purchase_enabled remains false.
pause
