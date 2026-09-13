@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\deployment\CHECK-INSTALLER.ps1" -Path ".\deployment\SHOP62-PROVIDER-E2E.ps1"
if errorlevel 1 (
  echo.
  echo SHOP-6.2 PROVIDER PARSER CHECK FAILED.
  pause
  exit /b 1
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\deployment\SHOP62-PROVIDER-E2E.ps1"
if errorlevel 1 (
  echo.
  echo SHOP-6.2 PROVIDER E2E FAILED.
  pause
  exit /b 1
)
echo.
echo SHOP-6.2 PROVIDER E2E COMPLETE.
pause
