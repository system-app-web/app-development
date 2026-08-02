@echo off
setlocal
set SCRIPT_DIR=%~dp0scripts
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%\\stop_cloudflare_preview.ps1"
endlocal
