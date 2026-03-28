@echo off
cd /d "%~dp0.."

REM If server is already running, go straight to browser
curl -sf http://localhost:3737/api/health >nul 2>&1
if not errorlevel 1 goto :open

REM Start server detached (logs to Dashboard\server.log)
echo Starting dashboard server...
start "" /B node Dashboard\server.js 1>Dashboard\server.log 2>&1

REM Wait up to 10 seconds for it to become ready
set /a i=0
:wait
timeout /t 1 /nobreak >nul
curl -sf http://localhost:3737/api/health >nul 2>&1
if not errorlevel 1 goto :open
set /a i+=1
if %i% lss 10 goto :wait
echo ERROR: Server did not start within 10 seconds.
echo Check Dashboard\server.log for details.
pause
exit /b 1

:open
start "" http://localhost:3737
