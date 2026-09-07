<#
.SYNOPSIS
    Registers all Treasuries data pipeline tasks in Windows Task Scheduler.
.DESCRIPTION
    Creates one scheduled task per ingestion job. Re-running is safe (idempotent  - 
    existing tasks are unregistered and re-created).

    CPI tasks use date-specific triggers fetched live from R2. All other tasks use
    weekly or daily recurring triggers.

    All times are Pacific Time (PT). ET-based tasks run 5 minutes after their ET
    anchor. ET and PT observe DST together so the offset is always -3h.
    If your machine is NOT in Pacific Time, adjust all times below.
.PARAMETER ProjectDir
    Treasuries project root. Defaults to the parent of this script's directory.
#>
param(
    [string]$ProjectDir = (Split-Path $PSScriptRoot -Parent)
)

# Self-elevate via UAC if not already running as administrator.
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    $argList = "-ExecutionPolicy Bypass -NonInteractive -File `"$PSCommandPath`" -ProjectDir `"$ProjectDir`""
    Start-Process powershell.exe -Verb RunAs -ArgumentList $argList
    exit
}

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
    Write-Error "Node.js not found. Install it from https://nodejs.org/ and re-run."
    exit 1
}
$NodeExe = $nodeCmd.Source

Write-Host "Project : $ProjectDir"
Write-Host "Node    : $NodeExe"
Write-Host ""

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

function Register-DataTask {
    param(
        [string]   $Name,
        [string]   $Description,
        [object[]] $Triggers,
        [string]   $Execute,
        [string]   $Argument,
        [string]   $Cwd = $ProjectDir,
        [TimeSpan] $RestartInterval,
        [int]      $RestartCount = 0
    )
    if (Get-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $Name -Confirm:$false
    }
    # Run via conhost --headless so no console window ever appears/steals focus.
    # Task Scheduler otherwise pops a visible conhost window for any console-subsystem
    # action, even when the script itself redirects all output to a log file.
    $conhost   = "$env:WINDIR\System32\conhost.exe"
    $hiddenArg = "--headless `"$Execute`" $Argument"
    $action    = New-ScheduledTaskAction -Execute $conhost -Argument $hiddenArg -WorkingDirectory $Cwd
    $settingsArgs = @{ ExecutionTimeLimit = (New-TimeSpan -Minutes 30); StartWhenAvailable = $true }
    if ($RestartCount -gt 0) {
        $settingsArgs.RestartInterval = $RestartInterval
        $settingsArgs.RestartCount    = $RestartCount
    }
    $settings  = New-ScheduledTaskSettingsSet @settingsArgs
    $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
    $task      = New-ScheduledTask -Action $action -Trigger $Triggers -Settings $settings -Principal $principal -Description $Description
    Register-ScheduledTask -TaskName $Name -InputObject $task | Out-Null
    Write-Host "  [OK] $Name"
}

function Register-NodeTask {
    param([string]$Name, [string]$Description, [object[]]$Triggers, [string]$Script)
    Register-DataTask -Name $Name -Description $Description -Triggers $Triggers `
        -Execute $NodeExe -Argument $Script
}

function Register-CmdTask {
    param(
        [string]   $Name, [string]$Description, [object[]]$Triggers, [string]$CmdFile,
        [TimeSpan] $RestartInterval,
        [int]      $RestartCount = 0
    )
    Register-DataTask -Name $Name -Description $Description -Triggers $Triggers `
        -Execute "cmd.exe" -Argument "/c `"$CmdFile`"" `
        -RestartInterval $RestartInterval -RestartCount $RestartCount
}

[System.DayOfWeek[]] $Weekdays = 'Monday','Tuesday','Wednesday','Thursday','Friday'

# ---------------------------------------------------------------------------
# Remove legacy tasks (replaced by the canonical names below)
# ---------------------------------------------------------------------------
Write-Host "Removing legacy tasks..."
$legacy = @(
    # FedInvest variants
    'FedInvestPrices', 'FedInvestYields', 'FedInvestDownload',
    # Auction variants
    'TreasuryAuctions-Morning', 'TreasuryAuctions-Afternoon', 'AuctionRefresh',
    # TIPS Ref variants
    'TipsRefRefresh',
    # Yield History variants
    'SnapYieldHistory', 'YieldHistorySnap',
    # SA Factor variants
    'SaFactorUpdate',
    # Ref CPI variants (now chained from inside CpiHistory's wrapper, not its own task)
    'RefCPI', 'RefCpi', 'RefCpiRefresh',
    # CPI History variants
    'FetchCpiHistory', 'CpiHistoryRefresh',
    # Fidelity variants
    'FidelityDownload-Morning', 'FidelityDownload-Midday', 'FidelityDownload-Close',
    # CpiTasks variants
    'RefreshCpiTasks', 'Update CPI release schedule'
)
foreach ($name in $legacy) {
    if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $name -Confirm:$false
        Write-Host "  [REMOVED] $name"
    }
}

# ---------------------------------------------------------------------------
# Recurring tasks
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "Registering recurring tasks..."

# YieldsFromFedInvestPrices  -  1:05pm ET [PT: 10:05am]
# FedInvest posts reference prices by 1pm ET; script downloads prices and calculates YTM
# yields. Retry every 10 min, up to 12x (2h), if FedInvest is still showing yesterday's
# prices (non-zero exit from getYieldsFedInvest.js's freshness check).
Register-CmdTask "YieldsFromFedInvestPrices" `
    "Download FedInvest reference prices, calculate YTM yields, upload YieldsFromFedInvestPrices.csv; retries if today's prices aren't posted yet" `
    @(New-ScheduledTaskTrigger -Weekly -DaysOfWeek $Weekdays -At "10:05am") `
    "$ProjectDir\YieldCurves\scripts\run-fedinvest.cmd" `
    -RestartInterval (New-TimeSpan -Minutes 10) -RestartCount 12

# TreasuryAuctions  -  11:35am ET [PT: 8:35am] and 1:05pm ET [PT: 10:05am]
# Treasury auction close times are 11:30am ET and 1:00pm ET; run 5 min after each.
Register-NodeTask "TreasuryAuctions" `
    "Fetch Treasury auction results from FiscalData, upload Auctions.csv" `
    @(
        (New-ScheduledTaskTrigger -Weekly -DaysOfWeek $Weekdays -At "8:35am"),
        (New-ScheduledTaskTrigger -Weekly -DaysOfWeek $Weekdays -At "10:05am")
    ) `
    "scripts/getAuctions.js"

# TipsRef  -  Weekdays 8:35am and 10:05am PT (same cadence as TreasuryAuctions,
# same underlying FiscalData auctions_query endpoint; catches int_rate as soon as
# it's posted post-auction instead of waiting up to a week on the old Monday-only run).
Register-NodeTask "TipsRef" `
    "Fetch TIPS reference metadata from FiscalData, upload TipsRef.csv" `
    @(
        (New-ScheduledTaskTrigger -Weekly -DaysOfWeek $Weekdays -At "8:35am"),
        (New-ScheduledTaskTrigger -Weekly -DaysOfWeek $Weekdays -At "10:05am")
    ) `
    "scripts/fetchTipsRef.js"

# YieldsHistory  -  Weekdays 2:00pm PT (bond market closes at 5pm ET / 2pm PT)
Register-NodeTask "YieldsHistory" `
    "Refresh consolidated yields-history/history.json (3PM closes, all 14 symbols) in R2" `
    @(New-ScheduledTaskTrigger -Weekly -DaysOfWeek $Weekdays -At "2:00pm") `
    "YieldsMonitor/scripts/updateYieldsHistory.js"

# IntradayArchive  -  Weekdays 2:05pm PT [ET: 5:05pm] (5 min after cash close)
# Audit archive: captures raw 1D + 5D feeds per symbol so any past close window can be
# inspected offline. Separate from YieldsHistory (daily-close baseline).
Register-NodeTask "IntradayArchive" `
    "Archive raw CNBC 1D+5D intraday feeds per symbol to R2 yields-history/intraday-raw" `
    @(New-ScheduledTaskTrigger -Weekly -DaysOfWeek $Weekdays -At "2:05pm") `
    "YieldsMonitor/scripts/archiveIntraday.js"

# CloseProbe  -  Weekdays starting 2:05pm PT [ET: 5:05pm], repeating every 15 min for 1 hour
# Temporary investigation: logs the last 1D bar of US10YTIPS at 17:05/17:20/17:35/17:50/18:05
# ET to pin down when the 17:05 consolidation print reliably posts. Retire once known.
$probeTrigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek $Weekdays -At "2:05pm"
$probeTrigger.Repetition = (New-ScheduledTaskTrigger -Once -At "2:05pm" `
    -RepetitionInterval (New-TimeSpan -Minutes 15) `
    -RepetitionDuration (New-TimeSpan -Hours 1)).Repetition
Register-NodeTask "CloseProbe" `
    "Probe: log US10YTIPS last 1D bar every 15min after close to find when 17:05 print posts" `
    @($probeTrigger) `
    "YieldsMonitor/scripts/probeClose.js"

# SaFactors  -  Daily 6:35am PT
Register-NodeTask "SaFactors" `
    "Fetch CPI NSA/SA from BLS, calculate daily SA factors, upload RefCpiNsaSa.csv, refresh SA/SAO yields" `
    @(New-ScheduledTaskTrigger -Daily -At "6:35am") `
    "YieldCurves/scripts/updateRefCpi.js"

# FundHoldings  -  Daily 6:40am PT
# Fetch Vanguard (VBIL/VTIP/VTP) + fminvest (RBIL) fund holdings, enrich, upload to R2.
Register-NodeTask "FundHoldings" `
    "Refresh Vanguard/fminvest fund holdings, enrich with yields, upload to R2 (FundHoldings/ prefix)" `
    @(New-ScheduledTaskTrigger -Daily -At "6:40am") `
    "FundHoldings/updateAllHoldings.js"

# GswTipsCurve  -  Daily 7:15am PT
# Scrape the latest row of the Fed's GSW fitted TIPS curve (published weekly, Tuesdays,
# through prior Friday); write its 6 Svensson parameters + date to TIPS/GswTipsCurve.json.
# Daily (not weekly) so an off-schedule Fed revision is picked up promptly; the fetch is tiny.
Register-NodeTask "GswTipsCurve" `
    "Scrape the latest GSW fitted TIPS curve parameters, upload TIPS/GswTipsCurve.json" `
    @(New-ScheduledTaskTrigger -Daily -At "7:15am") `
    "YieldCurves/scripts/updateGswTipsCurve.js"

# FidelityQuotes  -  8:05am ET [PT: 5:05am], 12:35pm ET [PT: 9:35am], 5:05pm ET [PT: 2:05pm]
# Bond market hours 8am-5pm ET; run at open, midday, and close.
Register-CmdTask "FidelityQuotes" `
    "Download Fidelity broker quotes (TIPS + Treasuries), upload FidelityTips.csv + FidelityTreasuries.csv" `
    @(
        (New-ScheduledTaskTrigger -Weekly -DaysOfWeek $Weekdays -At "5:05am"),
        (New-ScheduledTaskTrigger -Weekly -DaysOfWeek $Weekdays -At "9:35am"),
        (New-ScheduledTaskTrigger -Weekly -DaysOfWeek $Weekdays -At "2:05pm")
    ) `
    "$ProjectDir\YieldCurves\scripts\run-fidelity.cmd"

# SpotYieldCurves  -  8:10am ET [PT: 5:10am], 12:40pm ET [PT: 9:40am], 5:10pm ET [PT: 2:10pm]
# 5 minutes after each FidelityQuotes run so FidelityTreasuriesTips.csv has already landed.
# Fits the spot (zero-coupon) yield curves YieldCurves computes but does not otherwise
# persist, plus per-TIPS breakeven inflation and broker bid/ask spreads; uploads all three
# to R2 (S13/S14/S15 — knowledge/DataStores.md).
Register-NodeTask "SpotYieldCurves" `
    "Fit spot yield curves + breakeven inflation + bid/ask spreads, upload to R2 (Treasuries/ prefix)" `
    @(
        (New-ScheduledTaskTrigger -Weekly -DaysOfWeek $Weekdays -At "5:10am"),
        (New-ScheduledTaskTrigger -Weekly -DaysOfWeek $Weekdays -At "9:40am"),
        (New-ScheduledTaskTrigger -Weekly -DaysOfWeek $Weekdays -At "2:10pm")
    ) `
    "YieldCurves/scripts/updateSpotYieldCurves.js"

# LockProbe  -  Weekdays 11:00am PT [ET: 2:00pm], hourly for 18h (through overnight).
# Temporary investigation (Close_Price_Investigation.md §8): each hour logs the last 7 daily
# (6M-feed) bars by date for US10YTIPS + US10Y vs the live 1D value. The just-completed day's
# bar tracks live until CNBC revises it to the ~3PM benchmark; the run where that date's value
# snaps to the benchmark and stops moving pins the revision time. Starting at 2pm ET (before
# the ~14:59 benchmark snap) ensures we catch the transition live, not just the aftermath.
$lockTrigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek $Weekdays -At "11:00am"
$lockTrigger.Repetition = (New-ScheduledTaskTrigger -Once -At "2:00pm" `
    -RepetitionInterval (New-TimeSpan -Hours 1) `
    -RepetitionDuration (New-TimeSpan -Hours 18)).Repetition
Register-NodeTask "LockProbe" `
    "Track the just-completed day's daily bar hourly overnight to pin when CNBC revises it to the ~3PM benchmark" `
    @($lockTrigger) `
    "YieldsMonitor/scripts/probeLock.js"

# DashboardServer  -  Weekday mornings 6:00am PT, self-healing every 30 min through the day.
# Keeps the local Admin Dashboard (Dashboard/server.js, port 3737) running. The wrapper is
# guarded (starts only if 3737 is free) and headless (no browser), so the repetition is a
# harmless heartbeat that recovers from a mid-day crash without needing a logon trigger.
$dashTrigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek $Weekdays -At "6:00am"
$dashTrigger.Repetition = (New-ScheduledTaskTrigger -Once -At "6:00am" `
    -RepetitionInterval (New-TimeSpan -Minutes 30) `
    -RepetitionDuration (New-TimeSpan -Hours 18)).Repetition
Register-CmdTask "DashboardServer" `
    "Ensure the local Admin Dashboard (port 3737) is running; start it headless if not" `
    @($dashTrigger) `
    "$ProjectDir\scripts\run-dashboard.cmd"

# ---------------------------------------------------------------------------
# CPI release date tasks  -  date-specific triggers fetched live from R2
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "Fetching CPI release schedule from R2..."

$R2Base      = 'https://pub-ba11062b177640459f72e0a88d0261ae.r2.dev'
$now         = Get-Date
$futureDates = [System.Collections.Generic.List[datetime]]::new()

foreach ($year in @($now.Year, $now.Year + 1)) {
    $url = "$R2Base/bls/CpiReleaseSchedule$year.csv"
    try {
        $csv = (Invoke-WebRequest -Uri $url -UseBasicParsing -ErrorAction Stop).Content
        foreach ($line in ($csv -split "`n")) {
            # Format: "Friday, April 10, 2026","08:30 AM","Consumer Price Index..."
            if ($line -match '^"([A-Za-z]+, [A-Za-z]+ \d+, \d+)"') {
                try {
                    $d = [datetime]::ParseExact(
                        $Matches[1], "dddd, MMMM d, yyyy",
                        [System.Globalization.CultureInfo]::InvariantCulture
                    )
                    if ($d -gt $now) { $futureDates.Add($d) }
                } catch { }
            }
        }
    } catch {
        Write-Warning "  Could not fetch CpiReleaseSchedule$year.csv: $_"
    }
}

if ($futureDates.Count -gt 0) {
    # 8:35am ET [PT: 5:35am]
    $cpiTriggers = $futureDates | ForEach-Object {
        New-ScheduledTaskTrigger -Once -At ($_.Date.AddHours(5).AddMinutes(35))
    }

    # RefCpi (TIPS/RefCPI.csv) is chained from inside run-cpi-history.cmd, run right after
    # the BLS fetch succeeds, rather than given its own same-time trigger. RefCpi pulls from
    # TreasuryDirect, a separate source that lags BLS's 8:30am ET print by an unknown amount;
    # chaining runs it as soon as our own fetch confirms release day instead of guessing a
    # fixed clock offset (the old fixed 11am PT trigger was confirmed too conservative).
    # Retry every 30 min, up to 12x (6h), if the Ref CPI chain step reports TreasuryDirect
    # hasn't caught up yet (non-zero exit from run-ref-cpi.cmd's freshness check).
    Register-CmdTask "CpiHistory" `
        "Fetch full CPI-U history from BLS on release dates, upload bls/CPI_history.csv; then chain-run Ref CPI fetch (TIPS/RefCPI.csv), retrying if TreasuryDirect hasn't caught up yet" `
        $cpiTriggers `
        "$ProjectDir\scripts\run-cpi-history.cmd" `
        -RestartInterval (New-TimeSpan -Minutes 30) -RestartCount 12

    $nextDate = ($futureDates | Sort-Object | Select-Object -First 1).ToString('yyyy-MM-dd')
    Write-Host "  Registered $($futureDates.Count) CPI date triggers (next: $nextDate)"
} else {
    Write-Warning "  No future CPI dates found  -  CpiHistory NOT registered."
}

# ---------------------------------------------------------------------------
# CpiTasks  -  Dec 29 annually: re-runs this script to reload next year's CPI schedule
# ---------------------------------------------------------------------------
$dec29 = Get-Date -Year $now.Year -Month 12 -Day 29 -Hour 7 -Minute 0 -Second 0
if ($dec29 -lt $now) { $dec29 = $dec29.AddYears(1) }

Register-DataTask -Name "CpiTasks" `
    -Description "Re-run setup script Dec 29 annually to reload next year's CPI release date triggers" `
    -Triggers @(New-ScheduledTaskTrigger -Once -At $dec29) `
    -Execute "$PSHOME\powershell.exe" `
    -Argument "-ExecutionPolicy Bypass -NonInteractive -File `"$ProjectDir\scripts\setup-windows-tasks.ps1`""

Write-Host "  CpiTasks scheduled for $($dec29.ToString('yyyy-MM-dd')) 07:00"

# ---------------------------------------------------------------------------

Write-Host ""
Write-Host "Done. All tasks registered."
Write-Host "Verify: schtasks /query /fo table | findstr /i Yields"
