@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\deployment\CHECK-INSTALLER.ps1" -Path ".\deployment\SHOP62-FINAL-ACTIVATION-CHECK.ps1"
if errorlevel 1 (
  echo.
  echo SHOP-6.3 FINAL ACTIVATION READINESS PARSER FAILED.
  pause
  exit /b 1
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\deployment\SHOP62-FINAL-ACTIVATION-CHECK.ps1"
if errorlevel 1 (
  echo.
  echo SHOP-6.3 IS NOT READY FOR OWNER ACTIVATION.
  echo No setting was changed.
  pause
  exit /b 1
)
echo.
echo SHOP-6.3 FINAL ACTIVATION READINESS: PASS
echo No activation was performed. SHOP-6.4 requires explicit owner approval.
pause
