# Reads a Fidelity SMS verification code from the Phone Link app via Windows UI
# Automation. Two modes so the caller can diff "before" vs "after" requesting a code:
#   -Mode baseline  : print the current newest matching message text (may be empty)
#   -Mode wait       : poll until the newest matching message text changes from
#                       -Baseline, then print just the 6-digit code
param(
  [ValidateSet('baseline', 'wait')]
  [string]$Mode = 'wait',
  [string]$Baseline = '',
  [int]$TimeoutSec = 60,
  [int]$PollIntervalSec = 3
)

Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes

function Get-LatestCodeMessageText {
  $root = [System.Windows.Automation.AutomationElement]::RootElement
  $winCond = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::NameProperty, 'Phone Link')
  $win = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $winCond)
  if (-not $win) { return $null }

  $msgListCond = New-Object System.Windows.Automation.AndCondition(
    (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::List)),
    (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, 'Messages'))
  )
  $msgList = $win.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $msgListCond)
  if (-not $msgList) { return $null }

  $itemCond = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::ListItem)
  $items = $msgList.FindAll([System.Windows.Automation.TreeScope]::Children, $itemCond)
  if ($items.Count -eq 0) { return $null }

  # Walk from the newest item backwards, skipping date separators, to the last
  # message that actually contains a code.
  for ($i = $items.Count - 1; $i -ge 0; $i--) {
    $name = $items[$i].Current.Name
    if ($name -match 'Code is:\s*(\d{6})') { return $name }
  }
  return $null
}

if ($Mode -eq 'baseline') {
  Write-Output (Get-LatestCodeMessageText)
  exit 0
}

$deadline = (Get-Date).AddSeconds($TimeoutSec)
while ((Get-Date) -lt $deadline) {
  $text = Get-LatestCodeMessageText
  if ($text -and $text -ne $Baseline -and $text -match 'Code is:\s*(\d{6})') {
    Write-Output $Matches[1]
    exit 0
  }
  Start-Sleep -Seconds $PollIntervalSec
}
exit 1
