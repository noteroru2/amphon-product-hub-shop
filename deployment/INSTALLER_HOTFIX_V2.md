# SHOP-6.1 Installer Hotfix v2

Date: 2026-09-12

Fixes:
- Replaced all non-ASCII em dashes in INSTALL-ALL.ps1 with ASCII hyphens for Windows PowerShell 5.1 compatibility.
- Hardened Astro site URL replacement expression.
- Added deployment/CHECK-INSTALLER.ps1 using the native PowerShell parser.
- INSTALL-ALL.bat and DATABASE-ONLY.bat now parse-check INSTALL-ALL.ps1 before execution.

The original parser failure occurred before the installer body executed, so that failed attempt did not modify Supabase.
