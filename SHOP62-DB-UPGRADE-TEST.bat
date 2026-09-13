@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\deployment\CHECK-INSTALLER.ps1" -Path ".\deployment\SHOP62-DB-UPGRADE-TEST.ps1"
if errorlevel 1 (
  echo.
  echo SHOP-6.2 DB PARSER CHECK FAILED.
  pause
  exit /b 1
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\deployment\SHOP62-DB-UPGRADE-TEST.ps1"
if errorlevel 1 (
  echo.
  echo SHOP-6.2 DB UPGRADE/TEST FAILED.
  pause
  exit /b 1
)
echo.
echo SHOP-6.2 DB UPGRADE/TEST COMPLETE.
pause
