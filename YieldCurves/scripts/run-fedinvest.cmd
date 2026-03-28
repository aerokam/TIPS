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

exit /b %EXIT_CODE%
