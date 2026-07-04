# setup-tasks.ps1
# Run once from an elevated PowerShell prompt to register ALL data pipeline scheduled tasks.
# Usage: powershell -ExecutionPolicy Bypass -File setup-tasks.ps1

$REPO = Split-Path (Split-Path $PSScriptRoot)
$user = "$env:USERDOMAIN\$env:USERNAME"

$principal = New-ScheduledTaskPrincipal `
  -UserId    $user `
  -LogonType Interactive `
  -RunLevel  Limited

$execLimit30m = New-TimeSpan -Minutes 30
$execLimit1h  = New-TimeSpan -Hours 1
$execLimit72h = New-TimeSpan -Hours 72

function New-WeekdayTrigger($time) {
  New-ScheduledTaskTrigger -Weekly -WeeksInterval 1 `
    -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday -At $time
}
function New-MondayTrigger($time) {
  New-ScheduledTaskTrigger -Weekly -WeeksInterval 1 -DaysOfWeek Monday -At $time
}

# ── FIDELITY (headed CDP browser — single task, 3 weekday trigger windows) ───
# Consolidated into one task ("FidelityQuotes") so a single set of run/retry
# settings and the log file apply across all three daily windows.

$wrapperFidelity = "$REPO\YieldCurves\scripts\run-fidelity.cmd"

Register-ScheduledTask `
  -TaskName    "FidelityQuotes" `
  -Description "Download Fidelity broker quotes (TIPS + Treasuries), upload FidelityTips.csv + FidelityTreasuries.csv" `
  -Action      (New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$wrapperFidelity`"") `
  -Trigger     @(
                  (New-WeekdayTrigger "5:05AM")
                  (New-WeekdayTrigger "9:35AM")
                  (New-WeekdayTrigger "2:05PM")
                ) `
  -Settings    (New-ScheduledTaskSettingsSet -ExecutionTimeLimit $execLimit30m `
                  -MultipleInstances IgnoreNew -StartWhenAvailable) `
  -Principal   $principal -Force

# ── FEDINVEST PRICES (weekdays noon ET = 9 AM PT) ────────────────────────────
# Sentinel file logs/fedinvest-success-date.txt prevents double-fetch on retries.

Register-ScheduledTask `
  -TaskName    "FedInvestPrices" `
  -Description "Fetch FedInvest TIPS yields/prices at noon ET (9 AM PT)" `
  -Action      (New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$REPO\scripts\run-fedinvest-prices.cmd`"") `
  -Trigger     (New-WeekdayTrigger "9:00AM") `
  -Settings    (New-ScheduledTaskSettingsSet -ExecutionTimeLimit $execLimit72h -MultipleInstances IgnoreNew) `
  -Principal   $principal -Force

# ── TREASURY AUCTIONS (weekdays — two windows: after 11:30 AM ET and 1 PM ET) ─

Register-ScheduledTask `
  -TaskName    "TreasuryAuctions-Morning" `
  -Description "Fetch Treasury auction results after 11:30 AM ET comp close (8:35 AM PT)" `
  -Action      (New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$REPO\scripts\run-auctions.cmd`"") `
  -Trigger     (New-WeekdayTrigger "8:35AM") `
  -Settings    (New-ScheduledTaskSettingsSet -ExecutionTimeLimit $execLimit72h -MultipleInstances IgnoreNew) `
  -Principal   $principal -Force

Register-ScheduledTask `
  -TaskName    "TreasuryAuctions-Afternoon" `
  -Description "Fetch Treasury auction results after 1 PM ET comp close (10:05 AM PT)" `
  -Action      (New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$REPO\scripts\run-auctions.cmd`"") `
  -Trigger     (New-WeekdayTrigger "10:05AM") `
  -Settings    (New-ScheduledTaskSettingsSet -ExecutionTimeLimit $execLimit72h -MultipleInstances IgnoreNew) `
  -Principal   $principal -Force

# ── TIPS REF (Mondays 7:00 AM PT) ────────────────────────────────────────────

Register-ScheduledTask `
  -TaskName    "TipsRef" `
  -Description "Fetch TIPS reference data (issue dates, CUSIP, etc.) from TreasuryDirect" `
  -Action      (New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$REPO\scripts\run-tips-ref.cmd`"") `
  -Trigger     (New-MondayTrigger "7:00AM") `
  -Settings    (New-ScheduledTaskSettingsSet -ExecutionTimeLimit $execLimit72h -MultipleInstances IgnoreNew) `
  -Principal   $principal -Force

# ── UPDATE CPI RELEASE SCHEDULE (Mondays noon PT — elevated) ─────────────────

$principalElev = New-ScheduledTaskPrincipal `
  -UserId    $user `
  -LogonType Interactive `
  -RunLevel  Highest

Register-ScheduledTask `
  -TaskName    "Update CPI release schedule" `
  -Description "Fetch BLS CPI release schedule via bash script (Mondays noon PT)" `
  -Action      (New-ScheduledTaskAction `
                  -Execute  "`"C:\Program Files\Git\usr\bin\bash.exe`"" `
                  -Argument "-lc `"/c/Users/$env:USERNAME/projects/bls/updateCpiReleaseSchedules.sh`"") `
  -Trigger     (New-MondayTrigger "12:00PM") `
  -Settings    (New-ScheduledTaskSettingsSet -ExecutionTimeLimit $execLimit1h `
                  -WakeToRun -StartWhenAvailable) `
  -Principal   $principalElev `
  -Force

# ── CPI TASKS (RefCPI + FetchCpiHistory + RefreshCpiTasks) ───────────────────
# setup-cpi-release-tasks.ps1 reads R2 for BLS release dates and builds
# date-specific triggers. It also self-schedules RefreshCpiTasks for Dec 29.

Write-Host ""
Write-Host "Registering CPI tasks via setup-cpi-release-tasks.ps1..."
& "$REPO\scripts\setup-cpi-release-tasks.ps1"

# ── Summary ───────────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "Tasks registered:"
$names = @(
  "FidelityQuotes",
  "FedInvestPrices",
  "TreasuryAuctions-Morning","TreasuryAuctions-Afternoon",
  "TipsRef","Update CPI release schedule",
  "RefCPI","FetchCpiHistory","RefreshCpiTasks"
)
Get-ScheduledTask | Where-Object { $_.TaskName -in $names } |
  Select-Object TaskName, State | Sort-Object TaskName | Format-Table -AutoSize
