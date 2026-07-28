@echo off
setlocal
cd /d "%~dp0"

where py >nul 2>nul && (py run.py %* & goto :eof)
where python >nul 2>nul && (python run.py %* & goto :eof)

echo Python 3.10+ not found. Install it from https://python.org and re-run start.bat.
exit /b 1
