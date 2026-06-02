# install-windows-pm2-startup.ps1
#
# Native Windows replacement for `pm2 startup`.

[CmdletBinding()]
param(
    [switch]$Uninstall,
    [string]$TaskName = 'PM2 Resurrect'
)

$ErrorActionPreference = 'Stop'

if ($Uninstall) {
    if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        Write-Host "[ok] Removed scheduled task: $TaskName"
    } else {
        Write-Host "[skip] No scheduled task named '$TaskName' is registered."
    }
    return
}

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) {
    Write-Error "node.exe not found on PATH. Install Node.js 20+ before running this script."
    exit 1
}

$pm2BinCandidates = @(
    (Join-Path $env:APPDATA 'npm\node_modules\pm2\bin\pm2'),
    (Join-Path (Split-Path $node -Parent) 'node_modules\pm2\bin\pm2')
)
$pm2Bin = $pm2BinCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $pm2Bin) {
    Write-Error "Could not locate pm2 bin script. Install with: npm install -g pm2"
    exit 1
}

$dumpFile = Join-Path $env:USERPROFILE '.pm2\dump.pm2'
if (-not (Test-Path $dumpFile)) {
    Write-Warning "PM2 dump file not found at $dumpFile."
    Write-Warning "Run 'pm2 save' AFTER starting your processes, otherwise resurrect has nothing to restore."
}

$action = New-ScheduledTaskAction -Execute $node -Argument "`"$pm2Bin`" resurrect"
$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Hours 72) `
    -MultipleInstances IgnoreNew `
    -Hidden

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Principal $principal `
    -Settings $settings `
    -Description 'cortextOS: revive PM2-managed daemon + dashboard at user logon. See scripts/install-windows-pm2-startup.ps1.' | Out-Null

Write-Host ""
Write-Host "[ok] Registered scheduled task: $TaskName"
Write-Host "      Trigger:   At logon ($env:USERDOMAIN\$env:USERNAME)"
Write-Host "      Action:    $node `"$pm2Bin`" resurrect"
Write-Host ""
Write-Host "Verify with:  Get-ScheduledTask -TaskName '$TaskName' | Get-ScheduledTaskInfo"
Write-Host "Test now:     Start-ScheduledTask -TaskName '$TaskName'"
Write-Host ""
Write-Host "TIP: set your Windows power plan to 'Never sleep' for true 24/7 operation."
