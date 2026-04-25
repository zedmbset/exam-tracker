@echo off
setlocal

set "ROOT=%~dp0"
set "WORKER_DIR=%ROOT%workers\telegram"

echo Starting Exam Tracker locally...

start "Telegram Worker" cmd /k "cd /d "%WORKER_DIR%" && python worker.py"
start "Exam Tracker Server" cmd /k "cd /d "%ROOT%" && node server.js"

timeout /t 4 /nobreak >nul
start "" "http://localhost:5000/telegram"

echo Opened local app in your browser.
echo If something does not load, check:
echo   - Node server window
echo   - Telegram Worker window

endlocal
