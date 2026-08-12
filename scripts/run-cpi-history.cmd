@echo off
set REPO=C:\Users\aerok\projects\Treasuries
set LOG=%REPO%\logs\cpi-history.log
set NODE="C:\Program Files\nodejs\node.exe"

if not exist "%REPO%\logs" mkdir "%REPO%\logs"

echo [%DATE% %TIME%] Checking CPI release schedule... >> "%LOG%"
%NODE% "%REPO%\scripts\checkCpiReleaseDate.js" >> "%LOG%" 2>&1
if %ERRORLEVEL% neq 0 (
  echo [%DATE% %TIME%] Not a release day — skipping. >> "%LOG%"
  echo. >> "%LOG%"
  exit /b 0
)

echo [%DATE% %TIME%] Release day confirmed — fetching CPI history... >> "%LOG%"
%NODE% "%REPO%\scripts\fetchCpiHistory.js" --write >> "%LOG%" 2>&1
set RC=%ERRORLEVEL%
echo [%DATE% %TIME%] Exited with code %RC% >> "%LOG%"
echo. >> "%LOG%"

if %RC% neq 0 (
  echo [%DATE% %TIME%] CPI history fetch failed — skipping Ref CPI chain. >> "%LOG%"
  echo. >> "%LOG%"
  exit /b %RC%
)

REM Ref CPI is sourced independently from TreasuryDirect, not from CPI_history.csv,
REM but TreasuryDirect's own recompute only reflects today's BLS print once it has
REM caught up — chaining here (rather than a same-time trigger) runs it right after
REM our own CPI fetch confirms the release is out, not on a guessed clock offset.
call "%REPO%\scripts\run-ref-cpi.cmd"
exit /b %ERRORLEVEL%
