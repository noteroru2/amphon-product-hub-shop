@echo off
setlocal
cd /d "%~dp0"
node deployment\APPLY-SHOP62-ROUTE-FIX.mjs
if errorlevel 1 (
  echo.
  echo SHOP-6.2 ROUTE HOTFIX FAILED.
  pause
  exit /b 1
)
node deployment\SHOP62-ROUTE-FIX-VERIFY.mjs
if errorlevel 1 (
  echo.
  echo SHOP-6.2 ROUTE HOTFIX VERIFY FAILED.
  pause
  exit /b 1
)
echo.
echo SHOP-6.2 ROUTE HOTFIX: PASS
echo Next: SHOP62-PROVIDER-E2E.bat
pause
