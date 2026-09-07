@echo off
setlocal

set SCRIPT=C:\Users\aerok\projects\Treasuries\scripts\getYieldsFedInvest.js
set LOG=C:\Users\aerok\projects\Treasuries\YieldCurves\logs\fedinvest.log
set NODE="C:\Program Files\nodejs\node.exe"

if not exist "C:\Users\aerok\projects\Treasuries\YieldCurves\logs" (
  mkdir "C:\Users\aerok\projects\Treasuries\YieldCurves\logs"
)

echo [%DATE% %TIME%] Starting >> "%LOG%"
%NODE% "%SCRIPT%" >> "%LOG%" 2>&1
set EXIT_CODE=%ERRORLEVEL%
echo [%DATE% %TIME%] Exited with code %EXIT_CODE% >> "%LOG%"

if %EXIT_CODE% neq 0 (
  echo [%DATE% %TIME%] FedInvest fetch did not succeed — skipping Yield Curves chain. >> "%LOG%"
  exit /b %EXIT_CODE%
)

REM Chain the yield-curves fit: it reads YieldsFromFedInvestPrices.csv, so re-run it
REM whenever this input actually changed rather than on its own fixed clock.
call "C:\Users\aerok\projects\Treasuries\YieldCurves\scripts\run-yield-curves.cmd"
exit /b %ERRORLEVEL%
