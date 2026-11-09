@echo off
cd /d "%~dp0"
echo Telechargement des videos des sorts : environ 1 a 2 Go, ca peut prendre du temps.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0mise-a-jour.ps1" -Videos
pause
