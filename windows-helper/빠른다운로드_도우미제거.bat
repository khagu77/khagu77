@echo off
rem Removes the fast-download helper.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0helper\install.ps1" -Uninstall
