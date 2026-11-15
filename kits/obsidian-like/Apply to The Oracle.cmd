@echo off
rem Copies the Obsidian-like settings and styling into The Oracle's .atlas folder (your old settings are kept as a copy).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\apply-kit.ps1"
echo.
pause
