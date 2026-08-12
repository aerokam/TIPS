@echo off
REM scripts/run-ref-cpi.cmd
REM Fetches daily interpolated Ref CPI from TreasuryDirect and writes to TIPS/RefCPI.csv in R2.
REM Triggered by Task Scheduler only on BLS CPI release dates (scripts/setup-windows-tasks.ps1).

set REPO=C:\Users\aerok\projects\Treasuries
set LOG=%REPO%\logs\ref-cpi.log
set NODE="C:\Program Files\nodejs\node.exe"

if not exist "%REPO%\logs" mkdir "%REPO%\logs"

echo [%DATE% %TIME%] Fetching Ref CPI... >> "%LOG%"
%NODE% "%REPO%\scripts\fetchRefCpi.js" --write >> "%LOG%" 2>&1
set RC=%ERRORLEVEL%
echo [%DATE% %TIME%] Exited with code %RC% >> "%LOG%"
echo. >> "%LOG%"
exit /b %RC%
