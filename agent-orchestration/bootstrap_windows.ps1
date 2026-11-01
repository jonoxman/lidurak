# Run in Windows PowerShell as Administrator on any new PC
$ErrorActionPreference = "Stop"

Write-Host "=== 1. Checking WSL 2 & Ubuntu Installation ===" -ForegroundColor Cyan
$wslStatus = wsl.exe --status 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Installing WSL 2 and Ubuntu..." -ForegroundColor Yellow
    wsl.exe --install -d Ubuntu
    Write-Host "⚠️ If Windows prompts for a reboot to finish WSL 2 installation, reboot and re-run this script." -ForegroundColor Yellow
} else {
    $distros = wsl.exe --list --quiet
    if ($distros -notmatch "Ubuntu") {
        wsl.exe --install -d Ubuntu
    }
}

Write-Host "=== 2. Hardening WSL Sandbox (/etc/wsl.conf) ===" -ForegroundColor Cyan
$wslConf = @'
[automount]
enabled = false
mountFsTab = false

[interop]
enabled = false
appendWindowsPath = false

[boot]
systemd = true
'@
$wslConf | wsl.exe -d Ubuntu -u root tee /etc/wsl.conf >$null
Write-Host "Restarting WSL to apply security quarantine..." -ForegroundColor Yellow
wsl.exe --shutdown
Start-Sleep -Seconds 3

Write-Host "=== 3. Creating Multi-Worker Mission Control Launcher ===" -ForegroundColor Cyan
$LauncherContent = @'
param(
    [int]$Workers = 3
)

Write-Host "🚀 Launching Lidurak Parallel Mission Control ($Workers Workers)..." -ForegroundColor Cyan

# Window 1: Main Orchestrator
Start-Process wsl.exe -ArgumentList "--cd ~/lidurak-agent-project -e bash -lc `"./agent-orchestration/orchestrate.sh --workers $Workers; exec bash`""
Start-Sleep -Seconds 2

# Window 2: Multi-Worker FreeBuff Tabbed Viewer (Ctrl+A then 1..N to switch workers)
Start-Process wsl.exe -ArgumentList "--cd ~/lidurak-agent-project -e bash -lc `"./agent-orchestration/watch-workers.sh $Workers; exec bash`""
Start-Sleep -Seconds 1

# Window 3: Live Worker Pool, Test Gate & PR Review Monitor
Start-Process wsl.exe -ArgumentList "--cd ~/lidurak-agent-project -e bash -lc `"./agent-orchestration/watch-reviews.sh; exec bash`""
Start-Sleep -Seconds 1

# Window 4: Interactive Command Line
Start-Process wsl.exe -ArgumentList "--cd ~/lidurak-agent-project"

Write-Host "✅ All 4 windows launched!" -ForegroundColor Green
'@
$LauncherContent | Set-Content -Path "$HOME\mission_control.ps1" -Encoding UTF8
$LauncherContent | Set-Content -Path "$HOME\mission-control.ps1" -Encoding UTF8

Write-Host "✅ Windows host setup complete! Next, open Ubuntu WSL and run ~/lidurak-agent-project/agent-orchestration/install-wsl-deps.sh." -ForegroundColor Green
