<#
.SYNOPSIS
    Registers/refreshes the TreasuryAuctions tentative-schedule tasks.
.DESCRIPTION
    Two tasks, both registered unelevated (no UAC, freely re-editable):

    - TreasuryAuctions-TentativeSchedule: runs scripts/updateTentativeSchedule.js.
      Triggers: one-time daily triggers for 21 days after each of the next 2
      Quarterly Refunding dates (first Wednesday of Feb/May/Aug/Nov -- Treasury
      revises this schedule then; the document itself updates ~1-3 weeks later),
      plus a monthly safety-net trigger (1st of month) for the next 4 months in
      case of an off-cycle revision.

    - TreasuryAuctions-TentativeSchedule-Refresh: re-runs this script itself on
      the 1st of the next Jan/Apr/Jul/Oct, rolling the trigger window forward.
      Same self-rescheduling idiom as CpiTasks in setup-windows-tasks.ps1.

    Run once: powershell -ExecutionPolicy Bypass -File setup-tentative-schedule-task.ps1
.PARAMETER ProjectDir
    Treasuries project root. Defaults to the parent of this script's directory.
#>
param(
    [string]$ProjectDir = (Split-Path $PSScriptRoot -Parent)
)

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
    Write-Error "Node.js not found. Install it from https://nodejs.org/ and re-run."
    exit 1
}
$NodeExe = $nodeCmd.Source
$conhost = "$env:WINDIR\System32\conhost.exe"

function Get-QuarterlyRefundingDates {
    param([datetime]$From, [int]$Count)
    $months = 2, 5, 8, 11
    $dates = @()
    $year = $From.Year
    while ($dates.Count -lt $Count) {
        foreach ($m in $months) {
            $first = Get-Date -Year $year -Month $m -Day 1
            $offset = (3 - [int]$first.DayOfWeek + 7) % 7   # 3 = Wednesday
            $firstWed = $first.AddDays($offset)
            if ($firstWed -ge $From.Date) { $dates += $firstWed }
        }
        $year++
    }
    return $dates | Sort-Object | Select-Object -First $Count
}

$now = Get-Date

# ---------------------------------------------------------------------------
# TreasuryAuctions-TentativeSchedule: rolling quarterly-refunding + monthly
# safety-net triggers, all as one-time triggers (avoids ambiguous behavior
# seen with Repetition + ScheduleByMonthDayOfWeek CalendarTriggers).
# ---------------------------------------------------------------------------
$quarterDates = Get-QuarterlyRefundingDates -From $now -Count 2

$triggers = [System.Collections.Generic.List[object]]::new()
foreach ($qd in $quarterDates) {
    for ($i = 0; $i -lt 21; $i++) {
        $day = $qd.AddDays($i)
        if ($day.Date -ge $now.Date) {
            $triggers.Add((New-ScheduledTaskTrigger -Once -At $day.Date.AddHours(8).AddMinutes(35)))
        }
    }
}
for ($i = 0; $i -lt 4; $i++) {
    $m = $now.AddMonths($i)
    $firstOfMonth = Get-Date -Year $m.Year -Month $m.Month -Day 1 -Hour 8 -Minute 35 -Second 0
    if ($firstOfMonth -ge $now.Date) { $triggers.Add((New-ScheduledTaskTrigger -Once -At $firstOfMonth)) }
}

$action = New-ScheduledTaskAction -Execute $conhost `
    -Argument "--headless `"$NodeExe`" scripts/updateTentativeSchedule.js" `
    -WorkingDirectory $ProjectDir
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 30) -StartWhenAvailable
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

if (Get-ScheduledTask -TaskName "TreasuryAuctions-TentativeSchedule" -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName "TreasuryAuctions-TentativeSchedule" -Confirm:$false
}
Register-ScheduledTask -TaskName "TreasuryAuctions-TentativeSchedule" `
    -Action $action -Trigger $triggers.ToArray() -Settings $settings -Principal $principal `
    -Description "Refresh Treasury Tentative Auction Schedule XML mirror to R2. Triggers: daily for 21 days after each of the next 2 Quarterly Refunding dates (first Wed of Feb/May/Aug/Nov -- Treasury revises this schedule then, publish lag ~1-3wk), plus a monthly safety net. Regenerated quarterly by TreasuryAuctions-TentativeSchedule-Refresh." | Out-Null

Write-Host "TreasuryAuctions-TentativeSchedule: $($triggers.Count) triggers registered (quarters covered: $($quarterDates -join ', '))"

# ---------------------------------------------------------------------------
# TreasuryAuctions-TentativeSchedule-Refresh: self-reschedules quarterly.
# ---------------------------------------------------------------------------
$quarterStarts = 1, 4, 7, 10
$nextRefresh = $quarterStarts | ForEach-Object {
    $d = Get-Date -Year $now.Year -Month $_ -Day 1 -Hour 6 -Minute 0 -Second 0
    if ($d -le $now) { $d = $d.AddYears(1) }
    $d
} | Sort-Object | Select-Object -First 1

$refreshAction = New-ScheduledTaskAction -Execute "$PSHOME\powershell.exe" `
    -Argument "-ExecutionPolicy Bypass -NonInteractive -File `"$ProjectDir\scripts\setup-tentative-schedule-task.ps1`""
$refreshTrigger = New-ScheduledTaskTrigger -Once -At $nextRefresh
$refreshSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable

if (Get-ScheduledTask -TaskName "TreasuryAuctions-TentativeSchedule-Refresh" -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName "TreasuryAuctions-TentativeSchedule-Refresh" -Confirm:$false
}
Register-ScheduledTask -TaskName "TreasuryAuctions-TentativeSchedule-Refresh" `
    -Action $refreshAction -Trigger $refreshTrigger -Settings $refreshSettings -Principal $principal `
    -Description "Re-runs setup-tentative-schedule-task.ps1 quarterly to roll the TreasuryAuctions-TentativeSchedule trigger window forward." | Out-Null

Write-Host "TreasuryAuctions-TentativeSchedule-Refresh scheduled for $($nextRefresh.ToString('yyyy-MM-dd HH:mm'))"
