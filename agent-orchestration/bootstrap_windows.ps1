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
# Quarantines WSL from Windows drives (C:\) and Windows PATH
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
@'
param(
    [int]$Workers = 3
)

Write-Host "🚀 Launching Lidurak Parallel Mission Control ($Workers Workers)..." -ForegroundColor Cyan

# Window 1: Parallel Orchestrator (Boots Docker workers & manages GitHub PR pipeline)
Start-Process wsl.exe -ArgumentList "-e bash -ic `"cd ~/agent-project && ./agent-orchestration/orchestrate.sh --workers $Workers; exec bash`""
Start-Sleep -Seconds 1

# Window 2: Multi-Worker FreeBuff Viewer (Switch between workers 1..N with Ctrl+A then 1/2/3 or n/p)
Start-Process wsl.exe -ArgumentList "-e bash -ic `"cd ~/agent-project && ./agent-orchestration/watch-workers.sh $Workers; exec bash`""
Start-Sleep -Seconds 1

# Window 3: Live PR, Test Gate & Review Monitor
Start-Process wsl.exe -ArgumentList "-e bash -ic `"cd ~/agent-project && ./agent-orchestration/watch-reviews.sh; exec bash`""
Start-Sleep -Seconds 1

# Window 4: Interactive Command Line (For play-local.sh, gh pr list, git sync)
Start-Process wsl.exe -ArgumentList "-e bash -ic `"cd ~/agent-project && clear && echo === Interactive Shell: ~/agent-project === && exec bash`""

Write-Host "✅ All 4 Mission Control windows launched!" -ForegroundColor Green
'@ | Set-Content -Path "$HOME\mission-control.ps1" -Encoding UTF8

Write-Host "✅ Windows host setup complete! Next, open Ubuntu WSL and run install-wsl-deps.sh." -ForegroundColor Green
