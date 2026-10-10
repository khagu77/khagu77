@echo off
rem Installs the fast-download helper for the YouTube extension (no admin rights needed).
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0helper\install.ps1"
