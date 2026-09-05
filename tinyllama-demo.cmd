@echo off
title TINYLLAMA DEMO - a 1.1B model with NO tool calling drives your browser
set PATH=%LOCALAPPDATA%\Programs\Ollama;%PATH%
set AGENTIC_PROVIDER=ollama
set AGENTIC_MODEL=tinyllama:1.1b
cd /d "C:\Users\tusha\.zcode\workspace\default\AgenticBrowser"

echo ================================================================
echo   TINYLLAMA (1.1B params - NO native tool calling) is now
echo   driving AgenticBrowser live. Watch every step it takes.
echo   Downloads are being saved to D:\
echo ================================================================
echo.
echo [1/2] Opening the project GitHub page in the browser...
node dist\cli\index.js open github.com/tushar-alt/AgenticBrowser
echo.
echo [2/2] Now the tiny model takes over. Watch it plan:
node dist\cli\index.js run "download this repository as a zip file" --steps 15 --json
echo.
echo === DONE - your download should be in D:\ ===
dir /b D:\AgenticBrowser*.zip 2>nul
pause
