@echo off
rem Watches Atlas for an hour and writes down every program and window it opens (it changes nothing).
rem Start this, then use Atlas until a stray window appears. The notes go to stray-windows-log.txt here.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\catch-stray-windows.ps1"
echo.
pause
