@echo off
setlocal

set SCRIPT=C:\Users\aerok\projects\Treasuries\YieldCurves\scripts\fidelityDownload.js
set LOG=C:\Users\aerok\projects\Treasuries\YieldCurves\logs\fidelity.log
set NODE=node

if not exist "C:\Users\aerok\projects\Treasuries\YieldCurves\logs" (
  mkdir "C:\Users\aerok\projects\Treasuries\YieldCurves\logs"
)

echo [%DATE% %TIME%] Starting
echo [%DATE% %TIME%] Starting >> "%LOG%"
powershell -NoProfile -Command "& %NODE% '%SCRIPT%' 2>&1 | Tee-Object -FilePath '%LOG%' -Append"
set EXIT_CODE=%ERRORLEVEL%
echo [%DATE% %TIME%] Exited with code %EXIT_CODE%
echo [%DATE% %TIME%] Exited with code %EXIT_CODE% >> "%LOG%"

if %EXIT_CODE% neq 0 (
  echo [%DATE% %TIME%] Fidelity download did not succeed — skipping Yield Curves chain. >> "%LOG%"
  exit /b %EXIT_CODE%
)

REM Chain the yield-curves fit: it reads FidelityTreasuriesTips.csv, so re-run it
REM whenever this input actually changed rather than on its own fixed clock.
call "C:\Users\aerok\projects\Treasuries\YieldCurves\scripts\run-yield-curves.cmd"
exit /b %ERRORLEVEL%
