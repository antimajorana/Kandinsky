@echo off
rem Puts The Oracle's previous Atlas settings back and switches the Obsidian-look styling off.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\apply-kit.ps1" -Undo
echo.
pause
