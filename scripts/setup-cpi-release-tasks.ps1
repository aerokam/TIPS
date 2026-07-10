# setup-cpi-release-tasks.ps1
#
# Registers (or updates) Windows Scheduled Tasks for CPI-related jobs so they
# fire only on actual BLS CPI release dates, at 2:00 PM ET (11:00 AM PT).
#
# Tasks managed:
#   RefCPI          -- runs run-ref-cpi.cmd
#   FetchCpiHistory -- runs run-cpi-history.cmd
#
# Run this script once per year (or after updateCpiReleaseSchedules.sh fetches
# a new year's CSV) to refresh the trigger list.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\setup-cpi-release-tasks.ps1

$ErrorActionPreference = 'Stop'
$R2_BASE = 'https://pub-ba11062b177640459f72e0a88d0261ae.r2.dev'
$REPO    = Split-Path $PSScriptRoot

# BLS releases at 8:30 AM ET. TreasuryDirect ref CPI data lags a few hours after release,
# so run at 2:00 PM ET (11:00 AM PT) to ensure TreasuryDirect has updated.
# Machine is Pacific time. ET is always 3 hours ahead of PT.
$RELEASE_HOUR_PT   = 11
$RELEASE_MINUTE_PT = 0

$TASKS = @(
    [PSCustomObject]@{ Name = 'RefCpi';      Cmd = "$REPO\scripts\run-ref-cpi.cmd" },
    [PSCustomObject]@{ Name = 'CpiHistory';  Cmd = "$REPO\scripts\run-cpi-history.cmd" }
)

function Get-ReleaseDates {
    $currentYear = [int](Get-Date).Year
    $nextYear    = $currentYear + 1
    $years       = @($currentYear, $nextYear)
    $seen        = [System.Collections.Generic.HashSet[string]]::new()
    $dates       = [System.Collections.Generic.List[datetime]]::new()

    foreach ($year in $years) {
        $url = "$R2_BASE/bls/CpiReleaseSchedule$year.csv"
        try {
            $resp = Invoke-WebRequest -Uri $url -UseBasicParsing
            if ($resp.StatusCode -ne 200) { throw "HTTP $($resp.StatusCode)" }
            $csv = $resp.Content
        } catch {
            Write-Host "  No schedule for $year -- skipping"
            continue
        }

        foreach ($line in ($csv -split "`n")) {
            $line = $line.Trim()
            if ($line.Length -eq 0) { continue }
            # Format: "Tuesday, May 12, 2026","08:30 AM","Consumer Price Index..."
            # Strip outer quotes then take everything before the first ","
            $stripped = $line.TrimStart('"')
            $dateStr  = ($stripped -split '","')[0].TrimEnd('"')
            if ($dateStr -eq 'Date') { continue }
            if ($seen.Contains($dateStr)) { continue }
            try {
                $dt = [datetime]::Parse($dateStr)
                [void]$seen.Add($dateStr)
                $dates.Add($dt)
            } catch {
                # skip malformed lines
            }
        }
    }

    return $dates.ToArray()
}

function Build-Triggers($dates) {
    $now = Get-Date
    $triggers = @()

    foreach ($d in $dates) {
        $fireAt = Get-Date -Year $d.Year -Month $d.Month -Day $d.Day `
                           -Hour $RELEASE_HOUR_PT -Minute $RELEASE_MINUTE_PT -Second 0

        if ($fireAt -gt $now) {
            $triggers += New-ScheduledTaskTrigger -Once -At $fireAt
        }
    }

    return $triggers
}

Write-Host "Fetching CPI release schedules from R2..."
$releaseDates = Get-ReleaseDates

$futureDates = @($releaseDates | Where-Object { $_ -gt (Get-Date) } | Sort-Object)
Write-Host "Found $($releaseDates.Count) total dates; $($futureDates.Count) future dates:"
$futureDates | ForEach-Object { Write-Host "  $($_.ToString('yyyy-MM-dd'))" }

if ($futureDates.Count -eq 0) {
    Write-Warning "No future release dates found -- tasks not updated."
    exit 1
}

$triggers = Build-Triggers $futureDates
$settings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 5) `
    -StartWhenAvailable

foreach ($task in $TASKS) {
    Write-Host ""
    Write-Host "Registering task '$($task.Name)'..."

    # Run via conhost --headless so no console window appears (see setup-windows-tasks.ps1).
    $action = New-ScheduledTaskAction -Execute "$env:WINDIR\System32\conhost.exe" `
        -Argument "--headless cmd /c `"$($task.Cmd)`""
    $desc   = "Runs on BLS CPI release dates at 8:35 AM ET. Triggers refreshed via setup-cpi-release-tasks.ps1."

    Register-ScheduledTask `
        -TaskName    $task.Name `
        -Action      $action `
        -Trigger     $triggers `
        -Settings    $settings `
        -Description $desc `
        -Force | Out-Null

    $info = Get-ScheduledTask -TaskName $task.Name | Get-ScheduledTaskInfo
    Write-Host "  Next run: $($info.NextRunTime)"
}

# Schedule the next annual refresh on Dec 29 of the last year in the release data.
# By then updateCpiReleaseSchedules.sh will have picked up the following year's CSV.
$lastYear     = ($releaseDates | Sort-Object | Select-Object -Last 1).Year
$refreshAt    = Get-Date -Year $lastYear -Month 12 -Day 29 -Hour 9 -Minute 0 -Second 0
$refreshTask  = 'RefreshCpiTasks'
$refreshDesc  = "Annual refresh of RefCPI + FetchCpiHistory task triggers. Reads the next year BLS CPI schedule from R2 and rebuilds date-specific triggers."
$refreshAction = New-ScheduledTaskAction `
    -Execute  "$env:WINDIR\System32\conhost.exe" `
    -Argument "--headless powershell -ExecutionPolicy Bypass -File `"$REPO\scripts\setup-cpi-release-tasks.ps1`""
$refreshSettings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 5) `
    -StartWhenAvailable

Write-Host ""
Write-Host "Scheduling annual refresh task '$refreshTask' for $($refreshAt.ToString('yyyy-MM-dd')) 09:00 AM..."
if ($refreshAt -gt (Get-Date)) {
    $refreshTrigger = New-ScheduledTaskTrigger -Once -At $refreshAt
    Register-ScheduledTask `
        -TaskName    $refreshTask `
        -Action      $refreshAction `
        -Trigger     $refreshTrigger `
        -Settings    $refreshSettings `
        -Description $refreshDesc `
        -Force | Out-Null
    Write-Host "  Scheduled for $($refreshAt.ToString('yyyy-MM-dd HH:mm')) local."
} else {
    Write-Host "  Refresh date $($refreshAt.ToString('yyyy-MM-dd')) is in the past -- skipping (run manually when ready)."
}

Write-Host ""
Write-Host "Done. RefreshCpiTasks will re-run this script on $($refreshAt.ToString('yyyy-MM-dd'))."
